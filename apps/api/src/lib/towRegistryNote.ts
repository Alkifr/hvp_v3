/**
 * Те же правила, что в реестре на экране: пустое примечание заполняется само,
 * позиция события важнее старого комментария буксировки.
 */

const APRON = new Set(["мс", "mc"]);

export type RegistryNoteInput = {
  id: string;
  notes: string;
  hangarNumber: string;
  fromStand: string;
  toStand: string;
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

export function registryAutoNote(row: RegistryNoteInput): string {
  if (hasAssignedTow(row) && isHangarMove(row)) return "Требуется буксировочная бригада";
  const number = hangarDigits(row.hangarNumber);
  const stand = (row.parkedStand ?? "").trim();
  const standingInHangar = Boolean(number) && Boolean(stand) && !isApron(stand);
  if (!hasAssignedTow(row) && standingInHangar) return `ВС в Ангаре №${number} на ${stand}`;
  if (!hasAssignedTow(row) && isStorage(row) && !standingInHangar) return "ВС на МС";
  return "";
}

export function registryNoteText(row: RegistryNoteInput): string {
  const stored = row.notes.trim();
  return stored || registryAutoNote(row);
}

export function registryPositionText(eventPosition: string | undefined, towPosition: string | undefined): string {
  const eventText = (eventPosition ?? "").trim();
  if (eventText) return eventText;
  return (towPosition ?? "").trim();
}
