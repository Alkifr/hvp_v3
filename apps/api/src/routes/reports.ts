import type { FastifyPluginAsync } from "fastify";
import { ReportShareRole } from "@prisma/client";
import { z } from "zod";

import { assertPermission } from "../lib/rbac.js";
import { zDateTime, zUuid } from "../lib/zod.js";

export type ReportDataset =
  | "tat_events"
  | "util_hangars"
  | "util_timeline"
  | "util_stands"
  | "compare_hangars"
  | "compare_events";

export type ReportFieldDef = {
  key: string;
  label: string;
  type: "string" | "number" | "datetime";
};

export type ReportConfig = {
  dataset: ReportDataset;
  fields: string[];
  filters: {
    conditions?: Array<{
      field: string;
      op: "contains" | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "empty" | "notEmpty";
      value?: string;
    }>;
    /** @deprecated legacy */
    hangarIds?: string[];
    operatorIds?: string[];
    aircraftTypeIds?: string[];
    aircraftIds?: string[];
    eventTypeIds?: string[];
  };
  sort: Array<{ field: string; dir: "asc" | "desc" }>;
  grain?: "day" | "week" | "month" | "period";
  compareA?: string;
  compareB?: string;
  /** Произвольный период отчёта (YYYY-MM-DD). Если не задан — берётся from/to из запроса. */
  periodFrom?: string | null;
  periodTo?: string | null;
};

const DATASETS: Array<{ id: ReportDataset; label: string; description: string }> = [
  {
    id: "tat_events",
    label: "TAT · события",
    description: "Плоская таблица событий с планом/фактом TAT и отклонениями"
  },
  {
    id: "util_hangars",
    label: "Utilization · ангары",
    description: "Эффективность и простой по ангарам за период"
  },
  {
    id: "util_timeline",
    label: "Utilization · таймлайн",
    description: "Интервалы детализации (сутки/неделя/месяц) с утилизацией"
  },
  {
    id: "util_stands",
    label: "Utilization · места",
    description: "Загрузка мест стоянки с учётом активной схемы"
  },
  {
    id: "compare_hangars",
    label: "Сценарии · ангары",
    description: "Сравнение загрузки ангаров A vs B"
  },
  {
    id: "compare_events",
    label: "Сценарии · события",
    description: "Плоский список событий сценариев A и B"
  }
];

