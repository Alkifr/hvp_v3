/** Поля карточки, которые пишутся без отдельного окна «Причина изменения». */
export const EVENT_FIELDS_WITHOUT_CHANGE_REASON = new Set(["notes", "comment"]);

/** Нужна ли причина, если изменились только перечисленные поля. Пустой список — нет. */
export function eventDiffNeedsChangeReason(fields: Iterable<string>): boolean {
  for (const field of fields) {
    if (!EVENT_FIELDS_WITHOUT_CHANGE_REASON.has(field)) return true;
  }
  return false;
}
