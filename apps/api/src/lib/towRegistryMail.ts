import { TOW_REGISTRY_COLUMNS, type TowRegistrySnapshotRow } from "./towRegistry.js";
import type { RegistryMailRow } from "./towRegistrySheet.js";
import { REGISTRY_ADDED, REGISTRY_REMOVED, REGISTRY_UPDATED } from "./towRegistrySheet.js";
import { TOW_EXPORT_COLUMNS, type TowReportRow } from "./towReport.js";

export type TowRegistryLetter = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hangarBandLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Без ангара";
  if (/^ангар\b/i.test(trimmed)) return trimmed.replace(/^ангар/i, "Ангар");
  const number = trimmed.match(/(\d+)/);
  if (number) return `Ангар ${number[1]}`;
  return `Ангар ${trimmed}`;
}

function hangarSortKey(name: string): number {
  const number = name.match(/(\d+)/);
  return number ? Number(number[1]) : Number.MAX_SAFE_INTEGER;
}

export function groupTowReportRows<T extends { hangarNumber?: string; seq?: number }>(rows: T[]): Array<{ label: string; rows: T[] }> {
  const sorted = [...rows].sort(
    (a, b) =>
      hangarSortKey(a.hangarNumber ?? "") - hangarSortKey(b.hangarNumber ?? "") ||
      (a.hangarNumber ?? "").localeCompare(b.hangarNumber ?? "", "ru") ||
      (a.seq ?? 0) - (b.seq ?? 0)
  );
  const groups: Array<{ label: string; rows: T[] }> = [];
  for (const row of sorted) {
    const label = hangarBandLabel(row.hangarNumber ?? "");
    const last = groups[groups.length - 1];
    const next = { ...row, seq: (last?.label === label ? last.rows.length : 0) + 1 };
    if (last?.label === label) last.rows.push(next);
    else groups.push({ label, rows: [next] });
  }
  return groups;
}

export function fillTowMailTemplate(template: string, vars: { period: string; contour: string; rows: string }): string {
  return template.replace(/\{\{\s*(period|contour|rows)\s*\}\}/g, (_match, key: string) => vars[key as keyof typeof vars] ?? "");
}

function cell(row: TowReportRow, key: (typeof TOW_EXPORT_COLUMNS)[number]["key"]): string {
  const value = row[key];
  if (value == null || value === "") return "";
  return String(value);
}

function mailColumns(rows: RegistryMailRow[]) {
  const withStatus = rows.some((row) => typeof row.changeStatus === "string");
  return withStatus ? [...TOW_EXPORT_COLUMNS, { key: "changeStatus" as const, title: "Статус" }] : TOW_EXPORT_COLUMNS;
}

function mailCell(row: RegistryMailRow, key: string): string {
  if (key === "changeStatus") return row.changeStatus ?? "";
  return cell(row, key as (typeof TOW_EXPORT_COLUMNS)[number]["key"]);
}

function rowFill(status: string | undefined): string {
  if (status === REGISTRY_ADDED) return "background:#dcfce7;";
  if (status === REGISTRY_UPDATED) return "background:#fef3c7;";
  if (status === REGISTRY_REMOVED) return "background:#fee2e2;";
  return "";
}

export type TowSendSnap = {
  id?: string;
  tailNumber?: string;
  fromStand?: string;
  toStand?: string;
  plannedStartMsk?: string;
};

function towSnapLabel(row: TowSendSnap): string {
  const route = [row.fromStand, row.toStand].filter(Boolean).join(" → ");
  return [row.tailNumber || "борт", route, row.plannedStartMsk].filter(Boolean).join(", ");
}

export function describeTowSendDiff(previous: TowSendSnap[] | null, next: TowSendSnap[]): string[] {
  if (!previous) {
    const lines = ["Изменения с прошлой отправки: это первая отправка периода."];
    lines.push(next.length ? "Добавлены:" : "Добавлены: нет");
    for (const row of next) lines.push(`+ ${towSnapLabel(row)}`);
    lines.push("Отменены: нет");
    lines.push("Изменено время начала: нет");
    return lines;
  }
  const prevById = new Map(previous.filter((row) => row.id).map((row) => [row.id as string, row]));
  const nextById = new Map(next.filter((row) => row.id).map((row) => [row.id as string, row]));
  const added = next.filter((row) => row.id && !prevById.has(row.id));
  const removed = previous.filter((row) => row.id && !nextById.has(row.id));
  const timeChanged = next.filter((row) => {
    if (!row.id) return false;
    const before = prevById.get(row.id);
    return Boolean(before) && (before?.plannedStartMsk ?? "") !== (row.plannedStartMsk ?? "");
  });
  const lines = ["Изменения с прошлой отправки:"];
  lines.push(added.length ? "Добавлены:" : "Добавлены: нет");
  for (const row of added) lines.push(`+ ${towSnapLabel(row)}`);
  lines.push(removed.length ? "Отменены:" : "Отменены: нет");
  for (const row of removed) lines.push(`- ${towSnapLabel(row)}`);
  lines.push(timeChanged.length ? "Изменено время начала:" : "Изменено время начала: нет");
  for (const row of timeChanged) {
    const before = prevById.get(row.id as string);
    lines.push(`~ ${row.tailNumber || "борт"}: ${before?.plannedStartMsk || "—"} → ${row.plannedStartMsk || "—"}`);
  }
  return lines;
}

