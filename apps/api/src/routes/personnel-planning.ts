import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { assertAnyPermission, assertPermission } from "../lib/rbac.js";
import {
  localDateKey,
  mondayOfLocalWeek,
  mondaysCovering,
  periodDateKeys,
  PERSONNEL_DEPARTMENTS,
  qualificationsForWorkshopSkills,
  weekDateKeys
} from "../lib/personnelPlanning.js";
import { loadPersonnelResourceSheets, loadPersonnelWeekData, personnelBaselineDelta } from "../lib/personnelPlanningData.js";
import { zUuid } from "../lib/zod.js";

const zDateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zCategory = z.enum(["B1", "LBMM", "B2", "LBMA", "AM", "SM", "NDT", "SHOP", "INT", "CAB_REP", "PAINT"]);
const LOCAL_OFFSET_MINUTES = 180;
const PERSONNEL_TX = { timeout: 30_000, maxWait: 10_000 };

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function rejectSandbox(req: FastifyRequest) {
  if (!req.sandbox) return;
  const error: any = new Error("PERSONNEL_PLANNING_PRODUCTION_ONLY");
  error.statusCode = 400;
  throw error;
}

function dateFromKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function assertMonday(key: string) {
  if (mondayOfLocalWeek(key) !== key) {
    const error: any = new Error("weekStart must be a Monday (YYYY-MM-DD)");
    error.statusCode = 400;
    throw error;
  }
}

function assertCurrentOrFutureWeek(weekStart: string) {
  if (weekStart < mondayOfLocalWeek(new Date(), LOCAL_OFFSET_MINUTES)) {
    const error: any = new Error("Past weeks cannot be locked or unlocked");
    error.statusCode = 400;
    throw error;
  }
}

function assertCurrentOrFutureDate(date: string) {
  if (date < localDateKey(new Date(), LOCAL_OFFSET_MINUTES)) {
    const error: any = new Error("Past personnel planning norms cannot be changed");
    error.statusCode = 400;
    throw error;
  }
}

