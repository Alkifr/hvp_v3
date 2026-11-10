import { availabilityKey, dateKey, mondayOfWeek } from "./personnelPlanning";

export const RESOURCE_ROW_HEIGHT = {
  banner: 38,
  note: 64,
  input: 36,
  sum: 52
} as const;

const DEPT_LABEL: Record<string, string> = {
  ME: "ME",
  AV: "AV",
  INT: "INT",
  NDT: "NDT",
  SHOP: "SHOP",
  CAB_REP: "Cabin repair",
  PAINT: "Paint"
};

export type ResourceGridSheet = {
  workshopId: string;
  code: string;
  name: string;
  aircraftTypes: Array<{ id: string; name: string; icaoType?: string | null }>;
  mappedCategories: Array<{ categoryCode: string; skillId?: string | null; department: string | null }>;
  items: Array<{
    date: string;
    shiftId: string;
    aircraftTypeId: string;
    categoryCode: string | null;
    skillId?: string | null;
    skill?: { code?: string | null } | null;
    headcount: number | string;
  }>;
  weeks: Array<{ weekStart: string; version: number; isLocked: boolean }>;
};

type InputResourceRow = {
  kind: "input";
  key: string;
  height: number;
  workshopId: string;
  workshopLabel: string;
  token: string;
  categoryCode: string;
  typeId: string;
  typeLabel: string;
  title: string;
};

type AggregateResourceRow = {
  kind: "aggregate";
  key: string;
  height: number;
  className: "personnelSumRow" | "personnelTotalRow" | "personnelGrandTotalRow";
  workshopId: string;
  title: string;
  hint: string;
  typeLabel: string;
  typeIds: string[];
  tokens: string[];
};

export type ResourceRow =
  | { kind: "banner"; key: string; height: number; label: string }
  | { kind: "note"; key: string; height: number; text: string }
  | InputResourceRow
  | AggregateResourceRow;

export function resourceCellKey(workshopId: string, date: string, shiftId: string, aircraftTypeId: string, token: string) {
  return `${workshopId}|${availabilityKey(date, shiftId, aircraftTypeId, token)}`;
}

function categoryToken(row: { skillId?: string | null; categoryCode: string }) {
  return row.skillId || row.categoryCode;
}

function workshopLabel(sheet: { code: string; name: string }) {
  return sheet.name && sheet.name !== sheet.code ? `${sheet.code} · ${sheet.name}` : (sheet.code || "Цех");
}

export function buildResourceRows(sheets: readonly ResourceGridSheet[]): ResourceRow[] {
  const rows: ResourceRow[] = [];
  for (const sheet of sheets) {
    const label = workshopLabel(sheet);
    rows.push({ kind: "banner", key: `${sheet.workshopId}:banner`, height: RESOURCE_ROW_HEIGHT.banner, label });
    const categories = sheet.mappedCategories.filter((row) => categoryToken(row));
    const types = sheet.aircraftTypes;
    if (!categories.length) {
      rows.push({
        kind: "note",
        key: `${sheet.workshopId}:no-skills`,
        height: RESOURCE_ROW_HEIGHT.note,
        text: "Для цеха не назначены квалификации. Укажите их в справочнике «Состав категорий»."
      });
      continue;
    }
    if (!types.length) {
      rows.push({
        kind: "note",
        key: `${sheet.workshopId}:no-types`,
        height: RESOURCE_ROW_HEIGHT.note,
        text: "Для цеха нет типов ВС. Привяжите борты в справочнике «Борт и цех»."
      });
      continue;
    }
    const departments: string[] = [];
    for (const row of categories) if (row.department && !departments.includes(row.department)) departments.push(row.department);
    const allTokens = categories.map(categoryToken);
    for (const type of types) {
      const typeLabel = type.icaoType || type.name;
      for (const department of departments) {
        const qualifications = categories.filter((row) => row.department === department);
        for (const mapping of qualifications) {
          const token = categoryToken(mapping);
          rows.push({
            kind: "input",
            key: `${sheet.workshopId}:${token}:${type.id}`,
            height: RESOURCE_ROW_HEIGHT.input,
            workshopId: sheet.workshopId,
            workshopLabel: label,
            token,
            categoryCode: mapping.categoryCode,
            typeId: type.id,
            typeLabel,
            title: mapping.categoryCode
          });
        }
        rows.push({
          kind: "aggregate",
          key: `${sheet.workshopId}:sum:${department}:${type.id}`,
          height: RESOURCE_ROW_HEIGHT.sum,
          className: "personnelSumRow",
          workshopId: sheet.workshopId,
          title: DEPT_LABEL[department] ?? department,
          hint: qualifications.map((row) => row.categoryCode).join(" + "),
          typeLabel,
          typeIds: [type.id],
          tokens: qualifications.map(categoryToken)
        });
      }
      for (const mapping of categories) {
        if (mapping.department) continue;
        const token = categoryToken(mapping);
        rows.push({
          kind: "input",
          key: `${sheet.workshopId}:${token}:${type.id}`,
          height: RESOURCE_ROW_HEIGHT.input,
          workshopId: sheet.workshopId,
          workshopLabel: label,
          token,
          categoryCode: mapping.categoryCode,
          typeId: type.id,
          typeLabel,
          title: mapping.categoryCode
        });
      }
      rows.push({
        kind: "aggregate",
        key: `${sheet.workshopId}:total:${type.id}`,
        height: RESOURCE_ROW_HEIGHT.sum,
        className: "personnelTotalRow",
        workshopId: sheet.workshopId,
        title: "Итого",
        hint: "численность",
        typeLabel,
        typeIds: [type.id],
        tokens: allTokens
      });
    }
    rows.push({
      kind: "aggregate",
      key: `${sheet.workshopId}:grand`,
      height: RESOURCE_ROW_HEIGHT.sum,
      className: "personnelGrandTotalRow",
      workshopId: sheet.workshopId,
      title: "Итого",
      hint: "все типы ВС",
      typeLabel: "Все",
      typeIds: types.map((type) => type.id),
      tokens: allTokens
    });
  }
  return rows;
}

