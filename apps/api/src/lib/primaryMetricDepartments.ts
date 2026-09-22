/** Подразделения первичной таблицы / EventReportMetric. */
export const PRIMARY_METRIC_DEPARTMENTS = ["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP"] as const;

export type PrimaryMetricDepartmentCode = (typeof PRIMARY_METRIC_DEPARTMENTS)[number];

export const PRIMARY_METRIC_DEPARTMENT_LABEL: Record<PrimaryMetricDepartmentCode, string> = {
  ME: "ME",
  AV: "AV",
  INT: "INT",
  NDT: "NDT",
  SHOP: "SHOP",
  CAB_REP: "CabRep"
};

/** Skill.code → PrimaryMetricDepartment (включая legacy MECH/AVIO). */
const SKILL_CODE_TO_DEPARTMENT: Record<string, PrimaryMetricDepartmentCode> = {
  ME: "ME",
  AV: "AV",
  INT: "INT",
  NDT: "NDT",
  SHOP: "SHOP",
  CAB_REP: "CAB_REP",
  CABREP: "CAB_REP",
  // legacy
  MECH: "ME",
  AVIO: "AV"
};

export const LABOR_METRIC_BLOCKS = [
  { block: "LABOR_BUDGET" as const, label: "Бюджет" },
  { block: "WP_PLAN_MPS" as const, label: "MPS" },
  { block: "WP_ACTUAL" as const, label: "Факт" }
];

export type LaborMetricBlockCode = (typeof LABOR_METRIC_BLOCKS)[number]["block"];

/** Серии карточки события: routine + ADD/NRC. */
export const LABOR_CARD_SERIES = [
  {
    key: "budget" as const,
    label: "Бюджет",
    hoursBlock: "LABOR_BUDGET" as const,
    addBlock: "ADD_BUDGET" as const,
    nrcBlock: "NRC_BUDGET" as const,
    tat: "budget" as const
  },
  {
    key: "mps" as const,
    label: "MPS",
    hoursBlock: "WP_PLAN_MPS" as const,
    addBlock: "ADD_PLAN" as const,
    nrcBlock: "NRC_PLAN" as const,
    tat: "mps" as const
  },
  {
    key: "actual" as const,
    label: "Факт",
    hoursBlock: "WP_ACTUAL" as const,
    addBlock: "ADD_ACTUAL" as const,
    nrcBlock: "NRC_ACTUAL" as const,
    tat: "actual" as const
  }
];

export const LABOR_EDITABLE_BLOCKS = [
  "LABOR_BUDGET",
  "ADD_BUDGET",
  "NRC_BUDGET",
  "WP_PLAN_MPS",
  "WP_ACTUAL",
  "ADD_PLAN",
  "NRC_PLAN",
  "ADD_ACTUAL",
  "NRC_ACTUAL"
] as const;

export type LaborEditableBlockCode = (typeof LABOR_EDITABLE_BLOCKS)[number];

/** Excel-колонки живых ч/ч: бюджет / MPS / факт + ADD/NRC плана и факта. */
export const LIVE_LABOR_EXCEL_COLUMNS = [
  "AX",
  "AY",
  "AZ",
  "BA",
  "BB",
  "BC",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BK",
  "CJ",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CS",
  "CT",
  "CU",
  "CV",
  "CW",
  "DV",
  "DW",
  "DX",
  "DY",
  "DZ",
  "EA",
  "ED",
  "EE",
  "EF",
  "EG",
  "EH",
  "EI",
  "FP",
  "FQ",
  "FR",
  "FS",
  "FT",
  "FU"
] as const;

const LIVE_LABOR_EXCEL_SET = new Set<string>(LIVE_LABOR_EXCEL_COLUMNS);

export function isLiveLaborExcelColumn(excelColumn: string | null | undefined): boolean {
  if (!excelColumn) return false;
  return LIVE_LABOR_EXCEL_SET.has(excelColumn.toUpperCase());
}

/** Префиксы колонок импорта событий → блоки EventReportMetric. */
export const LABOR_IMPORT_BLOCK_PREFIXES = [
  { prefix: "laborBudget", block: "LABOR_BUDGET" as const, title: "Трудоемкость (Бюджет)" },
  { prefix: "laborAddBudget", block: "ADD_BUDGET" as const, title: "Трудоемкость на ADD (Бюджет)" },
  { prefix: "laborNrcBudget", block: "NRC_BUDGET" as const, title: "Трудоемкость на NRC (Бюджет)" },
  { prefix: "laborMps", block: "WP_PLAN_MPS" as const, title: "Плановая трудоемкость WP согласно MPS" },
  { prefix: "laborActual", block: "WP_ACTUAL" as const, title: "Фактическая трудоемкость WP (завершенное)" },
  { prefix: "laborAddPlan", block: "ADD_PLAN" as const, title: "Трудоемкость на ADD (План)" },
  { prefix: "laborNrcPlan", block: "NRC_PLAN" as const, title: "Трудоемкость на NRC (План)" },
  { prefix: "laborAddActual", block: "ADD_ACTUAL" as const, title: "Фактические данные ADD (Факт)" },
  { prefix: "laborNrcActual", block: "NRC_ACTUAL" as const, title: "Фактические данные NRC (Факт)" }
] as const;

