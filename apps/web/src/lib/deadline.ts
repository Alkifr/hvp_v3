export const DEADLINE_SLOT_HINT = "Дата начала слота позже DeadLine.";

/** Календарный день начала оперативного слота позже DeadLine. Время не учитывается. */
export function slotStartAfterDeadline(startAtLocal: string, deadlineLocal: string): boolean {
  const startDay = startAtLocal.slice(0, 10);
  const deadlineDay = deadlineLocal.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay) || !/^\d{4}-\d{2}-\d{2}$/.test(deadlineDay)) return false;
  return startDay > deadlineDay;
}