export function prefixOffsets(heights: readonly number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < heights.length; index += 1) offsets[index + 1] = offsets[index]! + heights[index]!;
  return offsets;
}

/** Видимые строки таблицы с учётом липкой шапки. end не включается. */
export function visibleRowRange(
  offsets: readonly number[],
  scrollTop: number,
  viewport: number,
  theadHeight: number,
  overscan: number
): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const viewTop = top - overscan;
  const viewBottom = top + Math.max(0, viewport - Math.max(0, theadHeight)) + overscan;
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1]! <= viewTop) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  lo = start;
  hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! < viewBottom) lo = mid + 1;
    else hi = mid;
  }
  return { start: Math.min(start, count), end: Math.min(count, Math.max(lo, start)) };
}

type Listener = () => void;
type CellEdit = { value: string; pinned: boolean };

const PERSONNEL_DRAFT_KEY = "hangarPlanning:personnelDraft:v1";

function readPersistedEdits(): Map<string, CellEdit> {
  const edits = new Map<string, CellEdit>();
  if (typeof sessionStorage === "undefined") return edits;
  try {
    const raw = JSON.parse(sessionStorage.getItem(PERSONNEL_DRAFT_KEY) ?? "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return edits;
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!key || !entry || typeof entry !== "object" || typeof (entry as { value?: unknown }).value !== "string") continue;
      edits.set(key, { value: (entry as { value: string }).value, pinned: Boolean((entry as { pinned?: unknown }).pinned) });
    }
  } catch {
    return new Map();
  }
  return edits;
}

function writePersistedEdits(edits: Map<string, CellEdit>) {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!edits.size) {
      sessionStorage.removeItem(PERSONNEL_DRAFT_KEY);
      return;
    }
    const payload: Record<string, CellEdit> = {};
    for (const [key, edit] of edits) payload[key] = { value: edit.value, pinned: edit.pinned };
    sessionStorage.setItem(PERSONNEL_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Хранилище может быть недоступно или переполнено: ячейки остаются в памяти вкладки.
  }
}

export class PersonnelDraftStore {
  private clean = new Map<string, string>();
  private edits = readPersistedEdits();
  private cellListeners = new Map<string, Set<Listener>>();
  private anyListeners = new Set<Listener>();
  private dirtyListeners = new Set<Listener>();
  dirtyCount = 0;

  constructor() {
    this.dirtyCount = this.countDirty();
  }

  get(key: string) {
    const edit = this.edits.get(key);
    if (edit) return edit.value;
    return this.clean.get(key) ?? "";
  }

  isDirty(key: string) {
    const edit = this.edits.get(key);
    return Boolean(edit && !edit.pinned);
  }

  subscribe(key: string, listener: Listener) {
    let set = this.cellListeners.get(key);
    if (!set) {
      set = new Set();
      this.cellListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.cellListeners.delete(key);
    };
  }

