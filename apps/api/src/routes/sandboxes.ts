import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, EventStatus, Prisma, SandboxMemberRole } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { zDateTime, zUuid } from "../lib/zod.js";
import { copyPlanToSandbox } from "../lib/sandboxCopy.js";

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  return "browser";
}

function assertAuthed(req: any): { id: string; email: string; roles: string[] } {
  const auth = req.auth as { id?: string; email?: string; roles?: string[] } | undefined;
  if (!auth?.id || !auth?.email) {
    const err: any = new Error("UNAUTHORIZED");
    err.statusCode = 401;
    throw err;
  }
  return { id: auth.id, email: auth.email, roles: auth.roles ?? [] };
}

async function assertOwner(app: any, sandboxId: string, userId: string) {
  const sb = await app.prisma.sandbox.findUnique({ where: { id: sandboxId }, select: { ownerId: true } });
  if (!sb) {
    const err: any = new Error("SANDBOX_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }
  if (sb.ownerId !== userId) {
    const err: any = new Error("FORBIDDEN");
    err.statusCode = 403;
    throw err;
  }
  return sb;
}

async function assertMember(app: any, sandboxId: string, userId: string): Promise<"OWNER" | "EDITOR" | "VIEWER"> {
  const sb = await app.prisma.sandbox.findUnique({
    where: { id: sandboxId },
    select: {
      ownerId: true,
      members: { where: { userId }, select: { role: true } }
    }
  });
  if (!sb) {
    const err: any = new Error("SANDBOX_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }
  if (sb.ownerId === userId) return "OWNER";
  const m = sb.members[0];
  if (!m) {
    const err: any = new Error("FORBIDDEN");
    err.statusCode = 403;
    throw err;
  }
  return m.role as "OWNER" | "EDITOR" | "VIEWER";
}

function canWriteRole(role: "OWNER" | "EDITOR" | "VIEWER"): boolean {
  return role === "OWNER" || role === "EDITOR";
}

export const sandboxRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/sandboxes — список своих + расшаренных
  app.get("/", async (req) => {
    const me = assertAuthed(req);
    const sandboxes = await app.prisma.sandbox.findMany({
      where: {
        OR: [{ ownerId: me.id }, { members: { some: { userId: me.id } } }]
      },
      include: {
        owner: { select: { id: true, email: true, displayName: true } },
        members: {
          include: { user: { select: { id: true, email: true, displayName: true } } }
        },
        _count: { select: { events: true } }
      },
      orderBy: [{ updatedAt: "desc" }]
    });

    return sandboxes.map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      ownerId: s.ownerId,
      owner: s.owner,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      isOwner: s.ownerId === me.id,
      myRole: s.ownerId === me.id ? "OWNER" : s.members.find((m: any) => m.userId === me.id)?.role ?? null,
      eventCount: s._count.events,
      members: s.members.map((m: any) => ({
        userId: m.userId,
        role: m.role,
        email: m.user.email,
        displayName: m.user.displayName
      }))
    }));
  });

  // POST /api/sandboxes — создать песочницу, опционально с копированием плана
  app.post("/", async (req) => {
    const me = assertAuthed(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(1000).optional(),
        copyFrom: z
          .union([
            z.literal("empty"),
            z.literal("prod"),
            z.object({
              from: zDateTime.optional(),
              to: zDateTime.optional(),
              source: z.enum(["prod"]).default("prod")
            })
          ])
          .optional()
      })
      .parse(req.body);

    const actor = getActor(req);
    const copyFrom = body.copyFrom ?? "empty";

    const result = await app.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const sandbox = await tx.sandbox.create({
          data: {
            name: body.name,
            description: body.description ?? null,
            ownerId: me.id
          }
        });
        let copiedCounts: Awaited<ReturnType<typeof copyPlanToSandbox>> | null = null;
        if (copyFrom !== "empty") {
          const range = typeof copyFrom === "object" ? { from: copyFrom.from, to: copyFrom.to } : undefined;
          copiedCounts = await copyPlanToSandbox(tx, {
            sourceSandboxId: null,
            targetSandboxId: sandbox.id,
            range,
            actor
          });
        }
        return { sandbox, copiedCounts };
      },
      { timeout: 120_000, maxWait: 15_000 }
    );

    return { ok: true, sandbox: result.sandbox, copied: result.copiedCounts };
  });

  // PATCH /api/sandboxes/:id — переименовать/обновить описание
  app.patch("/:id", async (req) => {
    const me = assertAuthed(req);
    const sandboxId = zUuid.parse((req.params as any).id);
    await assertOwner(app, sandboxId, me.id);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(1000).nullable().optional()
      })
      .parse(req.body);
    return await app.prisma.sandbox.update({
      where: { id: sandboxId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {})
      }
    });
  });

  // DELETE /api/sandboxes/:id — удалить песочницу (всё связанное уйдёт каскадом)
  app.delete("/:id", async (req) => {
    const me = assertAuthed(req);
    const sandboxId = zUuid.parse((req.params as any).id);
    await assertOwner(app, sandboxId, me.id);
    await app.prisma.sandbox.delete({ where: { id: sandboxId } });
    return { ok: true };
  });

  // POST /api/sandboxes/:id/members — добавить участника
  app.post("/:id/members", async (req) => {
    const me = assertAuthed(req);
    const sandboxId = zUuid.parse((req.params as any).id);
    await assertOwner(app, sandboxId, me.id);
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        role: z.nativeEnum(SandboxMemberRole).default(SandboxMemberRole.EDITOR)
      })
      .parse(req.body);

    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      const err: any = new Error("USER_NOT_FOUND");
      err.statusCode = 404;
      throw err;
    }
    if (user.id === me.id) {
      const err: any = new Error("CANNOT_ADD_SELF");
      err.statusCode = 400;
      throw err;
    }

    const member = await app.prisma.sandboxMember.upsert({
      where: { sandboxId_userId: { sandboxId, userId: user.id } },
      update: { role: body.role },
      create: { sandboxId, userId: user.id, role: body.role }
    });

    return {
      ok: true,
      member: {
        userId: member.userId,
        role: member.role,
        email: user.email,
        displayName: user.displayName
      }
    };
  });

  // DELETE /api/sandboxes/:id/members/:userId — удалить участника
  app.delete("/:id/members/:userId", async (req) => {
    const me = assertAuthed(req);
    const sandboxId = zUuid.parse((req.params as any).id);
    const userId = zUuid.parse((req.params as any).userId);
    await assertOwner(app, sandboxId, me.id);
    await app.prisma.sandboxMember.deleteMany({ where: { sandboxId, userId } });
    return { ok: true };
  });

  // GET /api/sandboxes/:id/diff?from&to — предпросмотр переноса в прод
  app.get("/:id/diff", async (req) => {
    const me = assertAuthed(req);
    const sandboxId = zUuid.parse((req.params as any).id);
    await assertMember(app, sandboxId, me.id);
    const query = z
      .object({
        from: zDateTime.optional(),
        to: zDateTime.optional()
      })
      .parse(req.query ?? {});

    const from = query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const [sandboxEvents, prodEvents] = await Promise.all([
      app.prisma.maintenanceEvent.findMany({
        where: {
          sandboxId,
          startAt: { lt: to },
          endAt: { gt: from }
        },
        include: {
          aircraft: { select: { tailNumber: true } },
          eventType: { select: { name: true, color: true } },
          hangar: { select: { name: true } },
          reservation: { include: { stand: { select: { code: true, name: true } } } }
        },
        orderBy: [{ startAt: "asc" }]
      }),
      app.prisma.maintenanceEvent.findMany({
        where: {
          sandboxId: null,
          startAt: { lt: to },
          endAt: { gt: from },
          status: { not: EventStatus.CANCELLED }
        },
        include: {
          aircraft: { select: { tailNumber: true } },
          eventType: { select: { name: true } },
          hangar: { select: { name: true } },
          reservation: { include: { stand: { select: { code: true } } } }
        },
        orderBy: [{ startAt: "asc" }]
      })
    ]);

    type DiffItem = {
      sandboxEventId: string;
      title: string;
      aircraftLabel: string;
      eventTypeName: string | null;
      hangarName: string | null;
      standCode: string | null;
      startAt: string;
      endAt: string;
      status: EventStatus;
      category: "newOnly" | "conflictSameStand" | "cancelled";
      conflicts: Array<{
        prodEventId: string;
        title: string;
        aircraftLabel: string;
        standCode: string | null;
        startAt: string;
        endAt: string;
      }>;
    };

    const items: DiffItem[] = [];
    for (const se of sandboxEvents) {
      const label =
        se.aircraft?.tailNumber ?? ((se.virtualAircraft as any)?.label as string | undefined) ?? "—";
      const standCode = se.reservation?.stand?.code ?? null;
      const conflicts = prodEvents
        .filter((pe) => {
          if (!se.reservation || !pe.reservation) return false;
          if (se.reservation.standId !== pe.reservation.standId) return false;
          return se.reservation.startAt < pe.reservation.endAt && se.reservation.endAt > pe.reservation.startAt;
        })
        .map((pe) => ({
          prodEventId: pe.id,
          title: pe.title,
          aircraftLabel:
            pe.aircraft?.tailNumber ?? ((pe.virtualAircraft as any)?.label as string | undefined) ?? "—",
          standCode: pe.reservation?.stand?.code ?? null,
          startAt: pe.startAt.toISOString(),
          endAt: pe.endAt.toISOString()
        }));

      items.push({
        sandboxEventId: se.id,
        title: se.title,
        aircraftLabel: label,
        eventTypeName: se.eventType?.name ?? null,
        hangarName: se.hangar?.name ?? null,
        standCode,
        startAt: se.startAt.toISOString(),
        endAt: se.endAt.toISOString(),
        status: se.status,
        category: se.status === EventStatus.CANCELLED ? "cancelled" : conflicts.length > 0 ? "conflictSameStand" : "newOnly",
        conflicts
      });
    }

    return {
      ok: true,
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        total: items.length,
        newOnly: items.filter((i) => i.category === "newOnly").length,
        conflictSameStand: items.filter((i) => i.category === "conflictSameStand").length,
        cancelled: items.filter((i) => i.category === "cancelled").length,
        prodEventsInRange: prodEvents.length
      },
      items
    };
  });

  // POST /api/sandboxes/:id/promote — применить перенос в прод
  app.post("/:id/promote", async (req) => {
    const me = assertAuthed(req);
    const sandboxId = zUuid.parse((req.params as any).id);
    const role = await assertMember(app, sandboxId, me.id);
    if (!canWriteRole(role)) {
      const err: any = new Error("FORBIDDEN");
      err.statusCode = 403;
      throw err;
    }

    const body = z
      .object({
        from: zDateTime,
        to: zDateTime,
        items: z
          .array(
            z.object({
              sandboxEventId: zUuid,
              action: z.enum(["add", "skip"])
            })
          )
          .min(1)
          .max(5000),
        deleteProdInRange: z.boolean().default(false)
      })
      .refine((v) => v.to > v.from, { message: "to must be after from" })
      .parse(req.body);

    const actor = getActor(req);
    const selectedIds = body.items.filter((i) => i.action === "add").map((i) => i.sandboxEventId);

    const result = await app.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        let deletedProd = 0;
        if (body.deleteProdInRange) {
          const toDelete = await tx.maintenanceEvent.findMany({
            where: {
              sandboxId: null,
              startAt: { lt: body.to },
              endAt: { gt: body.from }
            },
            select: { id: true }
          });
          if (toDelete.length > 0) {
            await tx.maintenanceEvent.deleteMany({ where: { id: { in: toDelete.map((e) => e.id) } } });
            deletedProd = toDelete.length;
          }
        }

        // Скопируем выбранные события (подмножество из песочницы)
        const sourceEvents = await tx.maintenanceEvent.findMany({
          where: {
            id: { in: selectedIds },
            sandboxId
          }
        });

        if (sourceEvents.length === 0) {
          return { promoted: 0, deletedProd, createdReservations: 0, createdTows: 0 };
        }

        const eventIdMap = new Map<string, string>();
        for (const src of sourceEvents) eventIdMap.set(src.id, randomUUID());

        await tx.maintenanceEvent.createMany({
          data: sourceEvents.map((src) => ({
            id: eventIdMap.get(src.id)!,
            sandboxId: null,
            level: src.level,
            status: src.status,
            title: src.title,
            aircraftId: src.aircraftId,
            eventTypeId: src.eventTypeId,
            virtualAircraft: (src.virtualAircraft as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
            startAt: src.startAt,
            endAt: src.endAt,
            hangarId: src.hangarId,
            layoutId: src.layoutId,
            notes: src.notes
          }))
        });

        await tx.maintenanceEventAudit.createMany({
          data: sourceEvents.map((src) => ({
            eventId: eventIdMap.get(src.id)!,
            sandboxId: null,
            action: EventAuditAction.CREATE,
            actor,
            reason: "Перенос из песочницы",
            changes: {
              promotedFrom: {
                sourceSandboxId: sandboxId,
                sourceEventId: src.id
              }
            } as Prisma.InputJsonValue
          }))
        });

        const srcIds = Array.from(eventIdMap.keys());

        const reservations = await tx.standReservation.findMany({
          where: { eventId: { in: srcIds }, sandboxId }
        });
        let createdReservations = 0;
        if (reservations.length > 0) {
          // Проверяем, какие eventId уже имеют резерв в проде
          const mappedEventIds = reservations.map((r) => eventIdMap.get(r.eventId)!);
          const existing = await tx.standReservation.findMany({
            where: { eventId: { in: mappedEventIds } },
            select: { eventId: true }
          });
          const existingSet = new Set(existing.map((e) => e.eventId));
          const toCreate = reservations
            .filter((r) => !existingSet.has(eventIdMap.get(r.eventId)!))
            .map((r) => ({
              eventId: eventIdMap.get(r.eventId)!,
              sandboxId: null,
              layoutId: r.layoutId,
              standId: r.standId,
              startAt: r.startAt,
              endAt: r.endAt
            }));
          if (toCreate.length > 0) {
            const c = await tx.standReservation.createMany({ data: toCreate });
            createdReservations = c.count;
          }
        }

        const tows = await tx.eventTow.findMany({
          where: { eventId: { in: srcIds }, sandboxId }
        });
        let createdTows = 0;
        if (tows.length > 0) {
          const c = await tx.eventTow.createMany({
            data: tows.map((t) => ({
              eventId: eventIdMap.get(t.eventId)!,
              sandboxId: null,
              startAt: t.startAt,
              endAt: t.endAt
            }))
          });
          createdTows = c.count;
        }

        return {
          promoted: eventIdMap.size,
          deletedProd,
          createdReservations,
          createdTows
        };
      },
      { timeout: 120_000, maxWait: 15_000 }
    );

    return { ok: true, ...result };
  });
};
