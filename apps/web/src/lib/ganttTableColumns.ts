export type GanttTableColId = string;

export type GanttTableColDef = {
  id: GanttTableColId;
  label: string;
  group: string | null;
  subgroup: string | null;
  defaultWidth: number;
  minWidth: number;
  sticky?: "left";
  hideable?: boolean;
  kind: GanttCellKind;
};

export type GanttCellKind =
  | "actions"
  | "title"
  | "level"
  | "status"
  | "planningKind"
  | "aircraftId"
  | "operator"
  | "aircraftType"
  | "eventTypeId"
  | "workshopId"
  | "startAtLocal"
  | "endAtLocal"
  | "tatPlanDays"
  | "tatPlanHours"
  | "budgetStartAtLocal"
  | "budgetEndAtLocal"
  | "tatBudgetDays"
  | "actualStartAtLocal"
  | "actualEndAtLocal"
  | "tatActualDays"
  | "tatActualHours"
  | "hangarId"
  | "layoutId"
  | "standId"
  | "allowOverlap"
  | "notes"
  | "timeOfStart"
  | "timeOfEnd"
  | "timeOfActualStart"
  | "timeOfActualEnd"
  | "primary";

export type PrimaryCatalogField = {
  key: string;
  label: string;
  excelColumn?: string;
  group?: string | null;
  subgroup?: string | null;
  type?: string;
};

export type GanttTableColConfig = {
  widths: Record<string, number>;
  /** Allowlist видимых столбцов. Если нет — смотрим hidden (legacy). */
  visible?: string[];
  hidden: string[];
  order: string[];
};

export const TABLE_KEY = "gantt_events";
export const TABLE_COLS_LS_KEY = "hangarPlanning:ganttTableColumns:v8";
const LEGACY_LS_KEYS = [
  "hangarPlanning:ganttTableColumns:v7",
  "hangarPlanning:ganttTableColumns:v6",
  "hangarPlanning:ganttTableColumns:v5",
  "hangarPlanning:ganttTableColumns:v4",
  "hangarPlanning:ganttTableColumns:v2",
  "hangarPlanning:ganttTableColumns:v1"
];
/** Allowlist на весь каталог — следствие старого denylist `hidden: []`, не пользовательский набор. */
const FULL_CATALOG_VISIBLE_THRESHOLD = 80;

const LEGACY_COL_MAP: Record<string, GanttTableColId> = {
  actions: "actions",
  title: "primary.k",
  level: "level",
  status: "primary.ai",
  planningKind: "primary.p",
  aircraftId: "primary.g",
  operator: "primary.e",
  aircraftType: "primary.h",
  eventTypeId: "primary.l",
  workshopId: "primary.ah",
  startAtLocal: "primary.y",
  endAtLocal: "primary.z",
  tatOper: "primary.ab",
  budgetStartAtLocal: "primary.u",
  budgetEndAtLocal: "primary.v",
  tatBudget: "primary.w",
  actualStartAtLocal: "primary.al",
  actualEndAtLocal: "primary.am",
  tatActual: "primary.ao",
  hangarId: "primary.af",
  layoutId: "layoutId",
  standId: "primary.ag",
  allowOverlap: "allowOverlap",
  notes: "primary.ae"
};

const KIND_BY_ID: Record<string, GanttCellKind> = {
  actions: "actions",
  "primary.k": "title",
  level: "level",
  "primary.ai": "status",
  "primary.p": "planningKind",
  "primary.g": "aircraftId",
  "primary.e": "operator",
  "primary.h": "aircraftType",
  "primary.l": "eventTypeId",
  "primary.ah": "workshopId",
  "primary.y": "startAtLocal",
  "primary.z": "endAtLocal",
  "primary.x": "timeOfStart",
  "primary.aa": "timeOfEnd",
  "primary.ab": "tatPlanDays",
  "primary.ac": "tatPlanHours",
  "primary.u": "budgetStartAtLocal",
  "primary.v": "budgetEndAtLocal",
  "primary.w": "tatBudgetDays",
  "primary.al": "actualStartAtLocal",
  "primary.am": "actualEndAtLocal",
  "primary.ak": "timeOfActualStart",
  "primary.an": "timeOfActualEnd",
  "primary.ao": "tatActualDays",
  "primary.ap": "tatActualHours",
  "primary.af": "hangarId",
  layoutId: "layoutId",
  "primary.ag": "standId",
  allowOverlap: "allowOverlap",
  "primary.ae": "notes"
};

