/** Поля события, для которых причина изменения не обязательна. */
const FIELDS_WITHOUT_CHANGE_REASON = new Set(["notes", "comment"]);

/** Причина нужна, если среди изменений есть что-то кроме примечания и комментария. */
export function patchNeedsChangeReason(changedKeys: Iterable<string>): boolean {
  for (const key of changedKeys) {
    if (!FIELDS_WITHOUT_CHANGE_REASON.has(key)) return true;
  }
  return false;
}
