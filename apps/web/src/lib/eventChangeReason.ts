/** Причина изменения события. Правило совпадает с apps/api/src/lib/changeReason.ts. */

export const CANCELLED_EVENT_STATUS = "CANCELLED";

const DATE_FIELDS = new Set([
  "startAt",
  "endAt",
  "startAtLocal",
  "endAtLocal",
  "budgetStartAt",
  "budgetEndAt",
  "budgetStartAtLocal",
  "budgetEndAtLocal",
  "actualStartAt",
  "actualEndAt",
  "actualStartAtLocal",
  "actualEndAtLocal",
  "deadlineAt",
  "deadlineAtLocal"
]);

const BOARD_FIELDS = new Set(["aircraftId", "virtualAircraft"]);
const HANGAR_FIELDS = new Set(["hangarId"]);

type PlacementLike = {
  startAt?: unknown;
  endAt?: unknown;
  budgetStartAt?: unknown;
  budgetEndAt?: unknown;
  actualStartAt?: unknown;
  actualEndAt?: unknown;
  startAtLocal?: unknown;
  endAtLocal?: unknown;
  budgetStartAtLocal?: unknown;
  budgetEndAtLocal?: unknown;
  actualStartAtLocal?: unknown;
  actualEndAtLocal?: unknown;
  hangarId?: unknown;
};

export type EventReasonDraft = {
  status?: unknown;
  aircraftId?: unknown;
  startAtLocal?: unknown;
  endAtLocal?: unknown;
  budgetStartAtLocal?: unknown;
  budgetEndAtLocal?: unknown;
  actualStartAtLocal?: unknown;
  actualEndAtLocal?: unknown;
  deadlineAtLocal?: unknown;
  hangarId?: unknown;
  placements?: unknown;
};

function clockMinute(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? Math.floor(time / 60_000) : null;
  }
  const text = String(value).trim();
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? Math.floor(time / 60_000) : null;
}

function hangarToken(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function scheduleToken(localValue: unknown, instantValue: unknown): string {
  if (localValue != null && localValue !== "") return `l:${String(localValue)}`;
  const minute = clockMinute(instantValue);
  return minute == null ? "" : `m:${minute}`;
}

function placementReasonKey(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return JSON.stringify(
    value.map((row) => {
      const placement = (row ?? {}) as PlacementLike;
      return {
        start: scheduleToken(placement.startAtLocal, placement.startAt),
        end: scheduleToken(placement.endAtLocal, placement.endAt),
        budgetStart: scheduleToken(placement.budgetStartAtLocal, placement.budgetStartAt),
        budgetEnd: scheduleToken(placement.budgetEndAtLocal, placement.budgetEndAt),
        actualStart: scheduleToken(placement.actualStartAtLocal, placement.actualStartAt),
        actualEnd: scheduleToken(placement.actualEndAtLocal, placement.actualEndAt),
        hangarId: hangarToken(placement.hangarId)
      };
    })
  );
}

/** Смена дат или ангара внутри этапов. Место и схема причину не требуют. */
export function placementChangeNeedsReason(from: unknown, to: unknown): boolean {
  return placementReasonKey(from) !== placementReasonKey(to);
}

export function eventDraftNeedsChangeReason(before: EventReasonDraft, after: EventReasonDraft): boolean {
  if (String(after.status ?? "") === CANCELLED_EVENT_STATUS && String(before.status ?? "") !== CANCELLED_EVENT_STATUS) {
    return true;
  }
  const fields: Array<keyof EventReasonDraft> = [
    "aircraftId",
    "startAtLocal",
    "endAtLocal",
    "budgetStartAtLocal",
    "budgetEndAtLocal",
    "actualStartAtLocal",
    "actualEndAtLocal",
    "deadlineAtLocal",
    "hangarId"
  ];
  for (const field of fields) {
    if (String(before[field] ?? "") !== String(after[field] ?? "")) return true;
  }
  return placementChangeNeedsReason(before.placements, after.placements);
}

type ReasonDiff = { field: string; from?: unknown; to?: unknown };

/** Причина по списку отличий карточки или строки таблицы. */
export function eventDiffNeedsChangeReason(diffs: Iterable<string | ReasonDiff>): boolean {
  for (const item of diffs) {
    const field = typeof item === "string" ? item : item.field;
    if (DATE_FIELDS.has(field) || BOARD_FIELDS.has(field) || HANGAR_FIELDS.has(field)) return true;
    if (field === "status") {
      const to = typeof item === "string" ? "" : String(item.to ?? "");
      const from = typeof item === "string" ? "" : String(item.from ?? "");
      if (to === CANCELLED_EVENT_STATUS && from !== CANCELLED_EVENT_STATUS) return true;
    }
    if (field === "placements" && typeof item !== "string" && placementChangeNeedsReason(item.from, item.to)) return true;
  }
  return false;
}

/** Перенос на диаграмме: даты, ангар или снятие другого события с ангара. */
export function moveNeedsChangeReason(input: {
  fromStart?: unknown;
  fromEnd?: unknown;
  toStart?: unknown;
  toEnd?: unknown;
  fromHangarId?: unknown;
  toHangarId?: unknown;
  displace?: boolean;
}): boolean {
  if (input.displace) return true;
  if (hangarToken(input.fromHangarId) !== hangarToken(input.toHangarId)) return true;
  if (clockMinute(input.fromStart) !== clockMinute(input.toStart)) return true;
  if (clockMinute(input.fromEnd) !== clockMinute(input.toEnd)) return true;
  return false;
}

export const CHANGE_REASON_REQUIRED_MESSAGE = "Выберите причину изменения";

export function changeReasonRequest(ids: string[], comment: string): { changeReasonIds?: string[]; changeReason?: string } {
  const changeReasonIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const changeReason = comment.trim();
  return {
    ...(changeReasonIds.length ? { changeReasonIds } : {}),
    ...(changeReason ? { changeReason } : {})
  };
}

/** Кнопка подтверждения недоступна, пока обязательный выбор из непустого справочника не сделан. */
export function changeReasonBlocksSave(input: {
  optional: boolean;
  loading: boolean;
  activeCount: number;
  selectedCount: number;
}): boolean {
  if (input.optional) return false;
  if (input.loading) return true;
  if (input.activeCount === 0) return false;
  return input.selectedCount === 0;
}

export function isChangeReasonError(message: string): boolean {
  return message.includes(CHANGE_REASON_REQUIRED_MESSAGE) || message.includes("Укажите причину изменения");
}