  subscribeAny(listener: Listener) {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  subscribeDirty(listener: Listener) {
    this.dirtyListeners.add(listener);
    return () => {
      this.dirtyListeners.delete(listener);
    };
  }

  set(key: string, value: string) {
    if (this.get(key) === value) return;
    const cleanValue = this.clean.get(key) ?? "";
    if (value === cleanValue) this.edits.delete(key);
    else this.edits.set(key, { value, pinned: false });
    this.dirtyCount = this.countDirty();
    writePersistedEdits(this.edits);
    this.emitCell(key);
    this.emitAny();
    this.emitDirty();
  }

  dirtyKeys() {
    const dirty: string[] = [];
    for (const [key, edit] of this.edits) if (!edit.pinned) dirty.push(key);
    return dirty;
  }

  /** Убирает несохранённые правки и возвращает ячейки к последнему серверному снимку. */
  discardUnsaved() {
    const keys = this.dirtyKeys();
    if (!keys.length) return;
    for (const key of keys) this.edits.delete(key);
    this.dirtyCount = this.countDirty();
    writePersistedEdits(this.edits);
    for (const key of keys) this.emitCell(key);
    this.emitAny();
    this.emitDirty();
  }

  /** Подменяет серверный снимок. Правка остаётся, пока ответ не принесёт то же число. */
  applyBaseline(baseline: Readonly<Record<string, string>>) {
    const nextClean = new Map<string, string>();
    for (const [key, value] of Object.entries(baseline)) if (value !== "") nextClean.set(key, value);
    for (const [key, edit] of this.edits) {
      if ((nextClean.get(key) ?? "") === edit.value) this.edits.delete(key);
    }
    this.clean = nextClean;
    this.dirtyCount = this.countDirty();
    writePersistedEdits(this.edits);
  }

  markCleanIfUnchanged(entries: ReadonlyArray<readonly [string, string]>) {
    let changed = false;
    for (const [key, saved] of entries) {
      if (this.get(key) !== saved) continue;
      if ((this.clean.get(key) ?? "") === saved) this.edits.delete(key);
      else this.edits.set(key, { value: saved, pinned: true });
      if (saved) this.clean.set(key, saved);
      else this.clean.delete(key);
      this.emitCell(key);
      changed = true;
    }
    if (!changed) return;
    this.dirtyCount = this.countDirty();
    writePersistedEdits(this.edits);
    this.emitAny();
    this.emitDirty();
  }

  private countDirty() {
    let count = 0;
    for (const edit of this.edits.values()) if (!edit.pinned) count += 1;
    return count;
  }

  private emitCell(key: string) {
    const set = this.cellListeners.get(key);
    if (!set) return;
    for (const listener of set) listener();
  }

  private emitAny() {
    for (const listener of this.anyListeners) listener();
  }

  private emitDirty() {
    for (const listener of this.dirtyListeners) listener();
  }
}

export function baselineFromSheets(sheets: readonly ResourceGridSheet[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sheet of sheets) {
    const tokens = new Set(sheet.mappedCategories.map((row) => categoryToken(row)).filter(Boolean));
    const write = (token: string, row: ResourceGridSheet["items"][number], overwrite: boolean) => {
      if (!token || !tokens.has(token)) return;
      const headcount = Number(row.headcount);
      if (!Number.isFinite(headcount)) return;
      const key = resourceCellKey(sheet.workshopId, dateKey(row.date), row.shiftId, row.aircraftTypeId, token);
      if (!overwrite && Object.hasOwn(out, key)) return;
      out[key] = String(headcount);
    };
    for (const row of sheet.items) if (row.categoryCode) write(row.categoryCode, row, true);
    for (const row of sheet.items) {
      if (row.categoryCode) continue;
      write(row.skill?.code ?? "", row, false);
    }
  }
  return out;
}

export type AvailabilityWriteGroup = {
  workshopId: string;
  weekStart: string;
  items: Array<{
    date: string;
    shiftId: string;
    aircraftTypeId: string;
    categoryCode: string;
    skillId?: string;
    headcount: number;
  }>;
  entries: Array<[string, string]>;
};

export function groupAvailabilityWrites(
  keys: readonly string[],
  valueOf: (key: string) => string,
  categoryOf: (workshopId: string, token: string) => { categoryCode: string; skillId?: string | null } | null
): AvailabilityWriteGroup[] {
  const groups = new Map<string, AvailabilityWriteGroup>();
  for (const key of keys) {
    const parts = key.split("|");
    if (parts.length !== 5) throw new Error("Не удалось собрать ячейку для сохранения");
    const workshopId = parts[0]!;
    const date = parts[1]!;
    const shiftId = parts[2]!;
    const aircraftTypeId = parts[3]!;
    const token = parts[4]!;
    const category = categoryOf(workshopId, token);
    if (!category?.categoryCode) throw new Error("Не удалось сопоставить квалификацию для сохранения");
    const numeric = Number(valueOf(key));
    const headcount = Math.max(0, Math.min(100_000, Math.round(Number.isFinite(numeric) ? numeric : 0)));
    const weekStart = mondayOfWeek(date);
    const bucket = `${workshopId}|${weekStart}`;
    let group = groups.get(bucket);
    if (!group) {
      group = { workshopId, weekStart, items: [], entries: [] };
      groups.set(bucket, group);
    }
    group.entries.push([key, valueOf(key)]);
    group.items.push({
      date,
      shiftId,
      aircraftTypeId,
      categoryCode: category.categoryCode,
      ...(category.skillId ? { skillId: category.skillId } : {}),
      headcount
    });
  }
  return [...groups.values()];
}
