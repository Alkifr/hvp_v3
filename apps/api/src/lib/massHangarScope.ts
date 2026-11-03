export const MASS_OUTSIDE_PREFERRED_HANGAR_WARNING =
  "В выбранных ангарах нет свободного места, использован другой активный ангар";

export type MassHangarSearchMode = "all" | "only" | "prefer";

export type MassHangarSearch = {
  mode: MassHangarSearchMode;
  orderedIds: string[];
  preferredIds: string[];
};

/**
 * Пустой список — все активные ангары.
 * strictHangars не передан или true — только выбранные активные ангары.
 * strictHangars false — выбранные ангары предпочтительны, остальные активные остаются запасными.
 * Если выбраны только неактивные или неизвестные ангары и ограничение жёсткое, кандидатов нет.
 */
export function resolveMassHangarSearch(params: {
  strictHangars?: boolean;
  selectedIds: readonly string[];
  activeHangars: readonly { id: string; name: string }[];
}): MassHangarSearch {
  const activeById = new Map<string, { id: string; name: string }>();
  for (const hangar of params.activeHangars) {
    if (!activeById.has(hangar.id)) activeById.set(hangar.id, hangar);
  }

  const seen = new Set<string>();
  const selectedActive: string[] = [];
  let requested = 0;
  for (const id of params.selectedIds) {
    requested += 1;
    if (seen.has(id)) continue;
    seen.add(id);
    if (activeById.has(id)) selectedActive.push(id);
  }

  const byName = (a: { id: string; name: string }, b: { id: string; name: string }) =>
    a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id);
  const rest = [...activeById.values()]
    .filter((hangar) => !selectedActive.includes(hangar.id))
    .sort(byName)
    .map((hangar) => hangar.id);
  const hard = params.strictHangars !== false;

  if (selectedActive.length === 0) {
    if (requested > 0 && hard) return { mode: "only", orderedIds: [], preferredIds: [] };
    const orderedIds = [...activeById.values()].sort(byName).map((hangar) => hangar.id);
    return { mode: "all", orderedIds, preferredIds: [] };
  }
  if (hard) return { mode: "only", orderedIds: selectedActive, preferredIds: selectedActive };
  return { mode: "prefer", orderedIds: [...selectedActive, ...rest], preferredIds: selectedActive };
}

export function pickScopedPlacement<T extends { hangarId: string; priorityScore?: number }>(
  entries: readonly T[],
  slotFor: (entry: T) => number | null,
  options?: { preferredHangarIds?: ReadonlySet<string>; strict?: boolean }
): { entry: T; slot: number } | null {
  const pickAmong = (pool: readonly T[]) => {
    let best: { entry: T; slot: number; score: number } | null = null;
    for (const entry of pool) {
      const slot = slotFor(entry);
      if (slot == null) continue;
      const score = entry.priorityScore ?? 0;
      if (!best || score > best.score || (score === best.score && slot < best.slot)) {
        best = { entry, slot, score };
      }
    }
    return best ? { entry: best.entry, slot: best.slot } : null;
  };

  const preferred = options?.preferredHangarIds;
  if (options?.strict) {
    const allowed = preferred ?? new Set<string>();
    return pickAmong(entries.filter((entry) => allowed.has(entry.hangarId)));
  }
  if (preferred && preferred.size > 0) {
    const picked = pickAmong(entries.filter((entry) => preferred.has(entry.hangarId)));
    if (picked) return picked;
  }
  return pickAmong(entries);
}
