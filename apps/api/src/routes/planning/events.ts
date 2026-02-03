import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, EventStatus, PlanningLevel, Prisma } from "@prisma/client";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

function diffEvent(before: any, after: any) {
  const fields = [
    "title",
    "level",
    "status",
    "aircraftId",
    "eventTypeId",
    "startAt",
    "endAt",
    "hangarId",
    "layoutId",
    "notes"
  ] as const;

  const changes: Record<string, { from: any; to: any }> = {};
  for (const f of fields) {
    const b = before[f];
    const a = after[f];
    const bv = b instanceof Date ? b.toISOString() : b;
    const av = a instanceof Date ? a.toISOString() : a;
    if (bv !== av) changes[f] = { from: bv ?? null, to: av ?? null };
  }
  return changes;
}

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  // Важно для производительности: UI будет запрашивать события по диапазону дат
  app.get("/", async (req) => {
    assertPermission(req, "events:read");
    const query = z
      .object({
        from: zDateTime.optional(),
        to: zDateTime.optional(),
        hangarId: zUuid.optional(),
        layoutId: zUuid.optional(),
        aircraftId: zUuid.optional(),
        aircraftTypeId: zUuid.optional(),
        level: z.nativeEnum(PlanningLevel).optional()
      })
      .parse(req.query ?? {});

    const from = query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ?? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    return await app.prisma.maintenanceEvent.findMany({
      where: {
        ...(query.level ? { level: query.level } : {}),
        ...(query.hangarId ? { hangarId: query.hangarId } : {}),
        ...(query.layoutId ? { layoutId: query.layoutId } : {}),
        ...(query.aircraftId ? { aircraftId: query.aircraftId } : {}),
        ...(query.aircraftTypeId ? { aircraft: { typeId: query.aircraftTypeId } } : {}),
        // пересечение диапазонов [startAt, endAt)
        startAt: { lt: to },
        endAt: { gt: from }
      },
      include: {
        aircraft: { include: { operator: true, type: true } },
        eventType: true,
        hangar: true,
        layout: true,
        reservation: { include: { stand: true } }
      },
      orderBy: [{ startAt: "asc" }]
    });
  });

  // Импорт событий из Excel/CSV (UI парсит файл и отправляет строки в JSON).
  // Поддерживает dryRun=true для "предпросмотра" без создания.
  app.post("/import", async (req) => {
    assertPermission(req, "events:write");

    const body = z
      .object({
        dryRun: z.boolean().optional(),
        rows: z
          .array(
            z.object({
              Operator: z.string().optional(),
              Aircraft: z.string(),
              AircraftType: z.string().optional(),
              Event_Title: z.string().optional(),
              Event_name: z.string(),
              startAt: z.union([z.string(), z.date(), z.number()]),
              endAt: z.union([z.string(), z.date(), z.number()]),
              Hangar: z.string().optional(),
              HangarStand: z.string().optional()
            })
          )
          .min(1)
          .max(5000)
      })
      .parse(req.body);

    const norm = (s: unknown) =>
      String(s ?? "")
        .trim()
        .replace(/^"+|"+$/g, "");

    const upper = (s: unknown) => norm(s).toUpperCase();
    const lower = (s: unknown) => norm(s).toLowerCase();

    const parseDate = (v: string | number | Date) => {
      if (v instanceof Date) return v;
      if (typeof v === "number") {
        // Excel serial date (дни с 1899-12-30)
        const ms = Math.round((v - 25569) * 86400 * 1000);
        return new Date(ms);
      }
      return new Date(v);
    };

    const rows = body.rows;
    const dryRun = Boolean(body.dryRun);

    // --- Prefetch справочников/связей для быстрого импорта ---
    const tailSet = new Set<string>();
    const eventKeySet = new Set<string>();
    const hangarKeySet = new Set<string>();
    const hangarStandPairs: Array<{ hangarKey: string; standCode: string }> = [];

    for (const r of rows) {
      tailSet.add(upper(r.Aircraft));
      eventKeySet.add(lower(r.Event_name));
      const hk = lower(r.Hangar);
      if (hk) hangarKeySet.add(hk);
      const sc = upper(r.HangarStand);
      if (hk && sc) hangarStandPairs.push({ hangarKey: hk, standCode: sc });
    }

    const [aircraftAll, eventTypesAll, hangarsAll] = await Promise.all([
      app.prisma.aircraft.findMany({ include: { operator: true, type: true } }),
      app.prisma.eventType.findMany(),
      app.prisma.hangar.findMany()
    ]);

    const aircraftByTail = new Map<string, (typeof aircraftAll)[number]>();
    for (const a of aircraftAll) aircraftByTail.set(String(a.tailNumber).toUpperCase(), a);

    const eventTypeByKey = new Map<string, (typeof eventTypesAll)[number]>();
    for (const et of eventTypesAll) {
      eventTypeByKey.set(String(et.name).toLowerCase(), et);
      eventTypeByKey.set(String(et.code).toLowerCase(), et);
    }

    const hangarByKey = new Map<string, (typeof hangarsAll)[number]>();
    for (const h of hangarsAll) {
      hangarByKey.set(String(h.name).toLowerCase(), h);
      hangarByKey.set(String(h.code).toLowerCase(), h);
    }

    // Стенды: для указанных ангаров тащим все места, затем матчим по коду в памяти
    const hangarIds = Array.from(new Set(Array.from(hangarKeySet).map((k) => hangarByKey.get(k)?.id).filter(Boolean))) as string[];
    const standAll =
      hangarIds.length > 0
        ? await app.prisma.hangarStand.findMany({
            where: { layout: { hangarId: { in: hangarIds } } },
            select: { id: true, code: true, layoutId: true, layout: { select: { hangarId: true } } }
          })
        : [];
    const standsByHangarAndCode = new Map<string, Array<(typeof standAll)[number]>>();
    for (const s of standAll) {
      const key = `${s.layout.hangarId}|${String(s.code).toUpperCase()}`;
      const arr = standsByHangarAndCode.get(key) ?? [];
      arr.push(s);
      standsByHangarAndCode.set(key, arr);
    }

    // Подготовим выборку резервов по всем потенциальным стендам в общем диапазоне дат файла
    let minStart = new Date("2100-01-01T00:00:00.000Z");
    let maxEnd = new Date("1970-01-01T00:00:00.000Z");
    const candidateStandIds = new Set<string>();
    for (const r of rows) {
      const hk = lower(r.Hangar);
      const sc = upper(r.HangarStand);
      if (!hk || !sc) continue;
      const h = hangarByKey.get(hk);
      if (!h) continue;
      const standKey = `${h.id}|${sc}`;
      const stands = standsByHangarAndCode.get(standKey) ?? [];
      if (stands.length === 1) candidateStandIds.add(stands[0]!.id);
      const sAt = parseDate(r.startAt);
      const eAt = parseDate(r.endAt);
      if (Number.isFinite(sAt.valueOf()) && sAt < minStart) minStart = sAt;
      if (Number.isFinite(eAt.valueOf()) && eAt > maxEnd) maxEnd = eAt;
    }

    const existingReservations =
      candidateStandIds.size > 0 && Number.isFinite(minStart.valueOf()) && Number.isFinite(maxEnd.valueOf()) && maxEnd > minStart
        ? await app.prisma.standReservation.findMany({
            where: {
              standId: { in: Array.from(candidateStandIds) },
              startAt: { lt: maxEnd },
              endAt: { gt: minStart },
              event: { status: { not: EventStatus.CANCELLED } }
            },
            include: { event: { include: { aircraft: true } } }
          })
        : [];

    const reservationsByStand = new Map<string, typeof existingReservations>();
    for (const r of existingReservations) {
      const arr = reservationsByStand.get(r.standId) ?? [];
      arr.push(r);
      reservationsByStand.set(r.standId, arr);
    }

    const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

    const previewRows: Array<{
      rowIndex: number;
      ok: boolean;
      title?: string;
      startAt?: string;
      endAt?: string;
      aircraftTail?: string;
      eventTypeKey?: string;
      hangar?: string | null;
      stand?: string | null;
      warnings?: string[];
      error?: string;
    }> = [];

    // Для импорта без dryRun: будем учитывать конфликты "внутри файла"
    const plannedReservations: Array<{ standId: string; startAt: Date; endAt: Date; label: string }> = [];

    let wouldCreateEvents = 0;
    let wouldCreateReservations = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const rowIndex = i + 2; // предположим 1-я строка — заголовок
      const warnings: string[] = [];
      try {
        const aircraftTail = upper(r.Aircraft);
        const eventKey = lower(r.Event_name);
        const title = norm(r.Event_Title) || norm(r.Event_name) || "Событие";
        const hangarStr = norm(r.Hangar);
        const standCode = upper(r.HangarStand);

        const startAt = parseDate(r.startAt);
        const endAt = parseDate(r.endAt);
        if (!Number.isFinite(startAt.valueOf()) || !Number.isFinite(endAt.valueOf())) {
          throw new Error(`Некорректные даты startAt/endAt: ${String(r.startAt)} / ${String(r.endAt)}`);
        }
        if (endAt <= startAt) throw new Error("endAt должен быть позже startAt");

        const aircraft = aircraftByTail.get(aircraftTail);
        if (!aircraft) throw new Error(`Не найден борт: ${aircraftTail}`);

        const eventType = eventTypeByKey.get(eventKey);
        if (!eventType) throw new Error(`Не найден тип события (Event_name): ${norm(r.Event_name)}`);

        // предупреждения по колонкам Operator/AircraftType (если есть)
        const opStr = norm((r as any).Operator);
        if (opStr && aircraft.operator?.name && opStr.toLowerCase() !== String(aircraft.operator.name).toLowerCase() && opStr.toLowerCase() !== String(aircraft.operator.code ?? "").toLowerCase()) {
          warnings.push(`Operator не совпадает с бортом: в файле "${opStr}", в справочнике "${aircraft.operator.name}"`);
        }
        const typeStr = norm((r as any).AircraftType);
        if (typeStr && aircraft.type?.name) {
          const t = typeStr.toLowerCase();
          const tName = String(aircraft.type.name).toLowerCase();
          const tIcao = String((aircraft.type as any).icaoType ?? "").toLowerCase();
          if (t !== tName && t !== tIcao) warnings.push(`AircraftType не совпадает с бортом: в файле "${typeStr}", в справочнике "${aircraft.type.name}"`);
        }

        const hangar = hangarStr ? hangarByKey.get(hangarStr.toLowerCase()) ?? null : null;
        if (hangarStr && !hangar) throw new Error(`Не найден ангар: ${hangarStr}`);

        let resolvedStand: { standId: string; layoutId: string } | null = null;
        if (standCode) {
          if (!hangar) throw new Error("Указано HangarStand, но не указан/не найден Hangar (нужен для поиска места)");
          const key = `${hangar.id}|${standCode}`;
          const stands = standsByHangarAndCode.get(key) ?? [];
          if (stands.length === 0) throw new Error(`Не найдено место ${standCode} в ангаре ${hangar.name}`);
          if (stands.length > 1) throw new Error(`Место ${standCode} неоднозначно (найдено ${stands.length} вариантов в ангаре ${hangar.name})`);
          resolvedStand = { standId: stands[0]!.id, layoutId: stands[0]!.layoutId };

          // конфликты с существующими резервами
          const rs = reservationsByStand.get(resolvedStand.standId) ?? [];
          const conflict = rs.find((x: any) => overlaps(startAt, endAt, x.startAt, x.endAt));
          if (conflict) {
            throw new Error(
              `Конфликт резерва места ${standCode}: уже занято событием ${conflict.event.title} (${conflict.event.aircraft.tailNumber})`
            );
          }

          // конфликты внутри самого файла (если импортируем реально)
          const selfConflict = plannedReservations.find((x) => x.standId === resolvedStand!.standId && overlaps(startAt, endAt, x.startAt, x.endAt));
          if (selfConflict) {
            throw new Error(`Конфликт внутри файла по месту ${standCode}: пересекается с "${selfConflict.label}"`);
          }
        }

        previewRows.push({
          rowIndex,
          ok: true,
          title,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          aircraftTail,
          eventTypeKey: norm(r.Event_name),
          hangar: hangar?.name ?? null,
          stand: standCode || null,
          warnings
        });

        wouldCreateEvents += 1;
        if (resolvedStand) {
          wouldCreateReservations += 1;
          plannedReservations.push({ standId: resolvedStand.standId, startAt, endAt, label: `${aircraftTail} • ${title}` });
        }
      } catch (err: any) {
        previewRows.push({
          rowIndex,
          ok: false,
          aircraftTail: upper((r as any).Aircraft),
          eventTypeKey: norm((r as any).Event_name),
          warnings,
          error: String(err?.message ?? err)
        });
      }
    }

    const summary = {
      dryRun,
      totalRows: rows.length,
      okRows: previewRows.filter((r) => r.ok).length,
      errorRows: previewRows.filter((r) => !r.ok).length,
      wouldCreateEvents,
      wouldCreateReservations
    };

    if (dryRun) {
      return { ok: true as const, summary, rows: previewRows };
    }

    // Реальный импорт: создаём только ok-строки
    const result = {
      ok: true as const,
      createdEvents: 0,
      createdReservations: 0,
      errors: [] as Array<{ rowIndex: number; message: string }>
    };

    for (let i = 0; i < previewRows.length; i++) {
      if (!previewRows[i]!.ok) continue;
      const r = rows[i]!;
      const rowIndex = previewRows[i]!.rowIndex;
      try {
        const aircraftTail = upper(r.Aircraft);
        const eventKey = lower(r.Event_name);
        const title = norm(r.Event_Title) || norm(r.Event_name) || "Событие";
        const hangarStr = norm(r.Hangar);
        const standCode = upper(r.HangarStand);
        const startAt = parseDate(r.startAt);
        const endAt = parseDate(r.endAt);

        const aircraft = aircraftByTail.get(aircraftTail)!;
        const eventType = eventTypeByKey.get(eventKey)!;
        const hangar = hangarStr ? hangarByKey.get(hangarStr.toLowerCase()) ?? null : null;

        await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const created = await tx.maintenanceEvent.create({
            data: {
              level: PlanningLevel.OPERATIONAL,
              status: EventStatus.PLANNED,
              title,
              aircraftId: aircraft.id,
              eventTypeId: eventType.id,
              startAt,
              endAt,
              hangarId: hangar?.id ?? null
            }
          });

          await tx.maintenanceEventAudit.create({
            data: {
              eventId: created.id,
              action: EventAuditAction.CREATE,
              actor: getActor(req),
              reason: "Импорт из Excel",
              changes: {
                imported: {
                  Operator: norm((r as any).Operator),
                  Aircraft: aircraftTail,
                  AircraftType: norm((r as any).AircraftType),
                  Event_Title: norm((r as any).Event_Title),
                  Event_name: norm((r as any).Event_name),
                  startAt: startAt.toISOString(),
                  endAt: endAt.toISOString(),
                  Hangar: hangarStr,
                  HangarStand: standCode
                }
              }
            }
          });

          if (standCode) {
            if (!hangar) throw new Error("Указано HangarStand, но не указан/не найден Hangar");
            const key = `${hangar.id}|${standCode}`;
            const stands = standsByHangarAndCode.get(key) ?? [];
            if (stands.length !== 1) throw new Error(`Место ${standCode} неоднозначно/не найдено для ангара ${hangar.name}`);
            const stand = stands[0]!;

            // Повторно проверим конфликт на случай параллельных изменений (дешево: standId + диапазон)
            const conflict = await tx.standReservation.findFirst({
              where: {
                standId: stand.id,
                startAt: { lt: endAt },
                endAt: { gt: startAt },
                event: { status: { not: EventStatus.CANCELLED } }
              },
              include: { event: { include: { aircraft: true } } }
            });
            if (conflict) {
              throw new Error(
                `Конфликт резерва места ${standCode}: уже занято событием ${conflict.event.title} (${conflict.event.aircraft.tailNumber})`
              );
            }

            await tx.standReservation.create({
              data: { eventId: created.id, layoutId: stand.layoutId, standId: stand.id, startAt, endAt }
            });

            await tx.maintenanceEvent.update({
              where: { id: created.id },
              data: { layoutId: stand.layoutId, hangarId: hangar.id }
            });

            result.createdReservations += 1;
          }

          result.createdEvents += 1;
        });
      } catch (err: any) {
        result.errors.push({ rowIndex, message: String(err?.message ?? err) });
      }
    }

    return result;
  });

  app.post("/", async (req) => {
    assertPermission(req, "events:write");
    const body = z
      .object({
        level: z.nativeEnum(PlanningLevel),
        status: z.nativeEnum(EventStatus).optional(),
        title: z.string().trim().min(1).max(300),
        aircraftId: zUuid,
        eventTypeId: zUuid,
        startAt: zDateTime,
        endAt: zDateTime,
        hangarId: zUuid.optional(),
        layoutId: zUuid.optional(),
        notes: z.string().trim().min(1).max(5000).nullable().optional(),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" })
      .parse(req.body);

    const { changeReason, ...data } = body;
    const created = await app.prisma.maintenanceEvent.create({ data });

    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId: created.id,
        action: EventAuditAction.CREATE,
        actor: getActor(req),
        reason: changeReason ?? "Создание события",
        changes: {
          created: {
            title: created.title,
            level: created.level,
            status: created.status,
            aircraftId: created.aircraftId,
            eventTypeId: created.eventTypeId,
            startAt: created.startAt.toISOString(),
            endAt: created.endAt.toISOString(),
            hangarId: created.hangarId ?? null,
            layoutId: created.layoutId ?? null
          }
        }
      }
    });

    return created;
  });

  app.patch("/:id", async (req) => {
    assertPermission(req, "events:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        level: z.nativeEnum(PlanningLevel).optional(),
        status: z.nativeEnum(EventStatus).optional(),
        title: z.string().trim().min(1).max(300).optional(),
        aircraftId: zUuid.optional(),
        eventTypeId: zUuid.optional(),
        startAt: zDateTime.optional(),
        endAt: zDateTime.optional(),
        hangarId: zUuid.nullable().optional(),
        layoutId: zUuid.nullable().optional(),
        notes: z.string().trim().min(1).max(5000).nullable().optional(),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .parse(req.body);

    // если меняем время — обновим связанный резерв (если он есть и совпадал)
    const existing = await app.prisma.maintenanceEvent.findUniqueOrThrow({
      where: { id },
      include: { reservation: true }
    });

    const { changeReason, ...patch } = body;

    const nextStart = body.startAt ?? existing.startAt;
    const nextEnd = body.endAt ?? existing.endAt;
    if (nextEnd <= nextStart) {
      throw app.httpErrors.badRequest("endAt must be after startAt");
    }

    const updated = await app.prisma.maintenanceEvent.update({
      where: { id },
      data: patch
    });

    if (existing.reservation) {
      // аккуратно: пока предполагаем что резерв следует времени события.
      // Позже можно сделать флаг "lockReservationTimes".
      const conflict = await app.prisma.standReservation.findFirst({
        where: {
          standId: existing.reservation.standId,
          eventId: { not: id },
          startAt: { lt: nextEnd },
          endAt: { gt: nextStart },
          event: { status: { not: EventStatus.CANCELLED } }
        },
        include: { event: { include: { aircraft: true } } }
      });

      if (conflict) {
        throw app.httpErrors.conflict(
          `Место уже занято в этот период: ${conflict.event.title} (${conflict.event.aircraft.tailNumber})`
        );
      }

      await app.prisma.standReservation.update({
        where: { eventId: id },
        data: { startAt: nextStart, endAt: nextEnd }
      });
    }

    const changes = diffEvent(existing, updated);
    const changedKeys = Object.keys(changes);
    if (changedKeys.length > 0 && !changeReason) {
      throw app.httpErrors.badRequest("changeReason is required when updating an event");
    }

    if (changedKeys.length > 0) {
      await app.prisma.maintenanceEventAudit.create({
        data: {
          eventId: id,
          action: EventAuditAction.UPDATE,
          actor: getActor(req),
          reason: changeReason ?? null,
          changes
        }
      });
    }

    return updated;
  });

  app.get("/:id/history", async (req) => {
    const id = zUuid.parse((req.params as any).id);
    return await app.prisma.maintenanceEventAudit.findMany({
      where: { eventId: id },
      orderBy: { createdAt: "desc" }
    });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req, "events:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.maintenanceEvent.delete({ where: { id } });
    return { ok: true };
  });
};

