export type AircraftWorkshopSourceRow = {
  type: string;
  tail: string;
  workshop: string;
  operator: string;
  check: "A" | "C";
  hangar: string;
};

export type AircraftWorkshopDraft = {
  tail: string;
  type: string;
  operator: string;
  check: "A" | "C";
  workshopCode: string;
  hangarCodes: string[];
  choice: "FIXED" | "PRIMARY" | "ALTERNATE";
  dependsOnCustomerPlan: boolean;
  note: string | null;
};

const AFL_320_NOTE =
  "Большинство C-check AFL 320 CEO/NEO планируется на ЦПТО3, ангар 1. ЦПТО5 и ангар 5 — если план заказчика переносит борт, по той же логике, что C-check 737.";

export function hangarCodesFromCell(value: string): string[] {
  return String(value ?? "")
    .split(/[,;/]/)
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));
}

export function expandWorkshopAssignment(row: AircraftWorkshopSourceRow): AircraftWorkshopDraft[] {
  const tail = String(row.tail ?? "").trim();
  const workshop = String(row.workshop ?? "").trim();
  const parts = workshop.split("/").map((part) => part.trim()).filter(Boolean);
  const base = {
    tail,
    type: row.type,
    operator: row.operator,
    check: row.check
  };
  if (parts.length > 1) {
    const primary = parts.find((part) => part.includes("3")) ?? parts[0]!;
    const alternate = parts.find((part) => part.includes("5")) ?? parts[1]!;
    return [
      {
        ...base,
        workshopCode: primary,
        hangarCodes: ["1"],
        choice: "PRIMARY",
        dependsOnCustomerPlan: false,
        note: AFL_320_NOTE
      },
      {
        ...base,
        workshopCode: alternate,
        hangarCodes: ["5"],
        choice: "ALTERNATE",
        dependsOnCustomerPlan: true,
        note: AFL_320_NOTE
      }
    ];
  }
  const is737CustomerPlan = row.check === "C" && /737/.test(row.type) && workshop.includes("ЦПТО5");
  return [
    {
      ...base,
      workshopCode: workshop,
      hangarCodes: hangarCodesFromCell(row.hangar),
      choice: "FIXED",
      dependsOnCustomerPlan: is737CustomerPlan,
      note: is737CustomerPlan ? "Назначение ЦПТО5 на C-check 737 зависит от плана заказчика. Ангар 5." : null
    }
  ];
}

export function tailDigits(value: string) {
  return value.replace(/\D/g, "");
}