const FIELDS: Record<ReportDataset, ReportFieldDef[]> = {
  tat_events: [
    { key: "aircraft", label: "Борт", type: "string" },
    { key: "title", label: "Событие", type: "string" },
    { key: "eventType", label: "Тип события", type: "string" },
    { key: "hangar", label: "Ангар", type: "string" },
    { key: "status", label: "Статус", type: "string" },
    { key: "planTatH", label: "План TAT, ч", type: "number" },
    { key: "actualTatH", label: "Факт TAT, ч", type: "number" },
    { key: "tatVarianceH", label: "Δ TAT, ч", type: "number" },
    { key: "startDelayH", label: "Δ старт, ч", type: "number" },
    { key: "endDelayH", label: "Δ окончание, ч", type: "number" },
    { key: "deviationLabels", label: "Отклонения", type: "string" },
    { key: "reason", label: "Причина", type: "string" },
    { key: "planStartAt", label: "План старт", type: "datetime" },
    { key: "planEndAt", label: "План окончание", type: "datetime" },
    { key: "actualStartAt", label: "Факт старт", type: "datetime" },
    { key: "actualEndAt", label: "Факт окончание", type: "datetime" }
  ],
  util_hangars: [
    { key: "hangarName", label: "Ангар", type: "string" },
    { key: "standCount", label: "Мест (nominal)", type: "number" },
    { key: "occupiedH", label: "Занято, ч", type: "number" },
    { key: "idleH", label: "Простой, ч", type: "number" },
    { key: "capacityH", label: "Ёмкость, ч", type: "number" },
    { key: "utilizationPct", label: "Stand util, %", type: "number" },
    { key: "capacityUtilizationPct", label: "Эффективность, %", type: "number" },
    { key: "timeUtilizationPct", label: "Time util, %", type: "number" },
    { key: "aircraftHours", label: "ВС·ч", type: "number" },
    { key: "capacityHours", label: "Место·ч схемы", type: "number" },
    { key: "conflictPct", label: "Конфликт, %", type: "number" },
    { key: "reservationCount", label: "Резервов", type: "number" }
  ],
  util_timeline: [
    { key: "label", label: "Интервал", type: "string" },
    { key: "from", label: "С", type: "datetime" },
    { key: "to", label: "По", type: "datetime" },
    { key: "aircraftHours", label: "Спрос ВС·ч", type: "number" },
    { key: "occupiedH", label: "Занято мест·ч", type: "number" },
    { key: "capacityH", label: "Ёмкость мест·ч", type: "number" },
    { key: "idleH", label: "Простой, ч", type: "number" },
    { key: "standUtilizationPct", label: "Stand util, %", type: "number" },
    { key: "capacityUtilizationPct", label: "Эффективность, %", type: "number" },
    { key: "timeUtilizationPct", label: "Time util, %", type: "number" },
    { key: "conflictPct", label: "Конфликт, %", type: "number" }
  ],
  util_stands: [
    { key: "standCode", label: "Место", type: "string" },
    { key: "hangarName", label: "Ангар", type: "string" },
    { key: "layoutName", label: "Схема", type: "string" },
    { key: "availableH", label: "Доступно, ч", type: "number" },
    { key: "occupiedH", label: "Занято, ч", type: "number" },
    { key: "idleH", label: "Простой, ч", type: "number" },
    { key: "utilizationPct", label: "Utilization, %", type: "number" },
    { key: "reservationCount", label: "Резервов", type: "number" }
  ],
  compare_hangars: [
    { key: "hangarName", label: "Ангар", type: "string" },
    { key: "aOccupiedH", label: "A, ч", type: "number" },
    { key: "bOccupiedH", label: "B, ч", type: "number" },
    { key: "deltaH", label: "Δ, ч", type: "number" },
    { key: "aEventsCount", label: "Событий A", type: "number" },
    { key: "bEventsCount", label: "Событий B", type: "number" }
  ],
  compare_events: [
    { key: "side", label: "Сценарий", type: "string" },
    { key: "hangarName", label: "Ангар", type: "string" },
    { key: "aircraft", label: "Борт", type: "string" },
    { key: "title", label: "Событие", type: "string" },
    { key: "eventType", label: "Тип события", type: "string" },
    { key: "status", label: "Статус", type: "string" },
    { key: "standCode", label: "Место", type: "string" },
    { key: "startAt", label: "Старт", type: "datetime" },
    { key: "endAt", label: "Окончание", type: "datetime" },
    { key: "occupiedH", label: "Занято, ч", type: "number" }
  ]
};

const DEFAULT_FIELDS: Record<ReportDataset, string[]> = {
  tat_events: ["aircraft", "title", "eventType", "hangar", "planTatH", "actualTatH", "tatVarianceH", "deviationLabels"],
  util_hangars: ["hangarName", "utilizationPct", "capacityUtilizationPct", "occupiedH", "idleH", "aircraftHours"],
  util_timeline: ["label", "aircraftHours", "standUtilizationPct", "capacityUtilizationPct", "idleH"],
  util_stands: ["standCode", "hangarName", "layoutName", "availableH", "occupiedH", "idleH", "utilizationPct"],
  compare_hangars: ["hangarName", "aOccupiedH", "bOccupiedH", "deltaH", "aEventsCount", "bEventsCount"],
  compare_events: ["side", "hangarName", "aircraft", "title", "startAt", "endAt", "occupiedH"]
};