/** Реквизиты, которые таблица рисует из события Ганта — primary-query для них не нужен. */
export const EVENT_NATIVE_COL_IDS = new Set<string>([
  "actions",
  "level",
  "layoutId",
  "allowOverlap",
  ...Object.keys(KIND_BY_ID).filter((id) => id.startsWith("primary."))
]);

export const PINNED_LEFT_IDS: GanttTableColId[] = ["actions", "primary.k"];

export const DEFAULT_VISIBLE_IDS: GanttTableColId[] = [
  "actions",
  "primary.k",
  "level",
  "primary.ai",
  "primary.p",
  "primary.g",
  "primary.e",
  "primary.h",
  "primary.l",
  "primary.ah",
  "primary.y",
  "primary.z",
  "primary.ab",
  "primary.u",
  "primary.v",
  "primary.w",
  "primary.al",
  "primary.am",
  "primary.ao",
  "primary.af",
  "layoutId",
  "primary.ag",
  "allowOverlap",
  "primary.ae"
];

const EXTRA_COLUMNS: GanttTableColDef[] = [
  {
    id: "actions",
    label: "Действия",
    group: "План (Гантт)",
    subgroup: null,
    defaultWidth: 108,
    minWidth: 96,
    sticky: "left",
    hideable: false,
    kind: "actions"
  },
  {
    id: "level",
    label: "Уровень",
    group: "План (Гантт)",
    subgroup: null,
    defaultWidth: 120,
    minWidth: 80,
    kind: "level"
  },
  {
    id: "layoutId",
    label: "Вариант",
    group: "План (Гантт)",
    subgroup: null,
    defaultWidth: 140,
    minWidth: 80,
    kind: "layoutId"
  },
  {
    id: "allowOverlap",
    label: "Нахлёст",
    group: "План (Гантт)",
    subgroup: null,
    defaultWidth: 80,
    minWidth: 56,
    kind: "allowOverlap"
  }
];

const FALLBACK_PRIMARY_LABELS: Record<string, { label: string; group: string }> = {
  "primary.a": { label: "Фюзеляж", group: "Идентификация и классификация" },
  "primary.k": { label: "Форма ТО", group: "Идентификация и классификация" },
  "primary.ai": { label: "Статус выполнения", group: "Слот План (Согласованный слот)" },
  "primary.p": { label: "Слот для ТО (плановый/внеплановый)", group: "Идентификация и классификация" },
  "primary.g": { label: "Номер ВС", group: "Идентификация и классификация" },
  "primary.e": { label: "Заказчик", group: "Идентификация и классификация" },
  "primary.h": { label: "Тип ВС", group: "Идентификация и классификация" },
  "primary.l": { label: "Нормализованная форма", group: "Идентификация и классификация" },
  "primary.ah": { label: "Подразделение", group: "Слот План (Согласованный слот)" },
  "primary.y": { label: "Дата начала слота (План)", group: "Слот План (Согласованный слот)" },
  "primary.z": { label: "Дата окончания слота (План)", group: "Слот План (Согласованный слот)" },
  "primary.ab": { label: "Продолжительность слота (Дни) (План)", group: "Слот План (Согласованный слот)" },
  "primary.u": { label: "Дата начала слота (План Бюджет)", group: "Слот Бюджет (C-CHECK)" },
  "primary.v": { label: "Дата окончания слота (План Бюджет)", group: "Слот Бюджет (C-CHECK)" },
  "primary.w": { label: "Продолжительность слота(Дни)", group: "Слот Бюджет (C-CHECK)" },
  "primary.al": { label: "Дата начала слота (Факт)", group: "Слот Факт (Фактический слот)" },
  "primary.am": { label: "Дата окончания слота (Факт)", group: "Слот Факт (Фактический слот)" },
  "primary.ao": { label: "Продолжительность слота (Дни) (Факт)", group: "Слот Факт (Фактический слот)" },
  "primary.af": { label: "Номер ангара", group: "Слот План (Согласованный слот)" },
  "primary.ag": { label: "Номер МС в ангаре", group: "Слот План (Согласованный слот)" },
  "primary.ae": { label: "Комментарии ИТП / Специфические работы", group: "Слот План (Согласованный слот)" }
};

function kindForId(id: string): GanttCellKind {
  return KIND_BY_ID[id] ?? "primary";
}