function letterRows(rows: RegistryMailRow[]): RegistryMailRow[] {
  const tracked = rows.some((row) => typeof row.changeStatus === "string");
  if (!tracked) return rows;
  return rows.filter(
    (row) => row.changeStatus === REGISTRY_ADDED || row.changeStatus === REGISTRY_UPDATED || row.changeStatus === REGISTRY_REMOVED
  );
}

export function buildTowRegistryLetter(params: {
  rows: RegistryMailRow[];
  periodLabel: string;
  contour: string;
  note?: string | null;
  diffLines?: string[];
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
}): TowRegistryLetter {
  const source = letterRows(params.rows);
  const groups = groupTowReportRows(source);
  const rows = groups.flatMap((group) => group.rows);
  const columns = mailColumns(params.rows);
  const note = String(params.note ?? "").trim();
  const bodyTemplate = fillTowMailTemplate(String(params.bodyTemplate ?? "").trim(), {
    period: params.periodLabel,
    contour: params.contour,
    rows: String(rows.length)
  });
  const diffLines = params.diffLines ?? [];
  const subject = fillTowMailTemplate(String(params.subjectTemplate ?? "").trim() || "Реестр буксировок {{period}}", {
    period: params.periodLabel,
    contour: params.contour,
    rows: String(rows.length)
  });
  const intro = [
    "Реестр буксировок",
    `Период: ${params.periodLabel}`,
    `Контур: ${params.contour}`,
    `Строк: ${rows.length}`,
    ...diffLines
  ];
  const header = columns.map((column) => column.title).join("\t");
  const lines: string[] = [];
  if (rows.length) {
    lines.push("", header);
    for (const group of groups) {
      lines.push("", group.label);
      for (const row of group.rows) lines.push(columns.map((column) => mailCell(row, column.key)).join("\t"));
    }
  }
  const text = [...(bodyTemplate ? [bodyTemplate, ""] : []), ...(note ? [note, ""] : []), ...intro, ...lines].join("\n");

  const head = columns
    .map(
      (column) =>
        `<th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">${escapeHtml(column.title)}</th>`
    )
    .join("");
  const span = columns.length;
  const body = groups
    .map((group) => {
      const band = `<tr><td colspan="${span}" style="padding:8px 10px;background:#ffd966;color:#0f172a;font-weight:600;border:1px solid #e5e7eb;">${escapeHtml(group.label)}</td></tr>`;
      const data = group.rows
        .map((row) => {
          const fill = rowFill(row.changeStatus);
          const cells = columns
            .map((column) => {
              const value = mailCell(row, column.key) || "—";
              return `<td style="padding:8px 10px;border:1px solid #e5e7eb;${fill}">${escapeHtml(value)}</td>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return band + data;
    })
    .join("");
  const preface = [bodyTemplate, note].filter(Boolean).join("\n\n");
  const noteHtml = preface
    ? `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;white-space:pre-wrap;color:#0f172a;margin-bottom:12px;">${escapeHtml(preface)}</div>`
    : "";
  const summary = intro
    .map(
      (line) =>
        `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#0f172a;">${escapeHtml(line)}</div>`
    )
    .join("");
  const table = rows.length
    ? `<div style="height:12px"></div><table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    : "";
  const html = `${noteHtml}${summary}${table}`;
  return { subject, text, html };
}

function registryCell(row: TowRegistrySnapshotRow, key: (typeof TOW_REGISTRY_COLUMNS)[number]["key"]): string {
  const value = row[key];
  if (value == null || value === "") return "";
  return String(value);
}

export function buildTowEventRegistryLetter(params: {
  rows: TowRegistrySnapshotRow[];
  periodLabel: string;
  contour: string;
  note?: string | null;
}): TowRegistryLetter {
  const rows = params.rows;
  const note = String(params.note ?? "").trim();
  const inbound = rows.filter((row) => row.inMark === "назначена").length;
  const outbound = rows.filter((row) => row.outMark === "назначена").length;
  const waived = rows.filter((row) => row.inMark === "не требуется" || row.outMark === "не требуется").length;
  const subject = `Реестр буксировок ${params.periodLabel}`;
  const intro = [
    "Реестр буксировок",
    `Период: ${params.periodLabel}`,
    `Контур: ${params.contour}`,
    `Событий: ${rows.length}, закаток: ${inbound}, выкаток: ${outbound}, краёв без буксировки: ${waived}`
  ];
  const header = TOW_REGISTRY_COLUMNS.map((column) => column.title).join("\t");
  const lines = rows.map((row) => TOW_REGISTRY_COLUMNS.map((column) => registryCell(row, column.key)).join("\t"));
  const text = [...(note ? [note, ""] : []), ...intro, "", header, ...lines].join("\n");
  const head = TOW_REGISTRY_COLUMNS.map(
    (column) =>
      `<th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">${escapeHtml(column.title)}</th>`
  ).join("");
  const body = rows
    .map((row) => {
      const cells = TOW_REGISTRY_COLUMNS.map((column) => {
        const value = registryCell(row, column.key) || "—";
        return `<td style="padding:8px 10px;border:1px solid #e5e7eb;">${escapeHtml(value)}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const noteHtml = note
    ? `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;white-space:pre-wrap;color:#0f172a;margin-bottom:12px;">${escapeHtml(note)}</div>`
    : "";
  const summary = intro
    .map(
      (line) =>
        `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#0f172a;">${escapeHtml(line)}</div>`
    )
    .join("");
  const html = `${noteHtml}${summary}<div style="height:12px"></div><table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  return { subject, text, html };
}