const zReportConfig = z.object({
  dataset: z.enum([
    "tat_events",
    "util_hangars",
    "util_timeline",
    "util_stands",
    "compare_hangars",
    "compare_events"
  ]),
  fields: z.array(z.string()).min(1),
  filters: z
    .object({
      conditions: z
        .array(
          z.object({
            field: z.string(),
            op: z.enum(["contains", "eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"]),
            value: z.string().optional()
          })
        )
        .optional(),
      hangarIds: z.array(z.string()).optional(),
      operatorIds: z.array(z.string()).optional(),
      aircraftTypeIds: z.array(z.string()).optional(),
      aircraftIds: z.array(z.string()).optional(),
      eventTypeIds: z.array(z.string()).optional()
    })
    .default({}),
  sort: z
    .array(z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }))
    .max(3)
    .default([]),
  grain: z.enum(["day", "week", "month", "period"]).optional(),
  compareA: z.string().optional(),
  compareB: z.string().optional(),
  periodFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  periodTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()
});

function assertAuthed(req: any): { id: string } {
  const auth = req.auth as { id?: string } | undefined;
  if (!auth?.id) {
    const err: any = new Error("UNAUTHORIZED");
    err.statusCode = 401;
    throw err;
  }
  return { id: auth.id };
}

async function loadAccessibleReport(app: any, reportId: string, userId: string) {
  const report = await app.prisma.savedReport.findUnique({
    where: { id: reportId },
    include: {
      owner: { select: { id: true, email: true, displayName: true } },
      shares: { include: { user: { select: { id: true, email: true, displayName: true } } } }
    }
  });
  if (!report) {
    const err: any = new Error("REPORT_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }
  const share = report.shares.find((s: any) => s.userId === userId);
  const isOwner = report.ownerId === userId;
  if (!isOwner && !share) {
    const err: any = new Error("REPORT_ACCESS_DENIED");
    err.statusCode = 403;
    throw err;
  }
  return {
    report,
    myRole: isOwner ? ("OWNER" as const) : (share.role as ReportShareRole),
    canEdit: isOwner || share?.role === ReportShareRole.EDITOR
  };
}

function matchRowFilters(row: Record<string, any>, filters: ReportConfig["filters"]): boolean {
  if (filters.hangarIds?.length) {
    const id = row.hangarId ? String(row.hangarId) : "";
    if (id && !filters.hangarIds.includes(id)) return false;
  }
  if (filters.operatorIds?.length) {
    const id = row.operatorId ? String(row.operatorId) : "";
    if (!id || !filters.operatorIds.includes(id)) return false;
  }
  if (filters.aircraftTypeIds?.length) {
    const id = row.aircraftTypeId ? String(row.aircraftTypeId) : "";
    if (!id || !filters.aircraftTypeIds.includes(id)) return false;
  }
  if (filters.aircraftIds?.length) {
    const id = row.aircraftId ? String(row.aircraftId) : "";
    if (!id || !filters.aircraftIds.includes(id)) return false;
  }
  if (filters.eventTypeIds?.length) {
    const id = row.eventTypeId ? String(row.eventTypeId) : "";
    if (!id || !filters.eventTypeIds.includes(id)) return false;
  }

  for (const c of filters.conditions ?? []) {
    if (!c.field) continue;
    const raw = row[c.field];
    const empty = raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0);
    if (c.op === "empty") {
      if (!empty) return false;
      continue;
    }
    if (c.op === "notEmpty") {
      if (empty) return false;
      continue;
    }
    const value = c.value ?? "";
    const asStr = Array.isArray(raw) ? raw.join("; ") : String(raw ?? "");
    const asNum = typeof raw === "number" ? raw : Number(asStr);
    const valNum = Number(value);
    switch (c.op) {
      case "contains":
        if (!asStr.toLowerCase().includes(value.toLowerCase())) return false;
        break;
      case "eq":
        if (Number.isFinite(asNum) && Number.isFinite(valNum) && value !== "" && typeof raw === "number") {
          if (asNum !== valNum) return false;
        } else if (asStr !== value) return false;
        break;
      case "neq":
        if (Number.isFinite(asNum) && Number.isFinite(valNum) && value !== "" && typeof raw === "number") {
          if (asNum === valNum) return false;
        } else if (asStr === value) return false;
        break;
      case "gt":
        if (!(Number.isFinite(asNum) && Number.isFinite(valNum) && asNum > valNum)) return false;
        break;
      case "gte":
        if (!(Number.isFinite(asNum) && Number.isFinite(valNum) && asNum >= valNum)) return false;
        break;
      case "lt":
        if (!(Number.isFinite(asNum) && Number.isFinite(valNum) && asNum < valNum)) return false;
        break;
      case "lte":
        if (!(Number.isFinite(asNum) && Number.isFinite(valNum) && asNum <= valNum)) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

function projectAndSort(
  rows: Array<Record<string, any>>,
  config: ReportConfig,
  fieldDefs: ReportFieldDef[]
) {
  const allowed = new Set(fieldDefs.map((f) => f.key));
  const fields = config.fields.filter((f) => allowed.has(f));
  const columns = fields.map((key) => {
    const def = fieldDefs.find((f) => f.key === key)!;
    return { key: def.key, label: def.label, type: def.type };
  });

  let filtered = rows.filter((r) => matchRowFilters(r, config.filters));
  if (config.sort.length) {
    filtered = [...filtered].sort((a, b) => {
      for (const s of config.sort) {
        if (!fields.includes(s.field) && !allowed.has(s.field)) continue;
        const av = a[s.field];
        const bv = b[s.field];
        if (av == null && bv == null) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        let cmp = 0;
        if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv), "ru");
        if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }

  const projected = filtered.map((r) => {
    const out: Record<string, any> = {};
    for (const f of fields) {
      const v = r[f];
      out[f] = Array.isArray(v) ? v.join("; ") : v ?? null;
    }
    return out;
  });

  return { columns, rows: projected, total: projected.length };
}

function resolvePeriod(
  requestFrom: Date,
  requestTo: Date,
  config: Pick<ReportConfig, "periodFrom" | "periodTo">,
  tzOffsetMinutes = 0
) {
  if (config.periodFrom && config.periodTo) {
    const offsetMs = tzOffsetMinutes * 60_000;
    // local calendar day start/end → absolute UTC instants
    const fromWall = new Date(`${config.periodFrom}T00:00:00.000Z`);
    const toWall = new Date(`${config.periodTo}T23:59:59.999Z`);
    const from = new Date(fromWall.getTime() - offsetMs);
    const to = new Date(toWall.getTime() - offsetMs);
    if (to.getTime() > from.getTime()) return { from, to };
  }
  return { from: requestFrom, to: requestTo };
}

async function fetchJson(app: any, req: any, path: string) {
  const headers: Record<string, string> = {};
  const cookie = req.headers.cookie;
  const auth = req.headers.authorization;
  const sandbox = req.headers["x-sandbox-id"];
  if (cookie) headers.cookie = String(cookie);
  if (auth) headers.authorization = String(auth);
  if (sandbox) headers["x-sandbox-id"] = String(sandbox);

  // Internal call via inject (Fastify)
  const res = await app.inject({ method: "GET", url: path, headers });
  if (res.statusCode >= 400) {
    const err: any = new Error(res.json()?.message ?? `UPSTREAM_${res.statusCode}`);
    err.statusCode = res.statusCode;
    throw err;
  }
  return res.json();
}

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async (req) => {
    assertPermission(req as any, "events:read");
    return {
      ok: true as const,
      datasets: DATASETS.map((d) => ({
        ...d,
        fields: FIELDS[d.id],
        defaultFields: DEFAULT_FIELDS[d.id]
      }))
    };
  });

  app.get("/", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const reports = await app.prisma.savedReport.findMany({
      where: {
        OR: [{ ownerId: me.id }, { shares: { some: { userId: me.id } } }]
      },
      include: {
        owner: { select: { id: true, email: true, displayName: true } },
        shares: { include: { user: { select: { id: true, email: true, displayName: true } } } }
      },
      orderBy: { updatedAt: "desc" }
    });

    return {
      ok: true as const,
      reports: reports.map((r: any) => {
        const isOwner = r.ownerId === me.id;
        const share = r.shares.find((s: any) => s.userId === me.id);
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          config: r.config,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          owner: r.owner,
          myRole: isOwner ? "OWNER" : share?.role ?? null,
          canEdit: isOwner || share?.role === ReportShareRole.EDITOR,
          shares: r.shares.map((s: any) => ({
            userId: s.userId,
            role: s.role,
            email: s.user.email,
            displayName: s.user.displayName
          }))
        };
      })
    };
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).optional().nullable(),
        config: zReportConfig
      })
      .parse(req.body);

    const created = await app.prisma.savedReport.create({
      data: {
        name: body.name,
        description: body.description || null,
        ownerId: me.id,
        config: body.config
      }
    });
    return { ok: true as const, id: created.id };
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const id = zUuid.parse((req.params as any).id);
    const { canEdit } = await loadAccessibleReport(app, id, me.id);
    if (!canEdit) {
      const err: any = new Error("REPORT_EDIT_DENIED");
      err.statusCode = 403;
      throw err;
    }
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(500).optional().nullable(),
        config: zReportConfig.optional()
      })
      .parse(req.body);

    const updated = await app.prisma.savedReport.update({
      where: { id },
      data: {
        ...(body.name != null ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.config ? { config: body.config } : {})
      }
    });
    return { ok: true as const, id: updated.id, updatedAt: updated.updatedAt.toISOString() };
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const id = zUuid.parse((req.params as any).id);
    const { report } = await loadAccessibleReport(app, id, me.id);
    if (report.ownerId !== me.id) {
      const err: any = new Error("REPORT_DELETE_DENIED");
      err.statusCode = 403;
      throw err;
    }
    await app.prisma.savedReport.delete({ where: { id } });
    return { ok: true as const };
  });

  app.post("/:id/shares", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const id = zUuid.parse((req.params as any).id);
    const { report } = await loadAccessibleReport(app, id, me.id);
    if (report.ownerId !== me.id) {
      const err: any = new Error("REPORT_SHARE_DENIED");
      err.statusCode = 403;
      throw err;
    }
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        role: z.nativeEnum(ReportShareRole).default(ReportShareRole.VIEWER)
      })
      .parse(req.body);

    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      const err: any = new Error("USER_NOT_FOUND");
      err.statusCode = 404;
      throw err;
    }
    if (user.id === me.id) {
      const err: any = new Error("CANNOT_SHARE_SELF");
      err.statusCode = 400;
      throw err;
    }

    const share = await app.prisma.savedReportShare.upsert({
      where: { reportId_userId: { reportId: id, userId: user.id } },
      update: { role: body.role },
      create: { reportId: id, userId: user.id, role: body.role }
    });

    return {
      ok: true as const,
      share: {
        userId: share.userId,
        role: share.role,
        email: user.email,
        displayName: user.displayName
      }
    };
  });

  app.delete("/:id/shares/:userId", async (req) => {
    assertPermission(req as any, "events:read");
    const me = assertAuthed(req);
    const id = zUuid.parse((req.params as any).id);
    const userId = zUuid.parse((req.params as any).userId);
    const { report } = await loadAccessibleReport(app, id, me.id);
    if (report.ownerId !== me.id) {
      const err: any = new Error("REPORT_SHARE_DENIED");
      err.statusCode = 403;
      throw err;
    }
    await app.prisma.savedReportShare.deleteMany({ where: { reportId: id, userId } });
    return { ok: true as const };
  });

  // POST /api/reports/run — выполнить конфиг (сохранённый или черновик)
  app.post("/run", async (req) => {
    assertPermission(req as any, "events:read");
    assertAuthed(req);
    const body = z
      .object({
        reportId: zUuid.optional(),
        config: zReportConfig.optional(),
        from: zDateTime,
        to: zDateTime,
        tzOffset: z.coerce.number().int().optional().default(0)
      })
      .parse(req.body);

    let config = body.config;
    if (body.reportId) {
      const me = assertAuthed(req);
      const { report } = await loadAccessibleReport(app, body.reportId, me.id);
      config = zReportConfig.parse(report.config);
    }
    if (!config) {
      const err: any = new Error("CONFIG_REQUIRED");
      err.statusCode = 400;
      throw err;
    }

    const period = resolvePeriod(body.from, body.to, config, body.tzOffset);
    const fromQ = encodeURIComponent(period.from.toISOString());
    const toQ = encodeURIComponent(period.to.toISOString());
    const fieldDefs = FIELDS[config.dataset];
    let rawRows: Array<Record<string, any>> = [];

    if (config.dataset === "tat_events") {
      const data = await fetchJson(app, req, `/api/analytics/tat-variance?from=${fromQ}&to=${toQ}`);
      rawRows = (data.rows ?? []).map((r: any) => ({
        ...r,
        deviationLabels: Array.isArray(r.deviationLabels) ? r.deviationLabels : []
      }));
    } else if (config.dataset.startsWith("util_")) {
      const grain = config.grain ?? "week";
      const data = await fetchJson(
        app,
        req,
        `/api/analytics/utilization?from=${fromQ}&to=${toQ}&grain=${grain}&tzOffset=${body.tzOffset}`
      );
      if (config.dataset === "util_hangars") {
        rawRows = (data.hangars ?? []).map((h: any) => ({
          hangarId: h.hangarId,
          hangarName: h.hangarName,
          standCount: h.standCount,
          occupiedH: h.occupiedH,
          idleH: h.idleH,
          capacityH: h.capacityH,
          utilizationPct: h.utilizationPct,
          capacityUtilizationPct: h.efficiency?.capacityUtilizationPct,
          timeUtilizationPct: h.efficiency?.timeUtilizationPct,
          aircraftHours: h.efficiency?.aircraftHours,
          capacityHours: h.efficiency?.capacityHours,
          conflictPct: h.efficiency?.conflictPct,
          reservationCount: h.reservationCount
        }));
      } else if (config.dataset === "util_timeline") {
        const points = data.efficiency?.timeline?.points ?? data.efficiency?.buckets ?? [];
        rawRows = points.map((p: any) => ({
          label: p.label,
          from: p.from,
          to: p.to,
          aircraftHours: p.aircraftHours,
          occupiedH: p.occupiedH ?? null,
          capacityH: p.capacityH ?? null,
          idleH: p.idleH ?? null,
          standUtilizationPct: p.standUtilizationPct,
          capacityUtilizationPct: p.capacityUtilizationPct,
          timeUtilizationPct: p.timeUtilizationPct,
          conflictPct: p.conflictPct
        }));
      } else {
        rawRows = (data.stands ?? []).map((s: any) => ({
          hangarId: s.hangarId,
          standCode: s.standCode,
          hangarName: s.hangarName,
          layoutName: s.layoutName,
          availableH: s.availableH ?? null,
          occupiedH: s.occupiedH,
          idleH: s.idleH,
          utilizationPct: s.utilizationPct,
          reservationCount: s.reservationCount
        }));
      }
    } else {
      const a = config.compareA ?? "prod";
      const b = config.compareB;
      if (!b || a === b) {
        const err: any = new Error("COMPARE_SIDES_REQUIRED");
        err.statusCode = 400;
        throw err;
      }
      const data = await fetchJson(
        app,
        req,
        `/api/analytics/sandbox-compare?from=${fromQ}&to=${toQ}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
      );
      if (config.dataset === "compare_hangars") {
        rawRows = (data.hangarCompare ?? []).map((h: any) => ({
          hangarId: h.hangarId,
          hangarName: h.hangarName,
          aOccupiedH: h.aOccupiedH,
          bOccupiedH: h.bOccupiedH,
          deltaH: h.deltaH,
          aEventsCount: (h.aEvents ?? []).length,
          bEventsCount: (h.bEvents ?? []).length
        }));
      } else {
        for (const h of data.hangarCompare ?? []) {
          for (const e of h.aEvents ?? []) {
            rawRows.push({
              side: "A",
              hangarId: h.hangarId,
              hangarName: h.hangarName,
              ...e
            });
          }
          for (const e of h.bEvents ?? []) {
            rawRows.push({
              side: "B",
              hangarId: h.hangarId,
              hangarName: h.hangarName,
              ...e
            });
          }
        }
      }
    }

    const result = projectAndSort(rawRows, config, fieldDefs);
    return {
      ok: true as const,
      dataset: config.dataset,
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      ...result
    };
  });
};
