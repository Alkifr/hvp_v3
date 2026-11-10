import { UserMsg } from "./userErrors.js";

/** Причина изменения события. Правило совпадает с apps/web/src/lib/eventChangeReason.ts. */

export const CANCELLED_EVENT_STATUS = "CANCELLED";

const DATE_FIELDS = [
  "startAt",
  "endAt",
  "budgetStartAt",
  "budgetEndAt",
  "actualStartAt",
  "actualEndAt",
  "deadlineAt"
] as const;

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

/** Минута на часах. Секунды не считаются изменением даты. */
export function clockMinute(value: unknown): number | null {
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

/** Смена дат или ангара внутри этапов. Место, схема и источник этапа причину не требуют. */
export function placementChangeNeedsReason(from: unknown, to: unknown): boolean {
  return placementReasonKey(from) !== placementReasonKey(to);
}

function provided(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && (record as Record<string, unknown>)[key] !== undefined;
}

/**
 * Причина нужна, если в запросе меняются даты, борт, DeadLine, ангар
 * или событие переводится в «Отменено».
 * Статус кроме отмены, место, схема, цех и прочие технические поля — без причины.
 * Автозаполнение факта при завершении сюда не входит: смотрим запрошенные значения, не итог сверки статуса.
 */
export function requestedEventChangeNeedsReason(input: {
  before: object;
  after: object;
}): boolean {
  const before = input.before as Record<string, unknown>;
  const after = input.after as Record<string, unknown>;
  if (provided(after, "status") && after.status === CANCELLED_EVENT_STATUS && before.status !== CANCELLED_EVENT_STATUS) {
    return true;
  }
  if (provided(after, "aircraftId") && (after.aircraftId ?? null) !== (before.aircraftId ?? null)) return true;
  if (
    provided(after, "virtualAircraft") &&
    JSON.stringify(after.virtualAircraft ?? null) !== JSON.stringify(before.virtualAircraft ?? null)
  ) {
    return true;
  }
  for (const key of DATE_FIELDS) {
    if (!provided(after, key)) continue;
    if (clockMinute(before[key]) !== clockMinute(after[key])) return true;
  }
  if (provided(after, "hangarId") && hangarToken(after.hangarId) !== hangarToken(before.hangarId)) return true;
  if (provided(after, "placements") && placementChangeNeedsReason(before.placements, after.placements)) return true;
  return false;
}

/** Перенос: причина при сдвиге дат, смене ангара или снятии другого события с ангара. */
export function scheduleMoveNeedsReason(input: {
  fromStart?: unknown;
  fromEnd?: unknown;
  toStart?: unknown;
  toEnd?: unknown;
  fromHangarId?: unknown;
  toHangarId?: unknown;
  clearsHangar?: boolean;
}): boolean {
  if (input.clearsHangar) return true;
  if (hangarToken(input.fromHangarId) !== hangarToken(input.toHangarId)) return true;
  if (clockMinute(input.fromStart) !== clockMinute(input.toStart)) return true;
  if (clockMinute(input.fromEnd) !== clockMinute(input.toEnd)) return true;
  return false;
}

export type ChangeReasonRow = {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export type ResolvedChangeReason = {
  reason: string | null;
  changeReasonIds: string[];
  changeReasonNames: string[];
  changeReasonComment: string | null;
};

function httpError(message: string, statusCode: number): Error {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function composeChangeReason(names: string[], comment: string | null): string | null {
  if (names.length && comment) return `${names.join(", ")}. ${comment}`;
  return names.join(", ") || comment || null;
}

/** Выбор из справочника обязателен. Текст комментария можно не заполнять. Пустой справочник сохранение не блокирует. */
export function resolveChangeReasonSelection(
  rows: ChangeReasonRow[],
  input: { required: boolean; ids?: string[] | null; comment?: string | null }
): ResolvedChangeReason {
  const comment = String(input.comment ?? "").trim() || null;
  const requested = [...new Set((input.ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
  const active = rows.filter((row) => row.isActive);
  if (requested.length === 0) {
    if (input.required && active.length > 0) throw httpError(UserMsg.CHANGE_REASON_REQUIRED, 400);
    return { reason: comment, changeReasonIds: [], changeReasonNames: [], changeReasonComment: comment };
  }
  const byId = new Map(active.map((row) => [row.id, row]));
  const picked = requested.map((id) => byId.get(id));
  if (picked.some((row) => !row)) throw httpError("Выберите причину из справочника", 400);
  const selected = picked.filter((row): row is ChangeReasonRow => Boolean(row));
  selected.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
  const names = selected.map((row) => row.name);
  return {
    reason: composeChangeReason(names, comment),
    changeReasonIds: selected.map((row) => row.id),
    changeReasonNames: names,
    changeReasonComment: comment
  };
}

export async function resolveStoredChangeReason(
  findRows: () => Promise<ChangeReasonRow[]>,
  input: { required: boolean; ids?: string[] | null; comment?: string | null }
): Promise<ResolvedChangeReason> {
  const ids = input.ids ?? [];
  if (!input.required && ids.length === 0) {
    const comment = String(input.comment ?? "").trim() || null;
    return { reason: comment, changeReasonIds: [], changeReasonNames: [], changeReasonComment: comment };
  }
  return resolveChangeReasonSelection(await findRows(), input);
}

export function changeReasonAuditFields(stored: ResolvedChangeReason) {
  return {
    reason: stored.reason,
    changeReasonIds: stored.changeReasonIds,
    changeReasonNames: stored.changeReasonNames,
    changeReasonComment: stored.changeReasonComment
  };
}
