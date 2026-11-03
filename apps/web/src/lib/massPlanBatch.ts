import type { LineBase } from "./lineBase";

export type MassScheduleMode = "compact" | "sequential" | "fixedCadence";

export type MassBatchUnresolved = {
  operator?: string;
  aircraftType?: string;
  eventType?: string;
};

export type MassBatchGapRow = {
  operatorId: string;
  aircraftTypeId: string;
  eventTypeId: string;
  startFrom: string;
  endTo: string;
  scheduleMode: MassScheduleMode;
  cadenceHours: number;
  unresolved?: MassBatchUnresolved;
};

export type MassPlanBatchRow = MassBatchGapRow & {
  id: string;
  tatHours: number;
  workshopId: string;
  lineBase: LineBase | "";
  count: number;
  titleTemplate: string;
  spacingHours: number;
};

const SCHEDULE_MODE_BY_TOKEN: Record<string, MassScheduleMode> = {
  compact: "compact",
  компактно: "compact",
  sequential: "sequential",
  последовательно: "sequential",
  fixedcadence: "fixedCadence",
  cadence: "fixedCadence",
  фиксированныйшаг: "fixedCadence",
  фиксшаг: "fixedCadence",
  фиксcadence: "fixedCadence"
};

export function parseImportNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value == null) return fallback;
  const raw = String(value).trim().replace(",", ".");
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function scheduleModeFromToken(
  token: string,
  fallback: MassScheduleMode
): { mode: MassScheduleMode; recognized: boolean } {
  if (!token) return { mode: fallback, recognized: true };
  const mode = SCHEDULE_MODE_BY_TOKEN[token];
  if (!mode) return { mode: fallback, recognized: false };
  return { mode, recognized: true };
}

export function uniformValue<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0]!;
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== first) return undefined;
  }
  return first;
}

function ruNoun(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function joinRu(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} и ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

function formatRowList(nums: number[]): string {
  const shown = nums.slice(0, 8);
  const tail = nums.length > shown.length ? ` и ещё ${nums.length - shown.length}` : "";
  const noun = ruNoun(nums.length, "строка", "строки", "строк");
  return `${nums.length} ${noun} (${shown.join(", ")}${tail})`;
}

const MISSING_LABEL: Record<"operator" | "aircraft" | "event" | "start" | "end" | "cadence", string> = {
  operator: "оператор",
  aircraft: "тип ВС",
  event: "вид события",
  start: "начало периода",
  end: "крайний старт",
  cadence: "шаг запуска"
};

const UNRESOLVED_LABEL: Record<keyof MassBatchUnresolved, string> = {
  operator: "оператор",
  aircraftType: "тип ВС",
  eventType: "вид события"
};

export function massPlanBlockMessage(
  input:
    | { mode: "single"; operatorId: string; aircraftTypeId: string; eventTypeId: string }
    | { mode: "batch"; rows: MassBatchGapRow[] }
): string | null {
  if (input.mode === "single") {
    const missing: string[] = [];
    if (!input.operatorId) missing.push("оператора");
    if (!input.aircraftTypeId) missing.push("тип ВС");
    if (!input.eventTypeId) missing.push("вид события");
    if (missing.length === 0) return null;
    return `Предпросмотр недоступен: укажите ${joinRu(missing)}.`;
  }

  if (input.rows.length === 0) return "Предпросмотр недоступен: добавьте хотя бы одну строку.";

  const missing: Record<"operator" | "aircraft" | "event" | "start" | "end" | "cadence", number[]> = {
    operator: [],
    aircraft: [],
    event: [],
    start: [],
    end: [],
    cadence: []
  };
  const unresolved = new Map<string, { label: string; value: string; rows: number[] }>();

  input.rows.forEach((row, index) => {
    const n = index + 1;
    if (!row.operatorId) missing.operator.push(n);
    if (!row.aircraftTypeId) missing.aircraft.push(n);
    if (!row.eventTypeId) missing.event.push(n);
    if (!row.startFrom) missing.start.push(n);
    if (!row.endTo) missing.end.push(n);
    if (row.scheduleMode === "fixedCadence" && !(row.cadenceHours > 0)) missing.cadence.push(n);

    const raw = row.unresolved;
    if (!raw) return;
    (Object.keys(UNRESOLVED_LABEL) as Array<keyof MassBatchUnresolved>).forEach((key) => {
      const value = raw[key]?.trim();
      if (!value) return;
      const groupKey = `${key}\0${value}`;
      const group = unresolved.get(groupKey) ?? { label: UNRESOLVED_LABEL[key], value, rows: [] };
      group.rows.push(n);
      unresolved.set(groupKey, group);
    });
  });

  const parts: string[] = [];
  (Object.keys(missing) as Array<keyof typeof missing>).forEach((key) => {
    const nums = missing[key];
    if (nums.length === 0) return;
    parts.push(`${MISSING_LABEL[key]}: ${formatRowList(nums)}`);
  });
  const unresolvedGroups = [...unresolved.values()];
  unresolvedGroups.slice(0, 8).forEach((group) => {
    parts.push(`не найден ${group.label} «${group.value}»: ${formatRowList(group.rows)}`);
  });
  if (unresolvedGroups.length > 8) {
    parts.push(`и ещё ${unresolvedGroups.length - 8} ${ruNoun(unresolvedGroups.length - 8, "нераспознанное значение", "нераспознанных значения", "нераспознанных значений")}`);
  }

  if (parts.length === 0) return null;
  return `Предпросмотр недоступен: не заполнены обязательные поля — ${parts.join("; ")}.`;
}
