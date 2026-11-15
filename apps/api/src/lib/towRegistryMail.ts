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

function cell(row: TowReportRow, key: (typeof TOW_EXPORT_COLUMNS)[number]["key"]): string {
  const value = row[key];
  if (value == null || value === "") return "";
  return String(value);
}

export function buildTowRegistryLetter(params: {
  rows: TowReportRow[];
  periodLabel: string;
  contour: string;
  note?: string | null;
}): TowRegistryLetter {
  const rows = params.rows;
  const note = String(params.note ?? "").trim();
  const inbound = rows.filter((row) => row.direction === "IN").length;
  const outbound = rows.filter((row) => row.direction === "OUT").length;
  const subject = `Реестр буксировок ${params.periodLabel}`;
  const intro = [
    "Реестр буксировок",
    `Период: ${params.periodLabel}`,
    `Контур: ${params.contour}`,
    `Строк: ${rows.length}, закаток: ${inbound}, выкаток: ${outbound}`
  ];
  const header = TOW_EXPORT_COLUMNS.map((column) => column.title).join("\t");
  const lines = rows.map((row) => TOW_EXPORT_COLUMNS.map((column) => cell(row, column.key)).join("\t"));
  const text = [...(note ? [note, ""] : []), ...intro, "", header, ...lines].join("\n");

  const head = TOW_EXPORT_COLUMNS.map(
    (column) =>
      `<th style="padding:8px 10px;text-align:left;background:#f3f4f6;border:1px solid #e5e7eb;">${escapeHtml(column.title)}</th>`
  ).join("");
  const body = rows
    .map((row) => {
      const cells = TOW_EXPORT_COLUMNS.map((column) => {
        const value = cell(row, column.key) || "—";
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
