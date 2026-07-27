import type { PrismaClient } from "@prisma/client";
import { EventAuditAction, EventStatus } from "@prisma/client";
import dayjs from "dayjs";

const OPERATOR_LABEL: Record<string, string> = {
  AFL: "АФЛ",
  AKR: "АКР"
};

const AUTO_STATUS_TARGETS = new Set<string>([EventStatus.IN_PROGRESS, EventStatus.DONE]);

/** Цвета для HTML (Outlook-friendly inline). */
const KIND_STYLE = {
  added: { label: "Добавлено", bg: "#dcfce7", fg: "#166534", border: "#86efac" },
  cancelled: { label: "Отменено", bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
  moved: { label: "Перенос", bg: "#fef9c3", fg: "#854d0e", border: "#fde047" }
} as const;

export type DigestKind = keyof typeof KIND_STYLE;

export type ChangeDigestStats = {
  operators: number;
  prolonged: number;
  cancelled: number;
  added: number;
  otherChanges: number;
  audits: number;
};

export type DigestRow = {
  kind: DigestKind;
  operatorCode: string;
  operatorLabel: string;
  aircraftTypeLabel: string;
  aircraftNumber: string;
  title: string;
  detail: string;
  period: string;
  previous: string;
};

export type ChangeDigestResult = {
  text: string;
  html: string;
  rows: DigestRow[];
  stats: ChangeDigestStats;
};

type DiffValue = { from?: unknown; to?: unknown };

type EventCtx = {
  eventId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  operatorCode: string;
  operatorLabel: string;
  aircraftNumber: string;
  aircraftTypeLabel: string;
};

type FieldCollapse = {
  from: unknown;
  to: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function formatShortDate(d: Date): string {
  return dayjs(d).format("DD.MM.YY");
}

function formatRange(start: Date, end: Date): string {
  const s = dayjs(start);
  const e = dayjs(end);
  if (s.isSame(e, "month") && s.isSame(e, "year")) {
    return `${s.format("DD")}-${e.format("DD.MM.YY")}`;
  }
  return `${s.format("DD.MM")}-${e.format("DD.MM.YY")}`;
}

function operatorDisplay(code: string): string {
  return OPERATOR_LABEL[code] ?? code;
}

function aircraftNumberFrom(opts: {
  serialNumber?: string | null;
  tailNumber?: string | null;
  virtualLabel?: string | null;
}): string {
  const serial = opts.serialNumber?.trim();
  if (serial) return serial;
  const tail = opts.tailNumber?.trim();
  if (tail) {
    const digits = tail.replace(/^RA-?/i, "").replace(/[^\d]/g, "");
    if (digits) return digits;
    return tail;
  }
  const label = opts.virtualLabel?.trim();
  if (label) {
    const digits = label.replace(/[^\d]/g, "");
    if (digits) return digits;
    return label;
  }
  return "?";
}

function typeLabel(type: { name?: string | null; icaoType?: string | null } | null | undefined): string {
  if (!type) return "";
  return (type.icaoType?.trim() || type.name?.trim() || "").trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSystemStatusOnlyUpdate(actor: string, changes: unknown): boolean {
  if (actor !== "system") return false;
  if (!isPlainObject(changes)) return false;
  const keys = Object.keys(changes);
  if (keys.length === 0) return true;
  if (keys.length === 1 && keys[0] === "status") {
    const to = String((changes.status as DiffValue)?.to ?? "");
    return AUTO_STATUS_TARGETS.has(to);
  }
  return keys.every((k) => k === "status") && AUTO_STATUS_TARGETS.has(String((changes.status as DiffValue)?.to ?? ""));
}

function collapseFieldDiffs(audits: Array<{ changes: unknown }>): Map<string, FieldCollapse> {
  const map = new Map<string, FieldCollapse>();
  for (const a of audits) {
    if (!isPlainObject(a.changes)) continue;
    for (const [field, raw] of Object.entries(a.changes)) {
      if (!isPlainObject(raw) || !("from" in raw || "to" in raw)) continue;
      const diff = raw as DiffValue;
      const prev = map.get(field);
      if (!prev) {
        map.set(field, { from: diff.from, to: diff.to });
      } else {
        map.set(field, { from: prev.from, to: diff.to !== undefined ? diff.to : prev.to });
      }
    }
  }
  return map;
}

function buildEventCtx(
  event: any,
  operatorsById: Map<string, { code: string; name: string }>,
  typesById: Map<string, { name: string; icaoType: string | null }>
): EventCtx | null {
  if (!event) return null;

  let operatorCode = "UNKNOWN";
  let aircraftNumber = "?";
  let aircraftTypeLabel = "";

  if (event.aircraft) {
    operatorCode = event.aircraft.operator?.code ?? "UNKNOWN";
    aircraftNumber = aircraftNumberFrom({
      serialNumber: event.aircraft.serialNumber,
      tailNumber: event.aircraft.tailNumber
    });
    aircraftTypeLabel = typeLabel(event.aircraft.type);
  } else if (isPlainObject(event.virtualAircraft)) {
    const va = event.virtualAircraft as Record<string, unknown>;
    const opId = typeof va.operatorId === "string" ? va.operatorId : null;
    const typeId = typeof va.aircraftTypeId === "string" ? va.aircraftTypeId : null;
    const label = typeof va.label === "string" ? va.label : null;
    if (opId && operatorsById.has(opId)) operatorCode = operatorsById.get(opId)!.code;
    if (typeId && typesById.has(typeId)) aircraftTypeLabel = typeLabel(typesById.get(typeId)!);
    aircraftNumber = aircraftNumberFrom({ virtualLabel: label });
  }

  return {
    eventId: event.id,
    title: String(event.title ?? "").trim(),
    startAt: new Date(event.startAt),
    endAt: new Date(event.endAt),
    operatorCode,
    operatorLabel: operatorDisplay(operatorCode),
    aircraftNumber,
    aircraftTypeLabel
  };
}

function rowFromCtx(
  ctx: EventCtx,
  kind: DigestKind,
  opts: { detail: string; period: string; previous: string }
): DigestRow {
  return {
    kind,
    operatorCode: ctx.operatorCode,
    operatorLabel: ctx.operatorLabel,
    aircraftTypeLabel: ctx.aircraftTypeLabel,
    aircraftNumber: ctx.aircraftNumber,
    title: ctx.title,
    detail: opts.detail,
    period: opts.period,
    previous: opts.previous
  };
}

const KIND_ORDER: DigestKind[] = ["added", "moved", "cancelled"];

function formatText(rows: DigestRow[]): string {
  const byOp = new Map<string, { label: string; rows: DigestRow[] }>();
  for (const row of rows) {
    const g = byOp.get(row.operatorCode) ?? { label: row.operatorLabel, rows: [] };
    g.rows.push(row);
    byOp.set(row.operatorCode, g);
  }
  const ordered = [...byOp.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "ru"));
  const lines: string[] = [];
  for (const [, g] of ordered) {
    lines.push(`Изменения ${g.label}:`);
    for (const kind of KIND_ORDER) {
      const subset = g.rows.filter((r) => r.kind === kind);
      if (!subset.length) continue;
      lines.push(`  ${KIND_STYLE[kind].label}:`);
      for (const r of subset) {
        const ac = [r.aircraftTypeLabel, r.aircraftNumber].filter(Boolean).join(" ");
        const parts = [ac, r.title, r.detail || r.period].filter(Boolean);
        const prev = r.previous ? ` (ранее ${r.previous})` : "";
        lines.push(`  - ${parts.join(" ")}${prev}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function formatHtml(rows: DigestRow[]): string {
  if (!rows.length) return "";

  const byOp = new Map<string, { label: string; rows: DigestRow[] }>();
  for (const row of rows) {
    const g = byOp.get(row.operatorCode) ?? { label: row.operatorLabel, rows: [] };
    g.rows.push(row);
    byOp.set(row.operatorCode, g);
  }
  const ordered = [...byOp.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "ru"));

  const sections: string[] = [];
  for (const [, g] of ordered) {
    const sorted = [...g.rows].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const bodyRows = sorted
      .map((r) => {
        const st = KIND_STYLE[r.kind];
        return `<tr>
  <td style="padding:8px 10px;border:1px solid ${st.border};background:${st.bg};color:${st.fg};font-weight:600;white-space:nowrap;">${escapeHtml(st.label)}</td>
  <td style="padding:8px 10px;border:1px solid #e5e7eb;background:${st.bg};">${escapeHtml(r.aircraftTypeLabel || "—")}</td>
  <td style="padding:8px 10px;border:1px solid #e5e7eb;background:${st.bg};font-weight:600;">${escapeHtml(r.aircraftNumber || "—")}</td>
  <td style="padding:8px 10px;border:1px solid #e5e7eb;background:${st.bg};">${escapeHtml(r.title || "—")}</td>
  <td style="padding:8px 10px;border:1px solid #e5e7eb;background:${st.bg};">${escapeHtml(r.detail || r.period || "—")}</td>
  <td style="padding:8px 10px;border:1px solid #e5e7eb;background:${st.bg};color:#6b7280;">${escapeHtml(r.previous || "—")}</td>
</tr>`;
      })
      .join("\n");

    sections.push(`
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:900px;margin:0 0 24px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.4;">
  <thead>
    <tr>
      <th colspan="6" style="padding:10px 12px;text-align:left;background:#1f2937;color:#fff;font-size:15px;border:1px solid #111827;">
        ${escapeHtml(g.label)}
      </th>
    </tr>
    <tr>
      <th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">Тип</th>
      <th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">Тип ВС</th>
      <th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">Борт</th>
      <th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">Работы</th>
      <th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">Период / изменение</th>
      <th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">Ранее</th>
    </tr>
  </thead>
  <tbody>
${bodyRows}
  </tbody>
</table>`);
  }

  const legend = `
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;font-family:Segoe UI,Arial,sans-serif;font-size:12px;">
  <tr>
    <td style="padding:4px 10px;background:${KIND_STYLE.added.bg};color:${KIND_STYLE.added.fg};border:1px solid ${KIND_STYLE.added.border};">Добавлено</td>
    <td style="padding:4px 10px;background:${KIND_STYLE.moved.bg};color:${KIND_STYLE.moved.fg};border:1px solid ${KIND_STYLE.moved.border};">Перенос</td>
    <td style="padding:4px 10px;background:${KIND_STYLE.cancelled.bg};color:${KIND_STYLE.cancelled.fg};border:1px solid ${KIND_STYLE.cancelled.border};">Отменено</td>
  </tr>
</table>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:16px;background:#fff;color:#111;">
${legend}
${sections.join("\n")}
</body></html>`;
}

function emptyResult(audits = 0): ChangeDigestResult {
  return {
    text: "",
    html: "",
    rows: [],
    stats: { operators: 0, prolonged: 0, cancelled: 0, added: 0, otherChanges: 0, audits }
  };
}

export async function buildChangeDigest(
  prisma: PrismaClient,
  params: { from: Date; to: Date }
): Promise<ChangeDigestResult> {
  const { from, to } = params;
  if (!(to > from)) return emptyResult();

  const audits = await prisma.maintenanceEventAudit.findMany({
    where: {
      sandboxId: null,
      createdAt: { gte: from, lt: to },
      action: { in: [EventAuditAction.CREATE, EventAuditAction.UPDATE] }
    },
    orderBy: { createdAt: "asc" },
    include: {
      event: {
        include: {
          aircraft: { include: { operator: true, type: true } }
        }
      }
    }
  });

  const relevant = audits.filter((a) => !isSystemStatusOnlyUpdate(a.actor, a.changes));

  const [operators, aircraftTypes] = await Promise.all([
    prisma.operator.findMany({ select: { id: true, code: true, name: true } }),
    prisma.aircraftType.findMany({ select: { id: true, name: true, icaoType: true } })
  ]);
  const operatorsById = new Map(operators.map((o) => [o.id, o] as const));
  const typesById = new Map(aircraftTypes.map((t) => [t.id, t] as const));

  const byEvent = new Map<string, typeof relevant>();
  for (const a of relevant) {
    const list = byEvent.get(a.eventId) ?? [];
    list.push(a);
    byEvent.set(a.eventId, list);
  }

  const rows: DigestRow[] = [];
  let prolonged = 0;
  let cancelled = 0;
  let added = 0;
  let otherChanges = 0;

  for (const [, eventAudits] of byEvent) {
    const event = eventAudits[0]?.event;
    const ctx = buildEventCtx(event, operatorsById, typesById);
    if (!ctx) continue;

    const creates = eventAudits.filter((a) => a.action === EventAuditAction.CREATE);
    const updates = eventAudits.filter((a) => a.action === EventAuditAction.UPDATE);
    const collapsed = collapseFieldDiffs(updates);

    const statusDiff = collapsed.get("status");
    const becameCancelled =
      statusDiff && String(statusDiff.to) === EventStatus.CANCELLED && String(statusDiff.from) !== EventStatus.CANCELLED;
    const becameDeleted = statusDiff && String(statusDiff.to) === EventStatus.DELETED;

    if (becameDeleted) continue;

    if (becameCancelled) {
      const startFrom = parseDate(collapsed.get("startAt")?.from) ?? ctx.startAt;
      const endFrom = parseDate(collapsed.get("endAt")?.from) ?? ctx.endAt;
      rows.push(
        rowFromCtx(ctx, "cancelled", {
          detail: "отменено",
          period: formatRange(startFrom, endFrom),
          previous: formatRange(startFrom, endFrom)
        })
      );
      cancelled += 1;
      continue;
    }

    if (creates.length > 0) {
      rows.push(
        rowFromCtx(ctx, "added", {
          detail: `на ${formatRange(ctx.startAt, ctx.endAt)}`,
          period: formatRange(ctx.startAt, ctx.endAt),
          previous: ""
        })
      );
      added += 1;
      continue;
    }

    if (updates.length === 0) continue;

    const endDiff = collapsed.get("endAt");
    const startDiff = collapsed.get("startAt");
    const endFrom = endDiff ? parseDate(endDiff.from) : null;
    const endTo = endDiff ? parseDate(endDiff.to) : null;
    const startFrom = startDiff ? parseDate(startDiff.from) : null;
    const startTo = startDiff ? parseDate(startDiff.to) : null;

    const datesChanged = Boolean(endDiff || startDiff);
    if (!datesChanged) continue;

    const onlyEndLater =
      endFrom &&
      endTo &&
      endTo.getTime() > endFrom.getTime() &&
      (!startDiff || (startFrom && startTo && startFrom.getTime() === startTo.getTime()));

    if (onlyEndLater) {
      rows.push(
        rowFromCtx(ctx, "moved", {
          detail: `продлен до ${formatShortDate(endTo)}`,
          period: formatShortDate(endTo),
          previous: `до ${formatShortDate(endFrom)}`
        })
      );
      prolonged += 1;
      continue;
    }

    const prevStart = startFrom ?? ctx.startAt;
    const prevEnd = endFrom ?? ctx.endAt;
    const nextStart = startTo ?? ctx.startAt;
    const nextEnd = endTo ?? ctx.endAt;
    rows.push(
      rowFromCtx(ctx, "moved", {
        detail: `на ${formatRange(nextStart, nextEnd)}`,
        period: formatRange(nextStart, nextEnd),
        previous: formatRange(prevStart, prevEnd)
      })
    );
    otherChanges += 1;
  }

  const operatorCodes = new Set(rows.map((r) => r.operatorCode));

  return {
    text: formatText(rows),
    html: formatHtml(rows),
    rows,
    stats: {
      operators: operatorCodes.size,
      prolonged,
      cancelled,
      added,
      otherChanges,
      audits: relevant.length
    }
  };
}
