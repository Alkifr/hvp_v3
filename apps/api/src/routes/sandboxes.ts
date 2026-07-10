import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, EventStatus, Prisma, SandboxMemberRole, UserActivityAction } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { zDateTime, zUuid } from "../lib/zod.js";
import { copyPlanToSandbox, eventFingerprint, resolveOriginEventId } from "../lib/sandboxCopy.js";
import { logUserActivity } from "../lib/userActivity.js";

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
        await logUserActivity(tx, {
          userId: me.id,
          actor,
          action: UserActivityAction.SANDBOX_CREATE,
          title: `Песочница «${sandbox.name}»`,
          reason: copyFrom === "empty" ? "Создание пустой песочницы" : "Создание песочницы с копированием плана",
          sourceKind: "sandbox",
          sandboxId: sandbox.id,
          sandboxName: sandbox.name,
          changes: {
            sandbox: { id: sandbox.id, name: sandbox.name },
            copyFrom,
            copied: copiedCounts
          }
        });
        return { sandbox, copiedCounts };
      },
      { timeout: 120_000, maxWait: 15_000 }
    );

    return { ok: true, sandbox: result.sandbox, copied: result.copiedCounts };
  });

  // POST /api/sandboxes/merge/preview — предпросмотр слияния нескольких песочниц
  // Важно: регистрируем ДО /:id, иначе "merge" попадёт в param.
  app.post("/merge/preview", async (req) => {
    const me = assertAuthed(req);
    const body = z
      .object({
        sourceSandboxIds: z.array(zUuid).min(2).max(20),
        range: z
          .object({
            from: zDateTime.optional(),
            to: zDateTime.optional()
          })
          .optional()
      })
      .parse(req.body);

    const uniqueIds = Array.from(new Set(body.sourceSandboxIds));
    if (uniqueIds.length < 2) {
      const err: any = new Error("Нужно выбрать минимум две разные песочницы");
      err.statusCode = 400;
      throw err;
    }

    const sourcesMeta: Array<{ id: string; name: string; role: "OWNER" | "EDITOR" | "VIEWER"; eventCount: number }> = [];
    for (const id of uniqueIds) {
      const role = await assertMember(app, id, me.id);
      if (!canWriteRole(role)) {
        const err: any = new Error(`Нет прав на редактирование песочницы ${id}`);
        err.statusCode = 403;
        throw err;
      }
      const sb = await app.prisma.sandbox.findUnique({
        where: { id },
        select: { id: true, name: true, _count: { select: { events: true } } }
      });
      sourcesMeta.push({ id, name: sb?.name ?? id, role, eventCount: sb?._count.events ?? 0 });
    }

    const rangeWhere: Prisma.MaintenanceEventWhereInput = {};
    if (body.range?.from) rangeWhere.endAt = { gt: body.range.from };
    if (body.range?.to) rangeWhere.startAt = { lt: body.range.to };

    type Cand = {
      sandboxId: string;
      sandboxName: string;
      eventId: string;
      title: string;
      aircraftLabel: string;
      eventTypeName: string | null;
      startAt: string;
      endAt: string;
      updatedAt: string;
      originEventId: string | null;
      fingerprint: string;
      standIds: string[];
    };

    const candidates: Cand[] = [];
    for (const meta of sourcesMeta) {
      const events = await app.prisma.maintenanceEvent.findMany({
        where: { sandboxId: meta.id, ...rangeWhere },
        include: {
          aircraft: { select: { tailNumber: true } },
          eventType: { select: { name: true } },
          reservations: { select: { standId: true, startAt: true, endAt: true } }
        },
        orderBy: [{ updatedAt: "desc" }]
      });
      for (const ev of events) {
        candidates.push({
          sandboxId: meta.id,
          sandboxName: meta.name,
          eventId: ev.id,
          title: ev.title,
          aircraftLabel:
            ev.aircraft?.tailNumber ?? ((ev.virtualAircraft as any)?.label as string | undefined) ?? "—",
          eventTypeName: ev.eventType?.name ?? null,
          startAt: ev.startAt.toISOString(),
          endAt: ev.endAt.toISOString(),
          updatedAt: ev.updatedAt.toISOString(),
          originEventId: resolveOriginEventId(ev),
          fingerprint: eventFingerprint(ev),
          standIds: ev.reservations.map((r) => r.standId)
        });
      }
    }

    const byOrigin = new Map<string, Cand[]>();
    const byFingerprint = new Map<string, Cand[]>();
    for (const c of candidates) {
      if (c.originEventId) {
        const arr = byOrigin.get(c.originEventId) ?? [];
        arr.push(c);
        byOrigin.set(c.originEventId, arr);
      } else {
        const arr = byFingerprint.get(c.fingerprint) ?? [];
        arr.push(c);
        byFingerprint.set(c.fingerprint, arr);
      }
    }

    type DupGroup = {
      key: string;
      kind: "origin" | "fingerprint";
      keep: Cand;
      skip: Cand[];
    };
    const duplicateGroups: DupGroup[] = [];
    const keepIds = new Set<string>();
    const skipIds = new Set<string>();

    const pickNewest = (items: Cand[]) =>
      [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.eventId.localeCompare(b.eventId));

    for (const [key, items] of byOrigin) {
      if (items.length < 2) {
        keepIds.add(items[0]!.eventId);
        continue;
      }
      const ordered = pickNewest(items);
      const keep = ordered[0]!;
      const skip = ordered.slice(1);
      keepIds.add(keep.eventId);
      for (const s of skip) skipIds.add(s.eventId);
      duplicateGroups.push({ key, kind: "origin", keep, skip });
    }
    for (const [key, items] of byFingerprint) {
      if (items.length < 2) {
        keepIds.add(items[0]!.eventId);
        continue;
      }
      const ordered = pickNewest(items);
      const keep = ordered[0]!;
      const skip = ordered.slice(1);
      keepIds.add(keep.eventId);
      for (const s of skip) skipIds.add(s.eventId);
      duplicateGroups.push({ key, kind: "fingerprint", keep, skip });
    }

    const kept = candidates.filter((c) => keepIds.has(c.eventId) && !skipIds.has(c.eventId));
    const standConflicts: Array<{
      a: { eventId: string; title: string; sandboxName: string; startAt: string; endAt: string };
      b: { eventId: string; title: string; sandboxName: string; startAt: string; endAt: string };
      standId: string;
    }> = [];
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        const a = kept[i]!;
        const b = kept[j]!;
        if (a.startAt >= b.endAt || a.endAt <= b.startAt) continue;
        const sharedStand = a.standIds.find((id) => b.standIds.includes(id));
        if (!sharedStand) continue;
        standConflicts.push({
          standId: sharedStand,
          a: { eventId: a.eventId, title: a.title, sandboxName: a.sandboxName, startAt: a.startAt, endAt: a.endAt },
          b: { eventId: b.eventId, title: b.title, sandboxName: b.sandboxName, startAt: b.startAt, endAt: b.endAt }
        });
      }
    }

    return {
      ok: true,
      sources: sourcesMeta,
      summary: {
        totalCandidates: candidates.length,
        wouldCopy: kept.length,
        wouldSkipDuplicates: skipIds.size,
        duplicateGroups: duplicateGroups.length,
        standConflicts: standConflicts.length
      },
      duplicateGroups: duplicateGroups.slice(0, 200),
      standConflicts: standConflicts.slice(0, 200),
      keepEventIdsBySandbox: sourcesMeta.map((s) => ({
        sandboxId: s.id,
        eventIds: kept.filter((c) => c.sandboxId === s.id).map((c) => c.eventId)
      }))
    };
  });

  // POST /api/sandboxes/merge — слияние в новую песочницу (только EDITOR+)
  app.post("/merge", async (req) => {
    const me = assertAuthed(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(1000).optional(),
        sourceSandboxIds: z.array(zUuid).min(2).max(20),
        range: z
          .object({
            from: zDateTime.optional(),
            to: zDateTime.optional()
          })
          .optional()
      })
      .parse(req.body);

    const uniqueIds = Array.from(new Set(body.sourceSandboxIds));
    if (uniqueIds.length < 2) {
      const err: any = new Error("Нужно выбрать минимум две разные песочницы");
      err.statusCode = 400;
      throw err;
    }

    for (const id of uniqueIds) {
      const role = await assertMember(app, id, me.id);
      if (!canWriteRole(role)) {
        const err: any = new Error(`Нет прав на редактирование песочницы ${id}`);
        err.statusCode = 403;
        throw err;
      }
    }

    const actor = getActor(req);
    const result = await app.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const sandbox = await tx.sandbox.create({
          data: {
            name: body.name,
            description: body.description ?? null,
            ownerId: me.id
          }
        });

        const occupiedOrigins = new Set<string>();
        const occupiedFingerprints = new Set<string>();
        const perSource: Array<{ sandboxId: string; copied: Awaited<ReturnType<typeof copyPlanToSandbox>> }> = [];

        for (const sourceId of uniqueIds) {
          const copied = await copyPlanToSandbox(tx, {
            sourceSandboxId: sourceId,
            targetSandboxId: sandbox.id,
            range: body.range,
            actor,
            skipDuplicates: true,
            occupiedOrigins,
            occupiedFingerprints
          });
          perSource.push({ sandboxId: sourceId, copied });
        }

        const totals = perSource.reduce(
          (acc, s) => {
            acc.events += s.copied.events;
            acc.reservations += s.copied.reservations;
            acc.tows += s.copied.tows;
            acc.skippedDuplicates += s.copied.skippedDuplicates;
            return acc;
          },
          { events: 0, reservations: 0, tows: 0, skippedDuplicates: 0 }
        );

        await logUserActivity(tx, {
          userId: me.id,
          actor,
          action: UserActivityAction.SANDBOX_CREATE,
          title: `Песочница «${sandbox.name}»`,
          reason: "Создание песочницы слиянием",
          sourceKind: "sandbox",
          sandboxId: sandbox.id,
          sandboxName: sandbox.name,
          changes: {
            sandbox: { id: sandbox.id, name: sandbox.name },
            mergeFrom: uniqueIds,
            totals
          }
        });

        return { sandbox, perSource, totals };
      },
      { timeout: 180_000, maxWait: 20_000 }
    );

    return { ok: true, sandbox: result.sandbox, totals: result.totals, perSource: result.perSource };
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
    const sandbox = await app.prisma.sandbox.findUnique({
      where: { id: sandboxId },
      select: { id: true, name: true, _count: { select: { events: true } } }
    });
    if (!sandbox) {
      const err: any = new Error("SANDBOX_NOT_FOUND");
      err.statusCode = 404;
      throw err;
    }
    await logUserActivity(app.prisma, {
      userId: me.id,
      actor: getActor(req),
      action: UserActivityAction.SANDBOX_DELETE,
      title: `Песочница «${sandbox.name}»`,
      reason: "Удаление песочницы",
      sourceKind: "sandbox",
      sandboxId: sandbox.id,
      sandboxName: sandbox.name,
      changes: {
        sandbox: { id: sandbox.id, name: sandbox.name },
        eventCount: sandbox._count.events
      }
    });
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
          reservations: { include: { stand: { select: { code: true, name: true } } }, orderBy: [{ startAt: "asc" }] }
        },
        orderBy: [{ startAt: "asc" }]
      }),
      app.prisma.maintenanceEvent.findMany({
        where: {
          sandboxId: null,
          startAt: { lt: to },
          endAt: { gt: from },
          status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] }
        },
        include: {
          aircraft: { select: { tailNumber: true } },
          eventType: { select: { name: true } },
          hangar: { select: { name: true } },
          reservations: { include: { stand: { select: { code: true } } }, orderBy: [{ startAt: "asc" }] }
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
      const seReservation = se.reservations[0] ?? null;
      const standCode = seReservation?.stand?.code ?? null;
      const conflicts = prodEvents
        .filter((pe) => {
          const peReservation = pe.reservations[0] ?? null;
          if (!seReservation || !peReservation) return false;
          if (seReservation.standId !== peReservation.standId) return false;
          return seReservation.startAt < peReservation.endAt && seReservation.endAt > peReservation.startAt;
        })
        .map((pe) => ({
          ...(() => {
            const peReservation = pe.reservations[0] ?? null;
            return { standCode: peReservation?.stand?.code ?? null };
          })(),
          prodEventId: pe.id,
          title: pe.title,
          aircraftLabel:
            pe.aircraft?.tailNumber ?? ((pe.virtualAircraft as any)?.label as string | undefined) ?? "—",
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
        category: se.status === EventStatus.CANCELLED || se.status === EventStatus.DELETED ? "cancelled" : conflicts.length > 0 ? "conflictSameStand" : "newOnly",
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
            planningKind: (src as any).planningKind ?? ((src as any).budgetStartAt && (src as any).budgetEndAt ? "PLANNED" : "UNPLANNED"),
            title: src.title,
            aircraftId: src.aircraftId,
            eventTypeId: src.eventTypeId,
            virtualAircraft: (src.virtualAircraft as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
            startAt: src.startAt,
            endAt: src.endAt,
            budgetStartAt: (src as any).budgetStartAt,
            budgetEndAt: (src as any).budgetEndAt,
            actualStartAt: (src as any).actualStartAt,
            actualEndAt: (src as any).actualEndAt,
            hangarId: src.hangarId,
            layoutId: src.layoutId,
            notes: src.notes,
            // В prod событие становится новым корнем; lineage указывает на sandbox-источник
            originEventId: null,
            sourceEventId: src.id,
            sourceSandboxId: sandboxId
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
                sourceEventId: src.id,
                originEventId: resolveOriginEventId(src as any)
              }
            } as Prisma.InputJsonValue
          }))
        });

        const srcIds = Array.from(eventIdMap.keys());

        const placementIdMap = new Map<string, string>();
        const sourcePlacements = await tx.eventPlacement.findMany({
          where: { eventId: { in: srcIds }, sandboxId }
        });
        if (sourcePlacements.length > 0) {
          for (const p of sourcePlacements) placementIdMap.set(p.id, randomUUID());
          await tx.eventPlacement.createMany({
            data: sourcePlacements.map((p) => ({
              id: placementIdMap.get(p.id)!,
              eventId: eventIdMap.get(p.eventId)!,
              sandboxId: null,
              startAt: p.startAt,
              endAt: p.endAt,
              budgetStartAt: p.budgetStartAt,
              budgetEndAt: p.budgetEndAt,
              actualStartAt: p.actualStartAt,
              actualEndAt: p.actualEndAt,
              hangarId: p.hangarId,
              layoutId: p.layoutId,
              standId: p.standId,
              sortOrder: p.sortOrder
            }))
          });
        }

        const reservations = await tx.standReservation.findMany({
          where: { eventId: { in: srcIds }, sandboxId }
        });
        let createdReservations = 0;
        if (reservations.length > 0) {
          const toCreate = reservations.map((r) => ({
            eventId: eventIdMap.get(r.eventId)!,
            placementId: r.placementId ? (placementIdMap.get(r.placementId) ?? null) : null,
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
