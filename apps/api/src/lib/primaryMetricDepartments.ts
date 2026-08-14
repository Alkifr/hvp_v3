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
  {
    block: "LABOR_BUDGET" as const,
    label: "Трудоемкость (Бюджет)",
    hint: "ч/ч по квалификациям; TAT бюджета в отчёте — колонка W (V−U+1)"
  },
  {
    block: "WP_PLAN_MPS" as const,
    label: "Плановая трудоемкость WP согласно MPS",
    hint: "Выработка в сутки (План) в отчёте = TOTAL / TAT плана (AB)"
  },
  {
    block: "WP_ACTUAL" as const,
    label: "Фактическая трудоемкость WP (завершенное)",
    hint: "Выработка в сутки (Факт) в отчёте = TOTAL / TAT факта (AO)"
  }
];

export type LaborMetricBlockCode = (typeof LABOR_METRIC_BLOCKS)[number]["block"];

/** Excel-колонки живых ч/ч (3 блока × 6 квалификаций). Совпадает с rowMapper METRIC_COLUMNS. */
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
  { prefix: "laborMps", block: "WP_PLAN_MPS" as const, title: "Плановая трудоемкость WP согласно MPS" },
  { prefix: "laborActual", block: "WP_ACTUAL" as const, title: "Фактическая трудоемкость WP (завершенное)" }
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
  block: LaborMetricBlockCode;
  department: PrimaryMetricDepartmentCode;
  title: string;
};

/** Канонические колонки импорта трудоёмкости (18 шт.). */
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

/** Все допустимые имена колонок импорта (канон + алиасы CAB_REP). */
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
      out.push({ ...base, field: canonicalField });
      for (const alias of dep.aliases) {
        out.push({ ...base, field: `${block.prefix}_${alias}` });
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
): Array<{ block: LaborMetricBlockCode; department: PrimaryMetricDepartmentCode; manHours: number }> {
  const byKey = new Map<string, { block: LaborMetricBlockCode; department: PrimaryMetricDepartmentCode; manHours: number }>();
  for (const col of laborImportFieldAliases()) {
    if (!(col.field in row) && !(col.canonicalField in row)) continue;
    const raw = row[col.field] ?? row[col.canonicalField];
    const manHours = parseOptionalLaborHours(raw, col.field);
    if (manHours == null) continue;
    byKey.set(`${col.block}:${col.department}`, { block: col.block, department: col.department, manHours });
  }
  return Array.from(byKey.values());
}
