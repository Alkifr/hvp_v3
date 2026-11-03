/** Порядок полос гантта в режиме «Ангар / место». */
export type HangarStandSort = "stand-layout" | "layout-stand";

export const HANGAR_STAND_SORT_OPTIONS: Array<{ id: HangarStandSort; label: string }> = [
  { id: "stand-layout", label: "Ангар / Место / Вариант расстановки" },
  { id: "layout-stand", label: "Ангар / Вариант расстановки / Место" }
];

export function parseHangarStandSort(raw: unknown): HangarStandSort {
  return raw === "layout-stand" ? "layout-stand" : "stand-layout";
}

/** Имя варианта для сортировки: подпись оси может сжиматься до кода, порядок — нет. */
export function hangarStandLayoutSortKey(name?: string | null, code?: string | null): string {
  const trimmedName = String(name ?? "").trim();
  if (trimmedName) return trimmedName;
  return String(code ?? "").trim();
}

export type HangarStandSortKey = {
  hangarName: string;
  standCode: string;
  layoutName: string;
};

function cmpRu(a: string, b: string): number {
  return a.localeCompare(b, "ru");
}

/** Ангар всегда первый ключ. Дальше — место, затем вариант, либо вариант, затем место. */
export function compareHangarStandRows(a: HangarStandSortKey, b: HangarStandSortKey, mode: HangarStandSort): number {
  const byHangar = cmpRu(a.hangarName, b.hangarName);
  if (byHangar) return byHangar;
  if (mode === "layout-stand") {
    const byLayout = cmpRu(a.layoutName, b.layoutName);
    if (byLayout) return byLayout;
    return cmpRu(a.standCode, b.standCode);
  }
  const byStand = cmpRu(a.standCode, b.standCode);
  if (byStand) return byStand;
  return cmpRu(a.layoutName, b.layoutName);
}
