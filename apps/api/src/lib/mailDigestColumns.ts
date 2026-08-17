export const DIGEST_COLUMN_CATALOG = [
  { key: "kind", label: "Тип изменения", hint: "Добавлено, перенос или отменено" },
  { key: "operator", label: "Оператор", hint: "Колонка; блоки письма по-прежнему группируются по оператору" },
  { key: "aircraftType", label: "Тип ВС", hint: "Название типа, не код ICAO" },
  { key: "aircraftTypeCode", label: "Код типа ВС", hint: "ICAO" },
  { key: "aircraft", label: "Борт", hint: "Название — бортовой номер" },
  { key: "aircraftCode", label: "Код борта", hint: "Серийный номер" },
  { key: "title", label: "Работы", hint: "Название события" },
  { key: "detail", label: "Изменение", hint: "Что изменилось в периоде" },
  { key: "period", label: "Период", hint: "Даты события" },
  { key: "previous", label: "Ранее", hint: "Предыдущие даты" }
] as const;

export type DigestColumnKey = (typeof DIGEST_COLUMN_CATALOG)[number]["key"];

export const DIGEST_COLUMN_KEYS = DIGEST_COLUMN_CATALOG.map((c) => c.key) as [
  DigestColumnKey,
  ...DigestColumnKey[]
];

export const DEFAULT_DIGEST_COLUMNS: DigestColumnKey[] = [
  "kind",
  "aircraftType",
  "aircraft",
  "title",
  "detail",
  "previous"
];

const KEY_SET = new Set<string>(DIGEST_COLUMN_KEYS);
const LABEL_BY_KEY = new Map<string, string>(DIGEST_COLUMN_CATALOG.map((c) => [c.key, c.label]));

export const DIGEST_KIND_LABEL = {
  added: "Добавлено",
  cancelled: "Отменено",
  moved: "Перенос"
} as const;

export function parseDigestColumns(raw: unknown): DigestColumnKey[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DIGEST_COLUMNS];
  const out: DigestColumnKey[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const key = String(item ?? "").trim();
    if (!KEY_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key as DigestColumnKey);
  }
  return out.length ? out : [...DEFAULT_DIGEST_COLUMNS];
}

export function digestColumnLabel(key: string): string {
  return LABEL_BY_KEY.get(key) ?? key;
}

/** Бортовой номер как название. Серийный номер — это код, его сюда не подставляем. */
export function aircraftDisplayName(opts: {
  tailNumber?: string | null;
  virtualLabel?: string | null;
  serialNumber?: string | null;
}): string {
  const tail = opts.tailNumber?.trim();
  if (tail) return tail;
  const label = opts.virtualLabel?.trim();
  if (label) return label;
  return opts.serialNumber?.trim() || "?";
}

export function aircraftDisplayCode(opts: { serialNumber?: string | null }): string {
  return opts.serialNumber?.trim() || "";
}

/** Название типа ВС. Код ICAO — отдельное поле. */
export function aircraftTypeDisplayName(type: { name?: string | null; icaoType?: string | null } | null | undefined): string {
  if (!type) return "";
  return (type.name?.trim() || type.icaoType?.trim() || "").trim();
}

export function aircraftTypeDisplayCode(type: { icaoType?: string | null } | null | undefined): string {
  return type?.icaoType?.trim() || "";
}

export type DigestRowCells = {
  kind: keyof typeof DIGEST_KIND_LABEL;
  operatorLabel: string;
  aircraftTypeName: string;
  aircraftTypeCode: string;
  aircraftName: string;
  aircraftCode: string;
  title: string;
  detail: string;
  period: string;
  previous: string;
};

export function digestCellText(row: DigestRowCells, key: string): string {
  switch (key) {
    case "kind":
      return DIGEST_KIND_LABEL[row.kind] ?? row.kind;
    case "operator":
      return row.operatorLabel;
    case "aircraftType":
      return row.aircraftTypeName;
    case "aircraftTypeCode":
      return row.aircraftTypeCode;
    case "aircraft":
      return row.aircraftName;
    case "aircraftCode":
      return row.aircraftCode;
    case "title":
      return row.title;
    case "detail":
      return row.detail;
    case "period":
      return row.period;
    case "previous":
      return row.previous;
    default:
      return "";
  }
}
