import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EventAuditAction, EventStatus, PlanningLevel, Prisma } from "@prisma/client";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { canWriteInContext, sandboxFilter, sandboxIdFor } from "../../plugins/sandbox.js";

function assertCanWrite(req: any) {
  if (!canWriteInContext(req)) {
    const err: any = new Error("SANDBOX_READ_ONLY");
    err.statusCode = 403;
    throw err;
  }
}

function assertCanWriteEvent(req: any) {
  if (req.sandbox) {
    assertCanWrite(req);
    return;
  }
  assertPermission(req, "events:write");
}

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

/** Подпись борта для сообщений (реальный или виртуальный) */
function eventAircraftLabel(event: { aircraft?: { tailNumber: string } | null; virtualAircraft?: unknown } | null): string {
  if (!event) return "—";
  if (event.aircraft?.tailNumber) return event.aircraft.tailNumber;
  const v = event.virtualAircraft as { label?: string } | null | undefined;
  return (v?.label ?? "—") as string;
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
    "budgetStartAt",
    "budgetEndAt",
    "actualStartAt",
    "actualEndAt",
    "hangarId",
    "layoutId",
    "notes",
    "virtualAircraft"
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
        ...sandboxFilter(req),
        status: { not: EventStatus.DELETED },
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
        reservation: { include: { stand: true } },
        towSegments: { orderBy: [{ startAt: "asc" }] }
      },
      orderBy: [{ startAt: "asc" }]
    });
  });

  // --- Буксировки (интервалы) ---
  app.get("/:id/tows", async (req) => {
    assertPermission(req, "events:read");
    const eventId = zUuid.parse((req.params as any).id);
    return await app.prisma.eventTow.findMany({
      where: { eventId, ...sandboxFilter(req) },
      orderBy: [{ startAt: "asc" }]
    });
  });

  app.post("/:id/tows", async (req) => {
    assertCanWriteEvent(req);
    const eventId = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        startAt: zDateTime,
        endAt: zDateTime,
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" })
      .parse(req.body);

    const ev = await app.prisma.maintenanceEvent.findFirst({
      where: { id: eventId, ...sandboxFilter(req) }
    });
    if (!ev) throw app.httpErrors.notFound("Event not found");
    if (body.startAt < ev.startAt || body.endAt > ev.endAt) {
      throw app.httpErrors.badRequest("Tow interval must be within event startAt/endAt");
    }

    const sbId = sandboxIdFor(req);
    const created = await app.prisma.eventTow.create({
      data: { eventId, startAt: body.startAt, endAt: body.endAt, sandboxId: sbId }
    });

    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId,
        sandboxId: sbId,
        action: EventAuditAction.UPDATE,
        actor: getActor(req),
        reason: body.changeReason ?? "Буксировка",
        changes: {
          tow: { add: { id: created.id, startAt: created.startAt.toISOString(), endAt: created.endAt.toISOString() } }
        }
      }
    });

    return created;
  });

  app.delete("/:id/tows/:towId", async (req) => {
    assertCanWriteEvent(req);
    const eventId = zUuid.parse((req.params as any).id);
    const towId = zUuid.parse((req.params as any).towId);
    const query = z
      .object({
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .parse((req.query ?? {}) as any);

    const existing = await app.prisma.eventTow.findFirst({
      where: { id: towId, eventId, ...sandboxFilter(req) }
    });
    if (!existing) return { ok: true, deleted: 0 };

    await app.prisma.eventTow.delete({ where: { id: towId } });
    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId,
        sandboxId: sandboxIdFor(req),
        action: EventAuditAction.UPDATE,
        actor: getActor(req),
        reason: query.changeReason ?? "Буксировка",
        changes: { tow: { delete: { id: towId } } }
      }
    });
    return { ok: true, deleted: 1 };
  });

  // Импорт событий из Excel/CSV (UI парсит файл и отправляет строки в JSON).
  // Поддерживает dryRun=true для "предпросмотра" без создания.
  app.post("/import", async (req) => {
    assertCanWriteEvent(req);

    const zOptionalDateCell = z.union([z.string(), z.date(), z.number(), z.null()]).optional();
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
              budgetStartAt: zOptionalDateCell,
              budgetEndAt: zOptionalDateCell,
              actualStartAt: zOptionalDateCell,
              actualEndAt: zOptionalDateCell,
              towStartAt: zOptionalDateCell,
              towEndAt: zOptionalDateCell,
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
        .normalize("NFKC")
        .replace(/^\uFEFF/, "")
        .replace(/\u00A0/g, " ")
        .replace(/[‐‑‒–—―−]/g, "-")
        .trim()
        .replace(/^"+|"+$/g, "");

    const key = (s: unknown) => norm(s).toLocaleLowerCase("ru-RU");
    const upper = (s: unknown) => norm(s).toLocaleUpperCase("ru-RU");
    const lower = key;

    const parseDate = (v: string | number | Date) => {
      if (v instanceof Date) return v;
      if (typeof v === "number") {
        // Excel serial date (дни с 1899-12-30)
        const ms = Math.round((v - 25569) * 86400 * 1000);
        return new Date(ms);
      }
      return new Date(v);
    };
    const parseOptionalDate = (v: string | number | Date | null | undefined, label: string) => {
      if (v == null) return null;
      if (typeof v === "string" && norm(v) === "") return null;
      const d = parseDate(v);
      if (!Number.isFinite(d.valueOf())) throw new Error(`Некорректная дата ${label}: ${String(v)}`);
      return d;
    };
    const validateOptionalPeriod = (start: Date | null, end: Date | null, label: string) => {
      if ((start && !end) || (!start && end)) throw new Error(`Заполните обе даты периода "${label}"`);
      if (start && end && end <= start) throw new Error(`Окончание периода "${label}" должно быть позже начала`);
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
      eventKeySet.add(key(r.Event_name));
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
    for (const a of aircraftAll) aircraftByTail.set(upper(a.tailNumber), a);

    const eventTypeByKey = new Map<string, (typeof eventTypesAll)[number]>();
    for (const et of eventTypesAll) {
      eventTypeByKey.set(key(et.name), et);
      if (et.code) eventTypeByKey.set(key(et.code), et);
    }

    const hangarByKey = new Map<string, (typeof hangarsAll)[number]>();
    for (const h of hangarsAll) {
      hangarByKey.set(key(h.name), h);
      if (h.code) hangarByKey.set(key(h.code), h);
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
      const standKey = `${s.layout.hangarId}|${upper(s.code)}`;
      const arr = standsByHangarAndCode.get(standKey) ?? [];
      arr.push(s);
      standsByHangarAndCode.set(standKey, arr);
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
      for (const s of stands) candidateStandIds.add(s.id);
      const sAt = parseDate(r.startAt);
      const eAt = parseDate(r.endAt);
      if (Number.isFinite(sAt.valueOf()) && sAt < minStart) minStart = sAt;
      if (Number.isFinite(eAt.valueOf()) && eAt > maxEnd) maxEnd = eAt;
    }

    const existingReservations =
      candidateStandIds.size > 0 && Number.isFinite(minStart.valueOf()) && Number.isFinite(maxEnd.valueOf()) && maxEnd > minStart
        ? await app.prisma.standReservation.findMany({
            where: {
              ...sandboxFilter(req),
              standId: { in: Array.from(candidateStandIds) },
              startAt: { lt: maxEnd },
              endAt: { gt: minStart },
              event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
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
    const existingStandConflict = (standId: string, startAt: Date, endAt: Date) => {
      const rs = reservationsByStand.get(standId) ?? [];
      return rs.find((x: any) => overlaps(startAt, endAt, x.startAt, x.endAt));
    };
    const chooseFirstAvailableStand = <T extends { id: string }>(stands: T[], startAt: Date, endAt: Date) =>
      stands.find((s) => !existingStandConflict(s.id, startAt, endAt)) ?? stands[0]!;

    const previewRows: Array<{
      rowIndex: number;
      ok: boolean;
      title?: string;
      startAt?: string;
      endAt?: string;
      budgetStartAt?: string | null;
      budgetEndAt?: string | null;
      actualStartAt?: string | null;
      actualEndAt?: string | null;
      towStartAt?: string | null;
      towEndAt?: string | null;
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
    let wouldCreateTows = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const rowIndex = i + 2; // предположим 1-я строка — заголовок
      const warnings: string[] = [];
      try {
        const aircraftTail = upper(r.Aircraft);
        const eventKey = key(r.Event_name);
        const title = norm(r.Event_Title) || norm(r.Event_name) || "Событие";
        const hangarStr = norm(r.Hangar);
        const standCode = upper(r.HangarStand);

        const startAt = parseDate(r.startAt);
        const endAt = parseDate(r.endAt);
        if (!Number.isFinite(startAt.valueOf()) || !Number.isFinite(endAt.valueOf())) {
          throw new Error(`Некорректные даты startAt/endAt: ${String(r.startAt)} / ${String(r.endAt)}`);
        }
        if (endAt <= startAt) throw new Error("endAt должен быть позже startAt");
        const budgetStartAt = parseOptionalDate(r.budgetStartAt, "budgetStartAt");
        const budgetEndAt = parseOptionalDate(r.budgetEndAt, "budgetEndAt");
        validateOptionalPeriod(budgetStartAt, budgetEndAt, "Бюджетный");
        const actualStartAt = parseOptionalDate(r.actualStartAt, "actualStartAt");
        const actualEndAt = parseOptionalDate(r.actualEndAt, "actualEndAt");
        validateOptionalPeriod(actualStartAt, actualEndAt, "Фактический");
        const towStartAt = parseOptionalDate(r.towStartAt, "towStartAt");
        const towEndAt = parseOptionalDate(r.towEndAt, "towEndAt");
        validateOptionalPeriod(towStartAt, towEndAt, "Буксировка");
        if (towStartAt && towEndAt && (towStartAt < startAt || towEndAt > endAt)) {
          throw new Error("Период буксировки должен быть внутри startAt/endAt");
        }

        const aircraft = aircraftByTail.get(aircraftTail);
        if (!aircraft) throw new Error(`Не найден борт: ${aircraftTail}`);

        const eventType = eventTypeByKey.get(eventKey);
        if (!eventType) throw new Error(`Не найден тип события (Event_name): ${norm(r.Event_name)}`);

        // предупреждения по колонкам Operator/AircraftType (если есть)
        const opStr = norm((r as any).Operator);
        if (opStr && aircraft.operator?.name && key(opStr) !== key(aircraft.operator.name) && key(opStr) !== key(aircraft.operator.code ?? "")) {
          warnings.push(`Operator не совпадает с бортом: в файле "${opStr}", в справочнике "${aircraft.operator.name}"`);
        }
        const typeStr = norm((r as any).AircraftType);
        if (typeStr && aircraft.type?.name) {
          const t = key(typeStr);
          const tName = key(aircraft.type.name);
          const tIcao = key((aircraft.type as any).icaoType ?? "");
          if (t !== tName && t !== tIcao) warnings.push(`AircraftType не совпадает с бортом: в файле "${typeStr}", в справочнике "${aircraft.type.name}"`);
        }

        const hangar = hangarStr ? hangarByKey.get(key(hangarStr)) ?? null : null;
        if (hangarStr && !hangar) throw new Error(`Не найден ангар: ${hangarStr}`);

        let resolvedStand: { standId: string; layoutId: string } | null = null;
        if (standCode) {
          if (!hangar) throw new Error("Указано HangarStand, но не указан/не найден Hangar (нужен для поиска места)");
          const key = `${hangar.id}|${standCode}`;
          const stands = standsByHangarAndCode.get(key) ?? [];
          if (stands.length === 0) throw new Error(`Не найдено место ${standCode} в ангаре ${hangar.name}`);
          const selectedStand = chooseFirstAvailableStand(stands, startAt, endAt);
          if (stands.length > 1) {
            warnings.push(
              `Место ${standCode} найдено в ${stands.length} вариантах расстановки ангара ${hangar.name}; выбран первый подходящий вариант.`
            );
          }
          resolvedStand = { standId: selectedStand.id, layoutId: selectedStand.layoutId };

          // конфликты с существующими резервами
          const conflict = existingStandConflict(resolvedStand.standId, startAt, endAt);
          if (conflict) {
            throw new Error(
              `Конфликт резерва места ${standCode}: уже занято событием ${conflict.event.title} (${eventAircraftLabel(conflict.event)})`
            );
          }

          // конфликты внутри самого файла (если импортируем реально)
          const selfConflict = plannedReservations.find((x) => x.standId === resolvedStand!.standId && overlaps(startAt, endAt, x.startAt, x.endAt));
          if (selfConflict) {
            warnings.push(`Нахлёст внутри файла по месту ${standCode}: пересекается с "${selfConflict.label}". Событие будет импортировано с нахлёстом.`);
          }
        }

        previewRows.push({
          rowIndex,
          ok: true,
          title,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          budgetStartAt: budgetStartAt?.toISOString() ?? null,
          budgetEndAt: budgetEndAt?.toISOString() ?? null,
          actualStartAt: actualStartAt?.toISOString() ?? null,
          actualEndAt: actualEndAt?.toISOString() ?? null,
          towStartAt: towStartAt?.toISOString() ?? null,
          towEndAt: towEndAt?.toISOString() ?? null,
          aircraftTail,
          eventTypeKey: norm(r.Event_name),
          hangar: hangar?.name ?? null,
          stand: standCode || null,
          warnings
        });

        wouldCreateEvents += 1;
        if (towStartAt && towEndAt) wouldCreateTows += 1;
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
      wouldCreateReservations,
      wouldCreateTows
    };

    if (dryRun) {
      return { ok: true as const, summary, rows: previewRows };
    }

    // Реальный импорт: создаём только ok-строки
    const result = {
      ok: true as const,
      createdEvents: 0,
      createdReservations: 0,
      createdTows: 0,
      errors: [] as Array<{ rowIndex: number; message: string }>
    };
    const importedEventIds = new Set<string>();

    for (let i = 0; i < previewRows.length; i++) {
      if (!previewRows[i]!.ok) continue;
      const r = rows[i]!;
      const rowIndex = previewRows[i]!.rowIndex;
      try {
        const aircraftTail = upper(r.Aircraft);
        const eventKey = key(r.Event_name);
        const title = norm(r.Event_Title) || norm(r.Event_name) || "Событие";
        const hangarStr = norm(r.Hangar);
        const standCode = upper(r.HangarStand);
        const startAt = parseDate(r.startAt);
        const endAt = parseDate(r.endAt);
        const budgetStartAt = parseOptionalDate(r.budgetStartAt, "budgetStartAt");
        const budgetEndAt = parseOptionalDate(r.budgetEndAt, "budgetEndAt");
        const actualStartAt = parseOptionalDate(r.actualStartAt, "actualStartAt");
        const actualEndAt = parseOptionalDate(r.actualEndAt, "actualEndAt");
        const towStartAt = parseOptionalDate(r.towStartAt, "towStartAt");
        const towEndAt = parseOptionalDate(r.towEndAt, "towEndAt");

        const aircraft = aircraftByTail.get(aircraftTail)!;
        const eventType = eventTypeByKey.get(eventKey)!;
        const hangar = hangarStr ? hangarByKey.get(key(hangarStr)) ?? null : null;

        const sbId = sandboxIdFor(req);
        let createdEventId = "";
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
              budgetStartAt,
              budgetEndAt,
              actualStartAt,
              actualEndAt,
              hangarId: hangar?.id ?? null,
              sandboxId: sbId
            }
          });
          createdEventId = created.id;

          await tx.maintenanceEventAudit.create({
            data: {
              eventId: created.id,
              sandboxId: sbId,
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
                  budgetStartAt: budgetStartAt?.toISOString() ?? null,
                  budgetEndAt: budgetEndAt?.toISOString() ?? null,
                  actualStartAt: actualStartAt?.toISOString() ?? null,
                  actualEndAt: actualEndAt?.toISOString() ?? null,
                  towStartAt: towStartAt?.toISOString() ?? null,
                  towEndAt: towEndAt?.toISOString() ?? null,
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
            if (stands.length === 0) throw new Error(`Место ${standCode} не найдено для ангара ${hangar.name}`);
            const stand = chooseFirstAvailableStand(stands, startAt, endAt);

            // Повторно проверим конфликт на случай параллельных изменений (дешево: standId + диапазон)
            const conflicts = await tx.standReservation.findMany({
              where: {
                sandboxId: sbId,
                standId: stand.id,
                startAt: { lt: endAt },
                endAt: { gt: startAt },
                event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
              },
              include: { event: { include: { aircraft: true } } }
            });
            const conflict = conflicts.find((r) => !importedEventIds.has(r.eventId));
            if (conflict) {
              throw new Error(
                `Конфликт резерва места ${standCode}: уже занято событием ${conflict.event.title} (${eventAircraftLabel(conflict.event)})`
              );
            }

            await tx.standReservation.create({
              data: { eventId: created.id, layoutId: stand.layoutId, standId: stand.id, startAt, endAt, sandboxId: sbId }
            });

            await tx.maintenanceEvent.update({
              where: { id: created.id },
              data: { layoutId: stand.layoutId, hangarId: hangar.id }
            });

            result.createdReservations += 1;
          }
          if (towStartAt && towEndAt) {
            await tx.eventTow.create({
              data: { eventId: created.id, sandboxId: sbId, startAt: towStartAt, endAt: towEndAt }
            });
            result.createdTows += 1;
          }

          result.createdEvents += 1;
        });
        if (createdEventId) importedEventIds.add(createdEventId);
      } catch (err: any) {
        result.errors.push({ rowIndex, message: String(err?.message ?? err) });
      }
    }

    return result;
  });

  const zVirtualAircraft = z.object({
    operatorId: zUuid,
    aircraftTypeId: zUuid,
    label: z.string().trim().min(1).max(100)
  });

  app.post("/", async (req) => {
    assertCanWriteEvent(req);
    const body = z
      .object({
        level: z.nativeEnum(PlanningLevel),
        status: z.nativeEnum(EventStatus).optional(),
        title: z.string().trim().min(1).max(300),
        aircraftId: zUuid.optional(),
        virtualAircraft: zVirtualAircraft.optional(),
        eventTypeId: zUuid,
        startAt: zDateTime,
        endAt: zDateTime,
        budgetStartAt: zDateTime.nullable().optional(),
        budgetEndAt: zDateTime.nullable().optional(),
        actualStartAt: zDateTime.nullable().optional(),
        actualEndAt: zDateTime.nullable().optional(),
        hangarId: zUuid.optional(),
        layoutId: zUuid.optional(),
        notes: z.string().trim().min(1).max(5000).nullable().optional(),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" })
      .refine((v) => Boolean(v.budgetStartAt) === Boolean(v.budgetEndAt), { message: "budget period must have both dates" })
      .refine((v) => !v.budgetStartAt || !v.budgetEndAt || v.budgetEndAt > v.budgetStartAt, {
        message: "budgetEndAt must be after budgetStartAt"
      })
      .refine((v) => Boolean(v.actualStartAt) === Boolean(v.actualEndAt), { message: "actual period must have both dates" })
      .refine((v) => !v.actualStartAt || !v.actualEndAt || v.actualEndAt > v.actualStartAt, {
        message: "actualEndAt must be after actualStartAt"
      })
      .refine((v) => v.aircraftId != null || v.virtualAircraft != null, { message: "aircraftId or virtualAircraft required" })
      .parse(req.body);

    const { changeReason, ...data } = body;
    const sbId = sandboxIdFor(req);
    const created = await app.prisma.maintenanceEvent.create({
      data: {
        ...data,
        sandboxId: sbId,
        aircraftId: data.aircraftId ?? (data.virtualAircraft ? null : undefined),
        virtualAircraft: data.virtualAircraft ? (data.virtualAircraft as object) : undefined
      }
    });

    await app.prisma.maintenanceEventAudit.create({
      data: {
        eventId: created.id,
        sandboxId: sbId,
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
            budgetStartAt: (created as any).budgetStartAt?.toISOString() ?? null,
            budgetEndAt: (created as any).budgetEndAt?.toISOString() ?? null,
            actualStartAt: (created as any).actualStartAt?.toISOString() ?? null,
            actualEndAt: (created as any).actualEndAt?.toISOString() ?? null,
            hangarId: created.hangarId ?? null,
            layoutId: created.layoutId ?? null
          }
        }
      }
    });

    return created;
  });

  app.patch("/:id", async (req) => {
    assertCanWriteEvent(req);
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
        budgetStartAt: zDateTime.nullable().optional(),
        budgetEndAt: zDateTime.nullable().optional(),
        actualStartAt: zDateTime.nullable().optional(),
        actualEndAt: zDateTime.nullable().optional(),
        hangarId: zUuid.nullable().optional(),
        layoutId: zUuid.nullable().optional(),
        notes: z.string().trim().min(1).max(5000).nullable().optional(),
        changeReason: z.string().trim().min(1).max(1000).optional()
      })
      .parse(req.body);

    const existing = await app.prisma.maintenanceEvent.findFirst({
      where: { id, ...sandboxFilter(req) },
      include: { reservation: true }
    });
    if (!existing) throw app.httpErrors.notFound("Event not found");

    const { changeReason, ...patch } = body;
    const nextStatus = body.status ?? existing.status;
    let patchData = { ...patch } as Record<string, unknown>;

    // При закрытии события (DONE/CONFIRMED) с виртуальным бортом — создаём Aircraft и привязываем
    const virtualAircraft = existing.virtualAircraft as { operatorId: string; aircraftTypeId: string; label: string } | null;
    if (
      virtualAircraft &&
      (nextStatus === EventStatus.DONE || nextStatus === EventStatus.CONFIRMED) &&
      !existing.aircraftId
    ) {
      const aircraft = await app.prisma.aircraft.create({
        data: {
          tailNumber: virtualAircraft.label,
          operatorId: virtualAircraft.operatorId,
          typeId: virtualAircraft.aircraftTypeId
        }
      });
      patchData = { ...patchData, aircraftId: aircraft.id, virtualAircraft: Prisma.JsonNull };
    }

    const nextStart = body.startAt ?? existing.startAt;
    const nextEnd = body.endAt ?? existing.endAt;
    if (nextEnd <= nextStart) {
      throw app.httpErrors.badRequest("endAt must be after startAt");
    }
    const nextBudgetStart = body.budgetStartAt === undefined ? (existing as any).budgetStartAt : body.budgetStartAt;
    const nextBudgetEnd = body.budgetEndAt === undefined ? (existing as any).budgetEndAt : body.budgetEndAt;
    if ((nextBudgetStart && !nextBudgetEnd) || (!nextBudgetStart && nextBudgetEnd)) {
      throw app.httpErrors.badRequest("budget period must have both dates");
    }
    if (nextBudgetStart && nextBudgetEnd && nextBudgetEnd <= nextBudgetStart) {
      throw app.httpErrors.badRequest("budgetEndAt must be after budgetStartAt");
    }
    const nextActualStart = body.actualStartAt === undefined ? (existing as any).actualStartAt : body.actualStartAt;
    const nextActualEnd = body.actualEndAt === undefined ? (existing as any).actualEndAt : body.actualEndAt;
    if ((nextActualStart && !nextActualEnd) || (!nextActualStart && nextActualEnd)) {
      throw app.httpErrors.badRequest("actual period must have both dates");
    }
    if (nextActualStart && nextActualEnd && nextActualEnd <= nextActualStart) {
      throw app.httpErrors.badRequest("actualEndAt must be after actualStartAt");
    }

    const updated = await app.prisma.maintenanceEvent.update({
      where: { id },
      data: patchData
    });

    if (existing.reservation) {
      const conflict = await app.prisma.standReservation.findFirst({
        where: {
          ...sandboxFilter(req),
          standId: existing.reservation.standId,
          eventId: { not: id },
          startAt: { lt: nextEnd },
          endAt: { gt: nextStart },
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        include: { event: { include: { aircraft: true } } }
      });

      if (conflict) {
        throw app.httpErrors.conflict(
          `Место уже занято в этот период: ${conflict.event.title} (${eventAircraftLabel(conflict.event)})`
        );
      }

      const layout = await app.prisma.hangarLayout.findUnique({
        where: { id: existing.reservation.layoutId },
        select: { id: true, hangarId: true }
      });
      if (layout) {
        const layoutConflict = await app.prisma.standReservation.findFirst({
          where: {
            ...sandboxFilter(req),
            eventId: { not: id },
            layoutId: { not: layout.id },
            startAt: { lt: nextEnd },
            endAt: { gt: nextStart },
            layout: { hangarId: layout.hangarId },
            event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
          },
          include: {
            layout: { select: { name: true } },
            event: { include: { aircraft: true } }
          },
          orderBy: [{ startAt: "asc" }]
        });
        if (layoutConflict) {
          throw app.httpErrors.conflict(
            `В этот период в ангаре уже используется другая схема расстановки: ${layoutConflict.layout?.name ?? "другая схема"} (${layoutConflict.event.title}, ${eventAircraftLabel(layoutConflict.event)})`
          );
        }
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
          sandboxId: sandboxIdFor(req),
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
      where: { eventId: id, ...sandboxFilter(req) },
      orderBy: { createdAt: "desc" }
    });
  });

  app.delete("/:id", async (req) => {
    assertCanWriteEvent(req);
    const id = zUuid.parse((req.params as any).id);
    const existing = await app.prisma.maintenanceEvent.findFirst({
      where: { id, ...sandboxFilter(req) },
      select: { id: true }
    });
    if (!existing) throw app.httpErrors.notFound("Event not found");
    await app.prisma.maintenanceEvent.delete({ where: { id } });
    return { ok: true };
  });
};