export const personnelPlanningRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0] ?? "";
    if (/\/(meta|norms|factors|category-composition)(\/|$)/.test(path) || path.includes("/category-mappings")) return;
    rejectSandbox(req);
  });

  app.get("/meta", async (req) => {
    assertPermission(req, "personnel:read");
    const categories = await app.prisma.personnelCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
    const mappings = await app.prisma.personnelWorkshopCategory.findMany({ where: { isActive: true } });
    const shifts = await app.prisma.shift.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
    const workshops = await app.prisma.workshop.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
    const aircraftTypes = await app.prisma.aircraftType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    const assignmentLinks = await app.prisma.aircraftWorkshopAssignment.findMany({
      select: { workshopId: true, aircraft: { select: { typeId: true } } }
    });
    const seenLinks = new Set<string>();
    const workshopAircraftTypes: Array<{ workshopId: string; aircraftTypeId: string }> = [];
    for (const link of assignmentLinks) {
      const key = `${link.workshopId}:${link.aircraft.typeId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      workshopAircraftTypes.push({ workshopId: link.workshopId, aircraftTypeId: link.aircraft.typeId });
    }
    return {
      ok: true,
      departments: PERSONNEL_DEPARTMENTS,
      categories,
      workshopCategoryMappings: mappings,
      shifts,
      workshops,
      aircraftTypes,
      workshopAircraftTypes,
      defaults: { hoursNorm: 11, aircraftTypeMpsFactor: 1.4, timezoneOffsetMinutes: LOCAL_OFFSET_MINUTES }
    };
  });

  app.get("/category-composition", async (req) => {
    assertAnyPermission(req, ["personnel:read", "ref:read"]);
    const items = await app.prisma.personnelCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }]
    });
    return { ok: true, departments: PERSONNEL_DEPARTMENTS, items };
  });

  app.put("/category-composition", async (req) => {
    assertAnyPermission(req, ["personnel:write", "ref:write"]);
    const body = z.object({
      department: z.enum(PERSONNEL_DEPARTMENTS),
      codes: z.array(zCategory).max(30)
    }).parse(req.body);
    const codes = [...new Set(body.codes)];
    const found = codes.length
      ? await app.prisma.personnelCategory.findMany({ where: { code: { in: codes } }, select: { code: true } })
      : [];
    if (found.length !== codes.length) throw app.httpErrors.badRequest("Неизвестная квалификация");
    await app.prisma.$transaction(async (tx) => {
      if (codes.length) {
        await tx.personnelCategory.updateMany({
          where: { department: body.department, code: { notIn: codes } },
          data: { department: null, isAuthorized: false }
        });
        await tx.personnelCategory.updateMany({
          where: { code: { in: codes } },
          data: { department: body.department, isAuthorized: true }
        });
      } else {
        await tx.personnelCategory.updateMany({
          where: { department: body.department },
          data: { department: null, isAuthorized: false }
        });
      }
    }, PERSONNEL_TX);
    const items = await app.prisma.personnelCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }]
    });
    return { ok: true, departments: PERSONNEL_DEPARTMENTS, items };
  });

  app.get("/workshops/:workshopId/category-mappings", async (req) => {
    assertPermission(req, "personnel:read");
    const workshopId = zUuid.parse((req.params as any).workshopId);
    const items = await app.prisma.personnelWorkshopCategory.findMany({
      where: { workshopId, isActive: true },
      include: { category: true },
      orderBy: { categoryCode: "asc" }
    });
    return { ok: true, workshopId, items };
  });

  app.put("/workshops/:workshopId/category-mappings", async (req) => {
    assertPermission(req, "personnel:write");
    const workshopId = zUuid.parse((req.params as any).workshopId);
    const body = z.object({ categoryCodes: z.array(zCategory).max(20) }).parse(req.body);
    const categoryCodes = Array.from(new Set(body.categoryCodes));
    const result = await app.prisma.$transaction(async (tx) => {
      const [workshop, categories, existing] = await Promise.all([
        tx.workshop.findUnique({ where: { id: workshopId }, select: { id: true } }),
        tx.personnelCategory.findMany({ where: { code: { in: categoryCodes }, isActive: true } }),
        tx.personnelWorkshopCategory.findMany({
          where: { workshopId, isActive: true },
          select: { categoryCode: true }
        })
      ]);
      if (!workshop) throw app.httpErrors.notFound("Workshop not found");
      if (categories.length !== categoryCodes.length) throw app.httpErrors.badRequest("Unknown or inactive personnel category");
      const desired = new Set(categoryCodes);
      const removed = existing.map((row) => row.categoryCode).filter((code) => !desired.has(code));
      if (removed.length) {
        const used = await tx.personnelAvailability.findFirst({
          where: { workshopId, categoryCode: { in: removed } },
          select: { id: true }
        });
        if (used) {
          throw app.httpErrors.conflict(
            "Cannot unmap a category while availability rows still use it"
          );
        }
      }
      await tx.personnelWorkshopCategory.deleteMany({ where: { workshopId } });
      if (categories.length) {
        await tx.personnelWorkshopCategory.createMany({
          data: categories.map((category) => ({
            workshopId,
            categoryCode: category.code,
            department: category.department,
            isActive: true
          }))
        });
      }
      return tx.personnelWorkshopCategory.findMany({
        where: { workshopId, isActive: true },
        include: { category: true },
        orderBy: { categoryCode: "asc" }
      });
    }, PERSONNEL_TX);
    return { ok: true, workshopId, items: result };
  });

  app.get("/week", async (req) => {
    assertPermission(req, "personnel:read");
    const query = z.object({ weekStart: zDateKey, workshopId: zUuid }).parse(req.query);
    assertMonday(query.weekStart);
    const rangeStart = dateFromKey(query.weekStart);
    const [week, current] = await Promise.all([
      app.prisma.personnelPlanningWeek.findUnique({
        where: { workshopId_weekStart: { workshopId: query.workshopId, weekStart: rangeStart } },
        include: {
          lockedBy: { select: { id: true, email: true, displayName: true } },
          snapshots: {
            orderBy: { version: "desc" },
            take: 10,
            select: { id: true, version: true, createdAt: true, createdById: true, payload: true }
          }
        }
      }),
      loadPersonnelWeekData(app.prisma, query)
    ]);
    const latestSnapshot = week?.snapshots[0] ?? null;
    const baseline = (latestSnapshot?.payload as any) ?? null;
    const baselineSnapshot = latestSnapshot
      ? {
          id: latestSnapshot.id,
          version: latestSnapshot.version,
          createdAt: latestSnapshot.createdAt,
          createdById: latestSnapshot.createdById
        }
      : null;
    const weekResponse = week
      ? {
          ...week,
          snapshots: week.snapshots.map(({ payload: _payload, ...snapshot }) => snapshot)
        }
      : { workshopId: query.workshopId, weekStart: rangeStart, version: 0, isLocked: false, snapshots: [] };

    return {
      ok: true,
      week: weekResponse,
      ...current,
      baseline: baselineSnapshot ? { snapshot: baselineSnapshot, data: baseline } : null,
      deltaFromBaseline: personnelBaselineDelta(current, baseline)
    };
  });

  app.get("/balance", async (req) => {
    assertPermission(req, "personnel:read");
    const query = z.object({
      workshopId: z.string().optional(),
      workshopIds: z.string().optional(),
      aircraftTypeIds: z.string().optional(),
      from: zDateKey,
      to: zDateKey
    }).parse(req.query);
    const workshopIds = [...new Set(`${query.workshopIds ?? ""},${query.workshopId ?? ""}`.split(",").map((id) => id.trim()).filter(Boolean))];
    const aircraftTypeIds = [...new Set((query.aircraftTypeIds ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
    if (!workshopIds.length || workshopIds.some((id) => !zUuid.safeParse(id).success)) throw app.httpErrors.badRequest("Нужно выбрать цех");
    if (aircraftTypeIds.some((id) => !zUuid.safeParse(id).success)) throw app.httpErrors.badRequest("Неизвестный тип ВС");
    if (query.to < query.from) throw app.httpErrors.badRequest("Дата окончания раньше даты начала");
    const dates = periodDateKeys(query.from, query.to);
    if (dates.length > 31 || dates[dates.length - 1] !== query.to) throw app.httpErrors.badRequest("Период не длиннее 31 дня");
    const current = await loadPersonnelWeekData(app.prisma, {
      workshopId: workshopIds[0]!,
      workshopIds,
      weekStart: mondayOfLocalWeek(query.from),
      dates,
      aircraftTypeIds,
      includeEventDemand: true
    });
    const weeks = workshopIds.length === 1
      ? await app.prisma.personnelPlanningWeek.findMany({
          where: { workshopId: workshopIds[0], weekStart: { in: mondaysCovering(query.from, query.to).map(dateFromKey) } },
          include: {
            snapshots: { orderBy: { version: "desc" }, take: 1, select: { version: true, createdAt: true, payload: true } }
          }
        })
      : [];
    const known = new Set<string>();
    const calculation: any[] = [];
    const calculationByAircraftType: Record<string, any[]> = {};
    const events: any[] = [];
    const seenEvents = new Set<string>();
    const lockedWeeks: Array<{ weekStart: string; version: number; createdAt: Date }> = [];
    for (const week of weeks) {
      const snapshot = week.snapshots[0];
      if (!snapshot) continue;
      lockedWeeks.push({
        weekStart: week.weekStart.toISOString().slice(0, 10),
        version: snapshot.version,
        createdAt: snapshot.createdAt
      });
      const payload = snapshot.payload as any;
      for (const day of payload?.calculation ?? []) {
        const date = String(day.date ?? "").slice(0, 10);
        if (!dates.includes(date) || known.has(date)) continue;
        known.add(date);
        calculation.push({ ...day, date });
      }
      for (const [typeId, typeDays] of Object.entries(payload?.calculationByAircraftType ?? {})) {
        for (const day of typeDays as any[]) {
          const date = String(day.date ?? "").slice(0, 10);
          if (!dates.includes(date)) continue;
          const list = (calculationByAircraftType[typeId] ??= []);
          if (!list.some((row) => String(row.date).slice(0, 10) === date)) list.push({ ...day, date });
        }
      }
      for (const event of payload?.events ?? []) {
        if (!event?.id || seenEvents.has(event.id)) continue;
        seenEvents.add(event.id);
        events.push(event);
      }
    }
    lockedWeeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const delta = lockedWeeks.length
      ? personnelBaselineDelta(current, { ...current, calculation, calculationByAircraftType, events })
      : null;
    if (delta) {
      delta.calculation = delta.calculation.filter((day: { date: string }) => known.has(day.date));
      delta.calculationByAircraftType = Object.fromEntries(
        Object.entries(delta.calculationByAircraftType).map(([typeId, typeDays]) => [
          typeId,
          typeDays.filter((day) => known.has(day.date))
        ])
      );
    }
    return {
      ok: true,
      ...current,
      lockedWeeks,
      planningWeeks: weeks.map((week) => ({
        weekStart: week.weekStart.toISOString().slice(0, 10),
        isLocked: week.isLocked,
        version: week.version
      })),
      baseline: lockedWeeks.length ? { weeks: lockedWeeks } : null,
      deltaFromBaseline: delta
    };
  });

  app.get("/availability", async (req) => {
    assertPermission(req, "personnel:read");
    const query = z.object({
      workshopId: zUuid.optional(),
      workshopIds: z.string().optional(),
      from: zDateKey,
      to: zDateKey
    }).parse(req.query);
    const workshopIds = [...new Set(`${query.workshopIds ?? ""},${query.workshopId ?? ""}`.split(",").map((id) => id.trim()).filter(Boolean))];
    if (!workshopIds.length || workshopIds.some((id) => !zUuid.safeParse(id).success)) throw app.httpErrors.badRequest("Нужно выбрать цех");
    if (workshopIds.length > 30) throw app.httpErrors.badRequest("Слишком много цехов");
    if (query.to < query.from) throw app.httpErrors.badRequest("Дата окончания раньше даты начала");
    const dayCount = Math.round((dateFromKey(query.to).getTime() - dateFromKey(query.from).getTime()) / 86_400_000) + 1;
    if (dayCount > 31) throw app.httpErrors.badRequest("Период не длиннее 31 дня");
    const mondays: string[] = [];
    for (let day = query.from; day <= query.to; day = new Date(dateFromKey(day).getTime() + 86_400_000).toISOString().slice(0, 10)) {
      const monday = mondayOfLocalWeek(day);
      if (!mondays.includes(monday)) mondays.push(monday);
    }
    const [sheets, storedWeeks] = await Promise.all([
      loadPersonnelResourceSheets(app.prisma, { workshopIds, from: query.from, to: query.to }),
      app.prisma.personnelPlanningWeek.findMany({
        where: { workshopId: { in: workshopIds }, weekStart: { in: mondays.map(dateFromKey) } },
        select: { workshopId: true, weekStart: true, version: true, isLocked: true }
      })
    ]);
    const weeksFor = (workshopId: string) => {
      const stored = new Map(
        storedWeeks
          .filter((row) => row.workshopId === workshopId)
          .map((row) => [row.weekStart.toISOString().slice(0, 10), row])
      );
      return mondays.map((weekStart) => ({
        weekStart,
        version: stored.get(weekStart)?.version ?? 0,
        isLocked: stored.get(weekStart)?.isLocked ?? false
      }));
    };
    const withWeeks = sheets.map((sheet) => ({ ...sheet, weeks: weeksFor(sheet.workshopId) }));
    if (query.workshopIds) return { ok: true, sheets: withWeeks };
    const sheet = withWeeks[0];
    return { ok: true, items: sheet?.items ?? [], weeks: sheet?.weeks ?? weeksFor(workshopIds[0]!) };
  });

  app.put("/availability", async (req) => {
    assertPermission(req, "personnel:write");
    const body = z
      .object({
        workshopId: zUuid,
        weekStart: zDateKey,
        expectedVersion: z.number().int().min(0),
        items: z
          .array(
            z.object({
              date: zDateKey,
              shiftId: zUuid,
              aircraftTypeId: zUuid,
              categoryCode: zCategory.optional(),
              skillId: zUuid.optional(),
              headcount: z.number().int().min(0).max(100_000)
            })
          )
          .max(10_000)
      })
      .parse(req.body);
    assertMonday(body.weekStart);
    const allowedDates = new Set(weekDateKeys(body.weekStart));
    const today = localDateKey(new Date(), LOCAL_OFFSET_MINUTES);
    for (const item of body.items) {
      if (!allowedDates.has(item.date)) throw app.httpErrors.badRequest("Availability date is outside weekStart");
      if (item.date < today) throw app.httpErrors.badRequest("Past availability dates cannot be changed");
    }
    const [mapped, skillLinks] = await Promise.all([
      app.prisma.personnelWorkshopCategory.findMany({
        where: { workshopId: body.workshopId, isActive: true },
        select: { categoryCode: true }
      }),
      app.prisma.workshopSkill.findMany({
        where: { workshopId: body.workshopId },
        select: { skill: { select: { id: true, code: true } } }
      })
    ]);
    const assignedTypes = await app.prisma.aircraft.findMany({
      where: { workshopAssignments: { some: { workshopId: body.workshopId } } },
      distinct: ["typeId"],
      select: { typeId: true }
    });
    const allowedTypeIds = new Set(assignedTypes.map((row) => row.typeId));
    const catalogQualifications = skillLinks.length
      ? await app.prisma.personnelCategory.findMany({
          where: { isActive: true },
          select: { code: true, department: true, isAuthorized: true, sortOrder: true }
        })
      : [];
    const allowedCategories = new Set(
      skillLinks.length
        ? qualificationsForWorkshopSkills(catalogQualifications, skillLinks.map((row) => row.skill.code)).map((row) => row.code)
        : mapped.map((row) => row.categoryCode)
    );
    for (const item of body.items) {
      if (!allowedTypeIds.has(item.aircraftTypeId)) throw app.httpErrors.badRequest("Тип ВС не привязан к выбранному цеху");
      if (!item.categoryCode || !allowedCategories.has(item.categoryCode)) {
        throw app.httpErrors.badRequest(
          `Категория ${item.categoryCode ?? ""} не относится к квалификациям выбранного цеха`
        );
      }
    }

    const result = await app.prisma.$transaction(async (tx) => {
      const weekStart = dateFromKey(body.weekStart);
      await tx.personnelPlanningWeek.upsert({
        where: { workshopId_weekStart: { workshopId: body.workshopId, weekStart } },
        update: {},
        create: { workshopId: body.workshopId, weekStart }
      });
      const updated = await tx.personnelPlanningWeek.updateMany({
        where: {
          workshopId: body.workshopId,
          weekStart,
          version: body.expectedVersion,
          isLocked: false
        },
        data: { version: { increment: 1 } }
      });
      if (updated.count !== 1) {
        const error: any = new Error("PERSONNEL_WEEK_LOCKED_OR_VERSION_CONFLICT");
        error.statusCode = 409;
        throw error;
      }
      const skillCodeById = new Map(skillLinks.map((row) => [row.skill.id, row.skill.code]));
      const existingRows = body.items.length ? await tx.personnelAvailability.findMany({
        where: {
          workshopId: body.workshopId,
          OR: body.items.map((item) => ({
            date: dateFromKey(item.date),
            shiftId: item.shiftId,
            aircraftTypeId: item.aircraftTypeId,
            ...(item.skillId ? { skillId: item.skillId } : { categoryCode: item.categoryCode })
          }))
        },
        select: { date: true, shiftId: true, aircraftTypeId: true, categoryCode: true, skillId: true, headcount: true }
      }) : [];
      const existingByKey = new Map(existingRows.map((row) => [
        `${row.date.toISOString().slice(0, 10)}|${row.shiftId}|${row.aircraftTypeId}|${row.skillId || row.categoryCode}`,
        row.headcount
      ]));
      const changeRows = body.items.flatMap((item) => {
        const key = `${item.date}|${item.shiftId}|${item.aircraftTypeId}|${item.skillId || item.categoryCode}`;
        const headcountFrom = existingByKey.has(key) ? existingByKey.get(key)! : null;
        const headcountTo = item.headcount > 0 ? item.headcount : null;
        if (headcountFrom === headcountTo) return [];
        return [{
          workshopId: body.workshopId,
          date: dateFromKey(item.date),
          shiftId: item.shiftId,
          aircraftTypeId: item.aircraftTypeId,
          categoryCode: item.categoryCode || skillCodeById.get(item.skillId ?? "") || "",
          skillId: item.skillId ?? null,
          headcountFrom,
          headcountTo,
          actorId: req.auth?.id ?? null
        }];
      });
      if (changeRows.length) await tx.personnelAvailabilityChange.createMany({ data: changeRows });
      const clears = body.items.filter((item) => item.headcount === 0);
      const writes = body.items.filter((item) => item.headcount > 0);
      for (const chunk of chunks(clears, 200)) {
        await tx.personnelAvailability.deleteMany({
          where: {
            OR: chunk.map((item) => ({
              date: dateFromKey(item.date),
              workshopId: body.workshopId,
              shiftId: item.shiftId,
              aircraftTypeId: item.aircraftTypeId,
              ...(item.skillId ? { skillId: item.skillId } : { categoryCode: item.categoryCode })
            }))
          }
        });
      }
      const categoryWrites = writes.filter((item) => !item.skillId);
      const skillWrites = writes.filter((item) => item.skillId);
      for (const chunk of chunks(categoryWrites, 200)) {
        const values = chunk.map(
          (item) =>
            Prisma.sql`(${dateFromKey(item.date)}::date, ${body.workshopId}, ${item.shiftId}, ${item.aircraftTypeId}, ${item.categoryCode}::public."PersonnelCategoryCode", ${item.headcount}::int)`
        );
        await tx.$executeRaw`
          INSERT INTO public."PersonnelAvailability"
            ("id", "date", "workshopId", "shiftId", "aircraftTypeId", "categoryCode", "headcount", "createdAt", "updatedAt")
          SELECT gen_random_uuid()::text, v."date", v."workshopId", v."shiftId", v."aircraftTypeId", v."categoryCode", v."headcount", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM (VALUES ${Prisma.join(values)}) AS v("date", "workshopId", "shiftId", "aircraftTypeId", "categoryCode", "headcount")
          ON CONFLICT ("date", "workshopId", "shiftId", "aircraftTypeId", "categoryCode")
          DO UPDATE SET "headcount" = EXCLUDED."headcount", "updatedAt" = CURRENT_TIMESTAMP
        `;
      }
      for (const chunk of chunks(skillWrites, 200)) {
        const values = chunk.map(
          (item) =>
            Prisma.sql`(${dateFromKey(item.date)}::date, ${body.workshopId}, ${item.shiftId}, ${item.aircraftTypeId}, ${item.skillId}::text, ${item.headcount}::int)`
        );
        await tx.$executeRaw`
          INSERT INTO public."PersonnelAvailability"
            ("id", "date", "workshopId", "shiftId", "aircraftTypeId", "skillId", "headcount", "createdAt", "updatedAt")
          SELECT gen_random_uuid()::text, v."date", v."workshopId", v."shiftId", v."aircraftTypeId", v."skillId", v."headcount", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM (VALUES ${Prisma.join(values)}) AS v("date", "workshopId", "shiftId", "aircraftTypeId", "skillId", "headcount")
          ON CONFLICT ("date", "workshopId", "shiftId", "aircraftTypeId", "skillId")
          DO UPDATE SET "headcount" = EXCLUDED."headcount", "updatedAt" = CURRENT_TIMESTAMP
        `;
      }
      return tx.personnelPlanningWeek.findUniqueOrThrow({
        where: { workshopId_weekStart: { workshopId: body.workshopId, weekStart } }
      });
    }, PERSONNEL_TX);
    return { ok: true, week: result };
  });

  app.get("/norms", async (req) => {
    assertPermission(req, "personnel:read");
    return { ok: true, items: await app.prisma.personnelHoursNorm.findMany({ orderBy: { effectiveFrom: "asc" } }) };
  });
  app.post("/norms", async (req) => {
    assertPermission(req, "personnel:write");
    const body = z.object({ effectiveFrom: zDateKey, hours: z.number().positive().max(24) }).parse(req.body);
    assertCurrentOrFutureDate(body.effectiveFrom);
    return app.prisma.personnelHoursNorm.create({ data: { effectiveFrom: dateFromKey(body.effectiveFrom), hours: body.hours } });
  });
  app.put("/norms/:id", async (req) => {
    assertPermission(req, "personnel:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z.object({ effectiveFrom: zDateKey, hours: z.number().positive().max(24) }).parse(req.body);
    assertCurrentOrFutureDate(body.effectiveFrom);
    const existing = await app.prisma.personnelHoursNorm.findUniqueOrThrow({ where: { id } });
    assertCurrentOrFutureDate(existing.effectiveFrom.toISOString().slice(0, 10));
    return app.prisma.personnelHoursNorm.update({
      where: { id },
      data: { effectiveFrom: dateFromKey(body.effectiveFrom), hours: body.hours }
    });
  });
  app.delete("/norms/:id", async (req) => {
    assertPermission(req, "personnel:write");
    const id = zUuid.parse((req.params as any).id);
    const existing = await app.prisma.personnelHoursNorm.findUniqueOrThrow({ where: { id } });
    assertCurrentOrFutureDate(existing.effectiveFrom.toISOString().slice(0, 10));
    await app.prisma.personnelHoursNorm.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/factors", async (req) => {
    assertPermission(req, "personnel:read");
    return {
      ok: true,
      fallback: 1.4,
      items: await app.prisma.personnelAircraftTypeMpsFactor.findMany({
        include: { aircraftType: true },
        orderBy: [{ aircraftTypeId: "asc" }, { effectiveFrom: "asc" }]
      })
    };
  });
  app.post("/factors", async (req) => {
    assertPermission(req, "personnel:write");
    const body = z
      .object({
        aircraftTypeIds: z.array(zUuid).min(1).max(200),
        effectiveFrom: zDateKey,
        factor: z.number().positive().max(100),
        replaceId: zUuid.optional()
      })
      .parse(req.body);
    assertCurrentOrFutureDate(body.effectiveFrom);
    const aircraftTypeIds = [...new Set(body.aircraftTypeIds)];
    const effectiveFrom = dateFromKey(body.effectiveFrom);
    const known = await app.prisma.aircraftType.findMany({
      where: { id: { in: aircraftTypeIds } },
      select: { id: true }
    });
    if (known.length !== aircraftTypeIds.length) throw app.httpErrors.badRequest("Неизвестный тип ВС");
    await app.prisma.$transaction(async (tx) => {
      if (body.replaceId) {
        const existing = await tx.personnelAircraftTypeMpsFactor.findUnique({ where: { id: body.replaceId } });
        if (!existing) throw app.httpErrors.notFound("Коэффициент не найден");
        assertCurrentOrFutureDate(existing.effectiveFrom.toISOString().slice(0, 10));
        const sameRow = aircraftTypeIds.includes(existing.aircraftTypeId) && existing.effectiveFrom.toISOString().slice(0, 10) === body.effectiveFrom;
        if (!sameRow) await tx.personnelAircraftTypeMpsFactor.delete({ where: { id: existing.id } });
      }
      for (const aircraftTypeId of aircraftTypeIds) {
        await tx.personnelAircraftTypeMpsFactor.upsert({
          where: { aircraftTypeId_effectiveFrom: { aircraftTypeId, effectiveFrom } },
          update: { factor: body.factor },
          create: { aircraftTypeId, effectiveFrom, factor: body.factor }
        });
      }
    }, { timeout: 30_000, maxWait: 10_000 });
    return { ok: true, count: aircraftTypeIds.length };
  });
  app.put("/factors/:id", async (req) => {
    assertPermission(req, "personnel:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({ aircraftTypeId: zUuid, effectiveFrom: zDateKey, factor: z.number().positive().max(100) })
      .parse(req.body);
    assertCurrentOrFutureDate(body.effectiveFrom);
    const existing = await app.prisma.personnelAircraftTypeMpsFactor.findUniqueOrThrow({ where: { id } });
    assertCurrentOrFutureDate(existing.effectiveFrom.toISOString().slice(0, 10));
    return app.prisma.personnelAircraftTypeMpsFactor.update({
      where: { id },
      data: { aircraftTypeId: body.aircraftTypeId, effectiveFrom: dateFromKey(body.effectiveFrom), factor: body.factor }
    });
  });
  app.delete("/factors/:id", async (req) => {
    assertPermission(req, "personnel:write");
    const id = zUuid.parse((req.params as any).id);
    const existing = await app.prisma.personnelAircraftTypeMpsFactor.findUniqueOrThrow({ where: { id } });
    assertCurrentOrFutureDate(existing.effectiveFrom.toISOString().slice(0, 10));
    await app.prisma.personnelAircraftTypeMpsFactor.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/weeks/:workshopId/:weekStart/lock", async (req) => {
    assertPermission(req, "personnel:lock");
    const params = z.object({ workshopId: zUuid, weekStart: zDateKey }).parse(req.params);
    assertMonday(params.weekStart);
    assertCurrentOrFutureWeek(params.weekStart);
    const weekStart = dateFromKey(params.weekStart);
    const locked = await app.prisma.$transaction(async (tx) => {
      await tx.personnelPlanningWeek.upsert({
        where: { workshopId_weekStart: { workshopId: params.workshopId, weekStart } },
        update: {},
        create: { workshopId: params.workshopId, weekStart }
      });
      const current = await tx.personnelPlanningWeek.findUniqueOrThrow({
        where: { workshopId_weekStart: { workshopId: params.workshopId, weekStart } }
      });
      if (current.isLocked) throw app.httpErrors.conflict("Personnel week is already locked");
      const snapshot = await loadPersonnelWeekData(tx, params);
      const version = current.version + 1;
      const week = await tx.personnelPlanningWeek.update({
        where: { id: current.id },
        data: { version, isLocked: true, lockedAt: new Date(), lockedById: req.auth!.id }
      });
      await tx.personnelPlanningSnapshot.create({
        data: {
          weekId: current.id,
          version,
          createdById: req.auth!.id,
          payload: JSON.parse(JSON.stringify(snapshot))
        }
      });
      return week;
    }, { timeout: 60_000, maxWait: 10_000 });
    return { ok: true, week: locked };
  });

  app.post("/weeks/:workshopId/:weekStart/unlock", async (req) => {
    assertPermission(req, "personnel:unlock");
    const params = z.object({ workshopId: zUuid, weekStart: zDateKey }).parse(req.params);
    assertMonday(params.weekStart);
    assertCurrentOrFutureWeek(params.weekStart);
    const updated = await app.prisma.personnelPlanningWeek.updateMany({
      where: { workshopId: params.workshopId, weekStart: dateFromKey(params.weekStart), isLocked: true },
      data: { isLocked: false, lockedAt: null, lockedById: null, version: { increment: 1 } }
    });
    if (!updated.count) throw app.httpErrors.conflict("Personnel week is not locked");
    return { ok: true };
  });
};