/** Суффиксы колонок импорта (CabRep в шаблоне; CAB_REP — алиас). */
export const LABOR_IMPORT_DEPARTMENT_SUFFIXES = [
  { suffix: "ME", department: "ME" as const, aliases: [] as const },
  { suffix: "AV", department: "AV" as const, aliases: [] as const },
  { suffix: "INT", department: "INT" as const, aliases: [] as const },
  { suffix: "NDT", department: "NDT" as const, aliases: [] as const },
  { suffix: "SHOP", department: "SHOP" as const, aliases: [] as const },
  { suffix: "CabRep", department: "CAB_REP" as const, aliases: ["CAB_REP"] as const }
] as const;

export type LaborImportColumn = {
  field: string;
  block: LaborEditableBlockCode;
  department: PrimaryMetricDepartmentCode;
  title: string;
};

/** Канонические колонки импорта трудоёмкости (9 блоков × 6 квалификаций). */
export function laborImportColumns(): LaborImportColumn[] {
  return LABOR_IMPORT_BLOCK_PREFIXES.flatMap((block) =>
    LABOR_IMPORT_DEPARTMENT_SUFFIXES.map((dep) => ({
      field: `${block.prefix}_${dep.suffix}`,
      block: block.block,
      department: dep.department,
      title: `${block.title} / ${PRIMARY_METRIC_DEPARTMENT_LABEL[dep.department]}`
    }))
  );
}

/**
 * Имена колонок из выгрузок, которые отличаются от канона шаблона.
 * laborBudget_Add_ME = laborAddBudget_ME, laborMPS_Add_ME = laborAddPlan_ME и т.д.
 */
const LABOR_IMPORT_PREFIX_ALIASES: Record<string, readonly string[]> = {
  laborAddBudget: ["laborBudget_Add"],
  laborNrcBudget: ["laborBudget_Nrc"],
  laborAddPlan: ["laborMPS_Add", "laborMps_Add"],
  laborNrcPlan: ["laborMPS_Nrc", "laborMps_Nrc"],
  laborAddActual: ["laborActual_Add"],
  laborNrcActual: ["laborActual_Nrc"]
};

/** Все допустимые имена колонок импорта (канон + алиасы CabRep и ADD/NRC). */
export function laborImportFieldAliases(): Array<LaborImportColumn & { canonicalField: string }> {
  const out: Array<LaborImportColumn & { canonicalField: string }> = [];
  for (const block of LABOR_IMPORT_BLOCK_PREFIXES) {
    for (const dep of LABOR_IMPORT_DEPARTMENT_SUFFIXES) {
      const canonicalField = `${block.prefix}_${dep.suffix}`;
      const base = {
        block: block.block,
        department: dep.department,
        title: `${block.title} / ${PRIMARY_METRIC_DEPARTMENT_LABEL[dep.department]}`,
        canonicalField
      };
      const prefixes = [block.prefix, ...(LABOR_IMPORT_PREFIX_ALIASES[block.prefix] ?? [])];
      const suffixes = [dep.suffix, ...dep.aliases];
      for (const prefix of prefixes) {
        for (const suffix of suffixes) {
          out.push({ ...base, field: `${prefix}_${suffix}` });
        }
      }
    }
  }
  return out;
}

export function skillCodeToDepartment(code: string | null | undefined): PrimaryMetricDepartmentCode | null {
  if (!code) return null;
  return SKILL_CODE_TO_DEPARTMENT[code.trim().toUpperCase()] ?? null;
}

export function isPrimaryMetricDepartment(value: string): value is PrimaryMetricDepartmentCode {
  return (PRIMARY_METRIC_DEPARTMENTS as readonly string[]).includes(value);
}

export function departmentToSkillCode(department: PrimaryMetricDepartmentCode): string {
  return department;
}

/** Парсинг опционального ч/ч из ячейки импорта. */
export function parseOptionalLaborHours(value: unknown, label: string): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Некорректная трудоёмкость ${label}: ${String(value)}`);
    return value;
  }
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Некорректная трудоёмкость ${label}: ${String(value)}`);
  return parsed;
}

/** Собрать заполненные метрики трудоёмкости из строки импорта. */
export function collectLaborMetricsFromImportRow(
  row: Record<string, unknown>
): Array<{ block: LaborEditableBlockCode; department: PrimaryMetricDepartmentCode; manHours: number }> {
  const byKey = new Map<string, { block: LaborEditableBlockCode; department: PrimaryMetricDepartmentCode; manHours: number }>();
  const rowByLower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) rowByLower.set(key.toLowerCase(), value);
  for (const col of laborImportFieldAliases()) {
    const raw =
      col.field in row
        ? row[col.field]
        : col.canonicalField in row
          ? row[col.canonicalField]
          : rowByLower.get(col.field.toLowerCase());
    if (raw === undefined) continue;
    const manHours = parseOptionalLaborHours(raw, col.field);
    if (manHours == null) continue;
    byKey.set(`${col.block}:${col.department}`, { block: col.block, department: col.department, manHours });
  }
  return Array.from(byKey.values());
}
