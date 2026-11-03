import dayjs from "dayjs";

export const DEADLINE_SLOT_HINT = "Дата выхода со слота позже DeadLine.";

/** Оперативное окончание слота позже DeadLine. Пустые значения не считаются превышением. */
export function slotExitAfterDeadline(endAtLocal: string, deadlineLocal: string): boolean {
  if (!endAtLocal || !deadlineLocal) return false;
  const end = dayjs(endAtLocal);
  const deadline = dayjs(deadlineLocal);
  if (!end.isValid() || !deadline.isValid()) return false;
  return end.isAfter(deadline);
}