function widthForField(field: PrimaryCatalogField): { defaultWidth: number; minWidth: number } {
  const type = field.type ?? "";
  if (type === "date" || type === "datetime") return { defaultWidth: 150, minWidth: 110 };
  if (type === "number" || type === "integer" || type === "percent" || type === "currency") {
    return { defaultWidth: 110, minWidth: 72 };
  }
  if (field.key === "primary.k" || field.key === "primary.ae") return { defaultWidth: 180, minWidth: 100 };
  return { defaultWidth: 140, minWidth: 90 };
}

function primaryColDef(field: PrimaryCatalogField): GanttTableColDef {
  const { defaultWidth, minWidth } = widthForField(field);
  return {
    id: field.key,
    label: field.label,
    group: field.group ?? "Первичная таблица",
    subgroup: field.subgroup ?? null,
    defaultWidth,
    minWidth,
    sticky: field.key === "primary.k" ? "left" : undefined,
    hideable: field.key === "primary.k" ? false : undefined,
    kind: kindForId(field.key)
  };
}

export function buildGanttTableColumns(catalog: PrimaryCatalogField[] | null | undefined): GanttTableColDef[] {
  const extrasById = new Map(EXTRA_COLUMNS.map((c) => [c.id, c]));
  const catalogCols = (catalog ?? []).filter((f) => f.key.startsWith("primary.")).map(primaryColDef);
  const catalogById = new Map(catalogCols.map((c) => [c.id, c]));

  const out: GanttTableColDef[] = [];
  const seen = new Set<string>();
  const push = (col: GanttTableColDef | undefined) => {
    if (!col || seen.has(col.id)) return;
    seen.add(col.id);
    out.push(col);
  };

  push(extrasById.get("actions"));
  if (catalogById.has("primary.k")) push(catalogById.get("primary.k"));
  else {
    const fb = FALLBACK_PRIMARY_LABELS["primary.k"]!;
    push({
      id: "primary.k",
      label: fb.label,
      group: fb.group,
      subgroup: null,
      defaultWidth: 180,
      minWidth: 100,
      sticky: "left",
      hideable: false,
      kind: "title"
    });
  }
  push(extrasById.get("level"));

  for (const id of DEFAULT_VISIBLE_IDS) {
    if (id === "actions" || id === "primary.k" || id === "level") continue;
    if (extrasById.has(id)) {
      push(extrasById.get(id));
      continue;
    }
    if (catalogById.has(id)) {
      push(catalogById.get(id));
      continue;
    }
    const fb = FALLBACK_PRIMARY_LABELS[id];
    if (fb) {
      push({
        id,
        label: fb.label,
        group: fb.group,
        subgroup: null,
        ...widthForField({ key: id, label: fb.label }),
        kind: kindForId(id)
      });
    }
  }

  for (const col of catalogCols) push(col);
  for (const col of EXTRA_COLUMNS) push(col);
  return out;
}

export function defaultHiddenIds(columns: GanttTableColDef[]): GanttTableColId[] {
  const visible = new Set(DEFAULT_VISIBLE_IDS);
  return columns.filter((c) => c.hideable !== false && !visible.has(c.id)).map((c) => c.id);
}

export function factoryVisibleIds(columns: GanttTableColDef[]): GanttTableColId[] {
  const known = new Set(columns.map((c) => c.id));
  const ids = DEFAULT_VISIBLE_IDS.filter((id) => known.has(id));
  for (const id of PINNED_LEFT_IDS) {
    if (known.has(id) && !ids.includes(id)) ids.unshift(id);
  }
  return ids;
}

/** Заводской набор: исходные 24 столбца Ганта, остальные скрыты. */
export function factoryColumnConfig(columns: GanttTableColDef[]): GanttTableColConfig {
  const visible = factoryVisibleIds(columns);
  return {
    widths: defaultWidths(columns),
    visible,
    hidden: defaultHiddenIds(columns),
    order: visible
  };
}

/** Пустой/урезанный hidden при широком каталоге — это не «показать всё», а старый кэш. */
export function shouldUseFactoryHidden(hidden: string[] | undefined, columnCount: number): boolean {
  if (columnCount <= DEFAULT_VISIBLE_IDS.length) return false;
  if (!Array.isArray(hidden) || hidden.length === 0) return true;
  const extras = columnCount - DEFAULT_VISIBLE_IDS.length;
  return extras > 20 && hidden.length < extras / 2;
}

export function isFullCatalogVisible(visible: string[] | undefined, columnCount: number): boolean {
  if (!Array.isArray(visible) || columnCount < FULL_CATALOG_VISIBLE_THRESHOLD) return false;
  return visible.length >= columnCount - 2;
}

