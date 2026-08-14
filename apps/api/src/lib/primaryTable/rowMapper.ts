import { applyPrimaryTableFormulas } from "./formulaEngine.js";
import { eventStatusLabel } from "../eventStatusCatalog.js";

const DEPARTMENTS = ["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP"] as const;

const METRIC_COLUMNS: Record<string, { columns: string[]; value: "manHours" | "costAmount" }> = {
  WP_PLAN_MPS: { columns: ["AX", "AY", "AZ", "BA", "BB", "BC"], value: "manHours" },
  WP_ACTUAL: { columns: ["BF", "BG", "BH", "BI", "BJ", "BK"], value: "manHours" },
  FIXED_COST_PLAN: { columns: ["BO", "BP", "BQ", "BR", "BS", "BT"], value: "costAmount" },
  TM_PLAN: { columns: ["BV", "BW", "BX", "BY", "BZ", "CA"], value: "costAmount" },
  ACCESS_LABOR_PLAN: { columns: ["CC", "CD", "CE", "CF", "CG", "CH"], value: "manHours" },
  NRC_PLAN: { columns: ["CJ", "CK", "CL", "CM", "CN", "CO"], value: "manHours" },
  ADD_PLAN: { columns: ["CR", "CS", "CT", "CU", "CV", "CW"], value: "manHours" },
  FIXED_COST_ACTUAL: { columns: ["DH", "DI", "DJ", "DK", "DL", "DM"], value: "costAmount" },
  TM_ACTUAL: { columns: ["DO", "DP", "DQ", "DR", "DS", "DT"], value: "costAmount" },
  NRC_ACTUAL: { columns: ["DV", "DW", "DX", "DY", "DZ", "EA"], value: "manHours" },
  ADD_ACTUAL: { columns: ["ED", "EE", "EF", "EG", "EH", "EI"], value: "manHours" },
  LABOR_BUDGET: { columns: ["FP", "FQ", "FR", "FS", "FT", "FU"], value: "manHours" }
};

const SCALAR_COLUMNS: Record<string, string> = {
  pct_nrc_plan: "CQ",
  mhrs_add_plan: "CY"
};

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return value;
  return null;
}

function decimal(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reason(event: any, kind: string): string | null {
  return event.slotDeviations?.find((item: any) => item.kind === kind)?.reason ?? event.notes ?? null;
}

function bodyTypeLabel(code: string | null | undefined): string | null {
  if (code === "NARROW_BODY") return "Узкий";
  if (code === "WIDE_BODY") return "Широкий";
  return null;
}

function eventBodyTypeLabel(
  event: any,
  bodyTypeByAircraftTypeId?: Map<string, string | null>
): string | null {
  const fromAircraft = bodyTypeLabel(event.aircraft?.type?.bodyType);
  if (fromAircraft) return fromAircraft;
  const virtualTypeId = event.virtualAircraft?.aircraftTypeId;
  if (!virtualTypeId || !bodyTypeByAircraftTypeId) return null;
  return bodyTypeLabel(bodyTypeByAircraftTypeId.get(virtualTypeId));
}

function eventStatusName(code: string | null | undefined, names?: Map<string, string>): string | null {
  if (!code) return null;
  const named = names?.get(code)?.trim();
  if (named) return named;
  const fallback = eventStatusLabel(code);
  return fallback === "—" ? null : fallback;
}

export function toPrimaryTableRow(
  event: any,
  statusNames?: Map<string, string>,
  bodyTypeByAircraftTypeId?: Map<string, string | null>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const put = (column: string, value: unknown) => {
    row[`primary.${column.toLowerCase()}`] = value ?? null;
  };

  const extension = event.primaryExtension;
  const aircraft = event.aircraft;
  const placement = event.placements?.[0];
  const reservation = placement?.reservation ?? event.reservations?.[0];
  const hangar = placement?.hangar ?? event.hangar;
  const stand = placement?.stand ?? reservation?.stand;
  const customerSlot = event.customerSlot;
  const rolling = event.ptoRollingEntries?.[0];

  put("A", eventBodyTypeLabel(event, bodyTypeByAircraftTypeId));
  put("E", aircraft?.operator?.name);
  put("F", extension?.externalExecution ?? (hangar?.isPhysical === false ? true : null));
  put("G", aircraft?.tailNumber ?? event.virtualAircraft?.label);
  put("H", aircraft?.type?.name ?? event.virtualAircraft?.aircraftTypeName);
  put("I", iso(aircraft?.manufactureDate));
  put("K", event.title);
  put("L", event.eventType?.name);
  put("M", extension?.normalizedFormDetail);
  put("N", hangar?.station ?? extension?.stationCode);
  put("O", extension?.phaseKind);
  put("P", event.planningKind);
  put("Q", iso(customerSlot?.startAt));
  put("R", iso(customerSlot?.endAt));
  put("S", customerSlot?.dlFlag);
  put("U", iso(event.budgetStartAt));
  put("V", iso(event.budgetEndAt));
  put("X", iso(event.startAt));
  put("Y", iso(event.startAt));
  put("Z", iso(event.endAt));
  put("AA", iso(event.endAt));
  put("AD", extension?.agreementStatus ?? eventStatusName(event.status, statusNames));
  put("AE", event.notes);
  put("AF", hangar?.code ?? hangar?.name);
  put("AG", stand?.code ?? stand?.name);
  put("AH", event.workshop?.name);
  put("AI", eventStatusName(event.status, statusNames));
  put("AJ", extension?.iiCCheckFact);
  put("AK", iso(event.actualStartAt));
  put("AL", iso(event.actualStartAt));
  put("AM", iso(event.actualEndAt));
  put("AN", iso(event.actualEndAt));
  put("AR", reason(event, "DURATION_VS_BUDGET"));
  put("AU", reason(event, "DURATION_VS_PLAN"));
  put("AW", reason(event, "SHIFT_VS_BUDGET"));
  put("FX", extension?.wpNumberFact);

  for (const metric of event.reportMetrics ?? []) {
    const mapping = METRIC_COLUMNS[metric.block];
    const departmentIndex = DEPARTMENTS.indexOf(metric.department);
    const column = mapping?.columns[departmentIndex];
    if (column) put(column, decimal(metric[mapping.value]));
  }
  for (const scalar of event.reportScalars ?? []) {
    const column = SCALAR_COLUMNS[scalar.metricKey];
    if (column) put(column, decimal(scalar.valueNum) ?? scalar.valueText);
  }

  put("FY", rolling?.externalKey);
  put("FZ", rolling?.status);
  put("GA", decimal(rolling?.kippHours));
  put("GB", decimal(rolling?.laborTotal));
  put("GC", decimal(rolling?.amount));
  put("GD", rolling?.category);
  put("GE", rolling?.comments);
  put("GF", event.aCheckAnalysis?.status);
  put("GG", event.aCheckAnalysis?.quantity);
  put("GH", event.aCheckAnalysis?.program);

  row.__eventId = event.id;
  row.__startAt = iso(event.startAt);
  row.__hangarId = hangar?.id ?? event.hangarId ?? null;
  row.__operatorId = aircraft?.operatorId ?? event.virtualAircraft?.operatorId ?? null;
  row.__aircraftId = aircraft?.id ?? null;
  row.__eventTypeId = event.eventTypeId;

  return applyPrimaryTableFormulas(row);
}
