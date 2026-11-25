/**
 * Автотекст «Примечания» реестра буксировок.
 * Своя запись важнее автотекста: пустая строка означает «показать правило».
 */

const APRON = new Set(["мс", "mc"]);

export type RegistryNoteInput = {
  id: string;
  notes: string;
  hangarNumber: string;
  fromStand: string;
  toStand: string;
  /** IN | OUT | TRANSFER | UNKNOWN, если сервер его прислал. */
  direction?: string;
  directionLabel?: string;
  eventType?: string;
  eventTitle?: string;
  parkedStand?: string;
  plannedStartAt?: string | null;
};

function norm(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/ё/g, "е");
}

function isApron(stand: string | undefined): boolean {
  return APRON.has(norm(stand));
}

function hangarDigits(label: string): string {
  return label.match(/(\d+)/)?.[1] ?? "";
}

function hasAssignedTow(row: RegistryNoteInput): boolean {
  return Boolean(row.plannedStartAt) && !row.id.startsWith("plan:");
}

/** Закатка или выкатка: в ангар с МС либо из ангара на МС. */
function isHangarMove(row: RegistryNoteInput): boolean {
  const direction = norm(row.direction);
  if (direction === "in" || direction === "out") return true;
  const label = norm(row.directionLabel);
  if (label === "закатка" || label === "выкатка") return true;
  const from = row.fromStand.trim();
  const to = row.toStand.trim();
  if (isApron(from) && to && !isApron(to)) return true;
  if (isApron(to) && from && !isApron(from)) return true;
  return false;
}

function isStorage(row: RegistryNoteInput): boolean {
  const hay = norm(`${row.eventType ?? ""} ${row.eventTitle ?? ""}`);
  return hay.includes("хранен");
}

/** Текст правила. Пустая строка — правило не сработало, остаётся ручной ввод. */
export function registryAutoNote(row: RegistryNoteInput): string {
  if (hasAssignedTow(row) && isHangarMove(row)) return "Требуется буксировочная бригада";
  const number = hangarDigits(row.hangarNumber);
  const stand = (row.parkedStand ?? "").trim();
  const standingInHangar = Boolean(number) && Boolean(stand) && !isApron(stand);
  if (!hasAssignedTow(row) && standingInHangar) return `ВС в Ангаре №${number} на ${stand}`;
  if (!hasAssignedTow(row) && isStorage(row) && !standingInHangar) return "ВС на МС";
  return "";
}

/** То, что видит пользователь: своя запись, иначе автотекст. */
export function registryNoteText(row: RegistryNoteInput): string {
  const stored = row.notes.trim();
  return stored || registryAutoNote(row);
}

/**
 * «Позиция» реестра. Текст события важнее старого комментария конкретной буксировки:
 * пустое поле события оставляет прежнюю запись видимой, пока её не сохранят на событие.
 */
export function registryPositionText(eventPosition: string | undefined, towPosition: string | undefined): string {
  const eventText = (eventPosition ?? "").trim();
  if (eventText) return eventText;
  return (towPosition ?? "").trim();
}