export function resolveVisibleIds(
  config: GanttTableColConfig | null | undefined,
  columns: GanttTableColDef[],
  opts?: { allowShowAll?: boolean }
): GanttTableColId[] {
  const known = new Set(columns.map((c) => c.id));
  const factory = factoryVisibleIds(columns);
  const pinned = PINNED_LEFT_IDS.filter((id) => known.has(id));
  if (Array.isArray(config?.visible) && config.visible.length > 0) {
    if (!opts?.allowShowAll && isFullCatalogVisible(config.visible, columns.length)) return factory;
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of [...pinned, ...config.visible]) {
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids.length ? ids : factory;
  }
  const hiddenList = config?.hidden;
  const canUseHidden = Boolean(config) && (opts?.allowShowAll || !shouldUseFactoryHidden(hiddenList, columns.length));
  if (canUseHidden) {
    const hidden = new Set(hiddenList ?? []);
    const ids = columns.filter((c) => c.hideable === false || !hidden.has(c.id)).map((c) => c.id);
    if (!opts?.allowShowAll && isFullCatalogVisible(ids, columns.length)) return factory;
    return ids;
  }
  return factory;
}

export function defaultWidths(columns: GanttTableColDef[]): Record<string, number> {
  return Object.fromEntries(columns.map((c) => [c.id, c.defaultWidth]));
}

export function normalizeColOrder(order: unknown, columns: GanttTableColDef[]): GanttTableColId[] {
  const defaultOrder = columns.map((c) => c.id);
  const known = new Set(defaultOrder);
  const seen = new Set<GanttTableColId>();
  const middle: GanttTableColId[] = [];
  if (Array.isArray(order)) {
    for (const id of order) {
      if (typeof id !== "string" || !known.has(id)) continue;
      if (PINNED_LEFT_IDS.includes(id) || seen.has(id)) continue;
      seen.add(id);
      middle.push(id);
    }
  }
  for (const id of defaultOrder) {
    if (PINNED_LEFT_IDS.includes(id) || seen.has(id)) continue;
    middle.push(id);
  }
  return [...PINNED_LEFT_IDS.filter((id) => known.has(id)), ...middle];
}

function migrateLegacyId(id: string): string | null {
  if (id.startsWith("primary.") || id === "actions" || id === "level" || id === "layoutId" || id === "allowOverlap") {
    return id;
  }
  return LEGACY_COL_MAP[id] ?? null;
}

function migrateConfig(raw: {
  widths?: Record<string, number>;
  hidden?: string[];
  order?: string[];
}): GanttTableColConfig {
  const widths: Record<string, number> = {};
  for (const [id, w] of Object.entries(raw.widths ?? {})) {
    const mapped = migrateLegacyId(id);
    if (mapped && Number.isFinite(Number(w))) widths[mapped] = Number(w);
  }
  const hidden = (raw.hidden ?? []).map(migrateLegacyId).filter((id): id is string => Boolean(id));
  const order = (raw.order ?? []).map(migrateLegacyId).filter((id): id is string => Boolean(id));
  const visibleRaw = Array.isArray((raw as { visible?: unknown }).visible)
    ? ((raw as { visible: unknown[] }).visible.map((id) => (typeof id === "string" ? migrateLegacyId(id) : null)).filter(
        (id): id is string => Boolean(id)
      ))
    : undefined;
  const visible = visibleRaw && visibleRaw.length < 150 ? visibleRaw : undefined;
  return { widths, hidden, order, visible };
}

export function safeReadTableCols(): GanttTableColConfig | null {
  try {
    if (typeof window === "undefined") return null;
    const raw =
      window.localStorage.getItem(TABLE_COLS_LS_KEY) ??
      LEGACY_LS_KEYS.map((k) => window.localStorage.getItem(k)).find(Boolean) ??
      null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { widths?: Record<string, number>; hidden?: string[]; order?: string[] };
    return migrateConfig(parsed);
  } catch {
    return null;
  }
}

export function safeWriteTableCols(v: GanttTableColConfig) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TABLE_COLS_LS_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

export function extraPrimaryFieldKeys(visibleIds: string[]): string[] {
  return visibleIds.filter((id) => id.startsWith("primary.") && !EVENT_NATIVE_COL_IDS.has(id));
}

export function formatPrimaryCell(value: unknown, field?: { key?: string; label?: string | null }): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (
      field &&
      ((field.label && /продолжительность/i.test(field.label)) ||
        /^(primary\.(t|w|ab|ac|ao|ap|aq|as|at))$/.test(field.key ?? ""))
    ) {
      return value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }
  return String(value);
}
