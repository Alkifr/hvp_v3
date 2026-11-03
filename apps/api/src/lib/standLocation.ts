export type StandLocationInput = {
  hangarId?: string | null;
  layoutId?: string | null;
  standId?: string | null;
};

export type StandLocation = {
  hangarId: string | null;
  layoutId: string | null;
  standId: string | null;
  /** Слот места занят только когда выбраны и схема, и место. */
  occupiesStand: boolean;
};

/**
 * Ангар без схемы и места остаётся «Ангар / без места» и слот не занимает.
 * Схема без места сохраняется как намерение и чужую схему не блокирует.
 * Место занимает слот только вместе со схемой. Без ангара схема и место сбрасываются.
 */
export function resolveStandLocation(input: StandLocationInput): StandLocation {
  const hangarId = input.hangarId || null;
  if (!hangarId) {
    return { hangarId: null, layoutId: null, standId: null, occupiesStand: false };
  }
  const layoutId = input.layoutId || null;
  const standId = input.standId || null;
  if (!layoutId || !standId) {
    return { hangarId, layoutId, standId: null, occupiesStand: false };
  }
  return { hangarId, layoutId, standId, occupiesStand: true };
}
