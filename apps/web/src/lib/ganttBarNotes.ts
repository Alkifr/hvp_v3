const HIDDEN_NOTE_STATUSES = new Set(["DONE", "CANCELLED"]);

/** Текст примечания под баром: скрыт для завершённых и отменённых событий. */
export function ganttBarNotesText(ev: { notes?: string | null; status?: string | null }): string {
  if (HIDDEN_NOTE_STATUSES.has(String(ev.status ?? ""))) return "";
  return ev.notes?.trim() ?? "";
}

export function rowHasGanttBarNotes(events: Array<{ ev: { notes?: string | null; status?: string | null } }>): boolean {
  return events.some((item) => Boolean(ganttBarNotesText(item.ev)));
}
