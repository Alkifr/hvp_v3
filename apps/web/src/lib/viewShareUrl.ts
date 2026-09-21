import { isValidDateInput } from "./dateInput";
import { parseHashPage, writePageHashQuery } from "./eventDeepLink";

const TIME_SCALES = ["hour", "day", "week", "month", "quarter", "year"] as const;
type TimeScale = (typeof TIME_SCALES)[number];

const VIEW_SHARE_KEYS = new Set([
  "from",
  "to",
  "group",
  "view",
  "pf",
  "maj",
  "min",
  "tz",
  "fit",
  "links",
  "ext",
  "notes",
  "hangar",
  "op",
  "type",
  "ac",
  "et",
  "ws",
  "st",
  "pk",
  "lb",
  "mode",
  "at",
  "ly",
  "tab",
  "grain",
  "ca",
  "cb",
  "kind",
  "q",
  "layout"
]);

export type GanttViewShare = {
  rangeFromApplied: string;
  rangeToApplied: string;
  groupMode: "AIRCRAFT" | "HANGAR_STAND";
  panelView: "DIAGRAM" | "TABLE";
  ganttDisplayMode: "CURRENT" | "PLAN_FACT";
  majorScale: TimeScale;
  minorScale: TimeScale;
  timelineTimeMode: "LOCAL" | "UTC";
  selectedHangarIds: string[];
  filterAircraftTypeIds: string[];
  filterOperatorIds: string[];
  filterAircraftIds: string[];
  filterEventTypeIds: string[];
  filterWorkshopIds: string[];
  filterStatusIds: string[];
  filterPlanningKinds: Array<"PLANNED" | "UNPLANNED">;
  filterLineBases: Array<"LINE" | "BASE">;
  fitWidth: boolean;
  showAllPlacementLinks: boolean;
  showExternalMroOnGantt: boolean;
  showGanttNotes: boolean;
};

export type HangarViewShare = {
  fromDate: string;
  toDate: string;
  viewMode: "range" | "moment";
  minuteOffset: number;
  layoutIdByHangarId: Record<string, string>;
  filterHangarIds: string[];
  filterOperatorIds: string[];
  filterAircraftTypeIds: string[];
  filterAircraftIds: string[];
  filterEventTypeIds: string[];
};

export type AnalyticsViewShare = {
  tab: "tat" | "util" | "tows" | "compare" | "monthly" | "builder";
  fromDate: string;
  toDate: string;
  compareA: string;
  compareB: string;
  efficiencyGrain: "day" | "week" | "month" | "period";
  filterHangarIds: string[];
  filterOperatorIds: string[];
  filterAircraftTypeIds: string[];
  filterAircraftIds: string[];
  filterEventTypeIds: string[];
};

export type TowsViewShare = {
  fromDate: string;
  toDate: string;
  filterHangarIds: string[];
  filterOperatorIds: string[];
  filterAircraftTypeIds: string[];
  filterAircraftIds: string[];
};

export function queryHasViewShare(query: URLSearchParams): boolean {
  for (const key of query.keys()) {
    if (VIEW_SHARE_KEYS.has(key)) return true;
  }
  return false;
}

function csv(query: URLSearchParams, key: string): string[] {
  const raw = query.get(key);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function setCsv(query: URLSearchParams, key: string, ids: string[]) {
  if (ids.length) query.set(key, ids.join(","));
}

function setFlag(query: URLSearchParams, key: string, on: boolean) {
  if (on) query.set(key, "1");
}

function readDate(query: URLSearchParams, key: string): string | null {
  const raw = query.get(key)?.trim() ?? "";
  return isValidDateInput(raw) ? raw : null;
}

function putSandbox(query: URLSearchParams, sandboxId: string | null | undefined) {
  query.set("sandbox", sandboxId ?? "");
}

function defaultGanttShare(): GanttViewShare {
  return {
    rangeFromApplied: "",
    rangeToApplied: "",
    groupMode: "AIRCRAFT",
    panelView: "DIAGRAM",
    ganttDisplayMode: "CURRENT",
    majorScale: "week",
    minorScale: "day",
    timelineTimeMode: "LOCAL",
    selectedHangarIds: [],
    filterAircraftTypeIds: [],
    filterOperatorIds: [],
    filterAircraftIds: [],
    filterEventTypeIds: [],
    filterWorkshopIds: [],
    filterStatusIds: [],
    filterPlanningKinds: [],
    filterLineBases: [],
    fitWidth: false,
    showAllPlacementLinks: false,
    showExternalMroOnGantt: true,
    showGanttNotes: false
  };
}

function parseTimeScale(raw: string | null, fallback: TimeScale): TimeScale {
  return raw && (TIME_SCALES as readonly string[]).includes(raw) ? (raw as TimeScale) : fallback;
}

export function parseGanttViewShare(query: URLSearchParams): GanttViewShare | null {
  if (!queryHasViewShare(query)) return null;
  const base = defaultGanttShare();
  const from = readDate(query, "from");
  const to = readDate(query, "to");
  const pk = csv(query, "pk").filter((x): x is "PLANNED" | "UNPLANNED" => x === "PLANNED" || x === "UNPLANNED");
  const lb = csv(query, "lb").filter((x): x is "LINE" | "BASE" => x === "LINE" || x === "BASE");
  return {
    ...base,
    rangeFromApplied: from ?? "",
    rangeToApplied: to ?? "",
    groupMode: query.get("group") === "h" ? "HANGAR_STAND" : "AIRCRAFT",
    panelView: query.get("view") === "t" ? "TABLE" : "DIAGRAM",
    ganttDisplayMode: query.get("pf") === "1" ? "PLAN_FACT" : "CURRENT",
    majorScale: parseTimeScale(query.get("maj"), "week"),
    minorScale: parseTimeScale(query.get("min"), "day"),
    timelineTimeMode: query.get("tz") === "utc" ? "UTC" : "LOCAL",
    selectedHangarIds: csv(query, "hangar"),
    filterAircraftTypeIds: csv(query, "type"),
    filterOperatorIds: csv(query, "op"),
    filterAircraftIds: csv(query, "ac"),
    filterEventTypeIds: csv(query, "et"),
    filterWorkshopIds: csv(query, "ws"),
    filterStatusIds: csv(query, "st"),
    filterPlanningKinds: pk,
    filterLineBases: lb,
    fitWidth: query.get("fit") === "1",
    showAllPlacementLinks: query.get("links") === "1",
    showExternalMroOnGantt: query.get("ext") !== "0",
    showGanttNotes: query.get("notes") === "1"
  };
}

export function serializeGanttViewShare(state: GanttViewShare & { sandboxId?: string | null }): URLSearchParams {
  const q = new URLSearchParams();
  if (isValidDateInput(state.rangeFromApplied)) q.set("from", state.rangeFromApplied);
  if (isValidDateInput(state.rangeToApplied)) q.set("to", state.rangeToApplied);
  if (state.groupMode === "HANGAR_STAND") q.set("group", "h");
  if (state.panelView === "TABLE") q.set("view", "t");
  if (state.ganttDisplayMode === "PLAN_FACT") q.set("pf", "1");
  if (state.minorScale !== "day") q.set("min", state.minorScale);
  if (state.majorScale !== "week") q.set("maj", state.majorScale);
  if (state.timelineTimeMode === "UTC") q.set("tz", "utc");
  setFlag(q, "fit", state.fitWidth);
  setFlag(q, "links", state.showAllPlacementLinks);
  if (!state.showExternalMroOnGantt) q.set("ext", "0");
  setFlag(q, "notes", state.showGanttNotes);
  setCsv(q, "hangar", state.selectedHangarIds);
  setCsv(q, "op", state.filterOperatorIds);
  setCsv(q, "type", state.filterAircraftTypeIds);
  setCsv(q, "ac", state.filterAircraftIds);
  setCsv(q, "et", state.filterEventTypeIds);
  setCsv(q, "ws", state.filterWorkshopIds);
  setCsv(q, "st", state.filterStatusIds);
  setCsv(q, "pk", state.filterPlanningKinds);
  setCsv(q, "lb", state.filterLineBases);
  putSandbox(q, state.sandboxId);
  return q;
}

export function syncGanttViewHash(state: GanttViewShare & { sandboxId?: string | null }) {
  if (typeof window === "undefined") return;
  const parsed = parseHashPage(location.hash);
  if (parsed.page !== "gantt") return;
  const q = serializeGanttViewShare(state);
  const eventId = parsed.query.get("event")?.trim();
  if (eventId) q.set("event", eventId);
  writePageHashQuery("gantt", q);
}

function parseLayouts(raw: string | null): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const dot = part.indexOf(".");
    if (dot <= 0) continue;
    const hangarId = part.slice(0, dot).trim();
    const layoutId = part.slice(dot + 1).trim();
    if (hangarId && layoutId) out[hangarId] = layoutId;
  }
  return out;
}

function serializeLayouts(map: Record<string, string>): string {
  return Object.entries(map)
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `${k}.${v}`)
    .join(",");
}

export function parseHangarViewShare(query: URLSearchParams): HangarViewShare | null {
  if (!queryHasViewShare(query)) return null;
  const from = readDate(query, "from");
  const to = readDate(query, "to");
  const atRaw = Number(query.get("at"));
  return {
    fromDate: from ?? "",
    toDate: to ?? "",
    viewMode: query.get("mode") === "moment" ? "moment" : "range",
    minuteOffset: Number.isFinite(atRaw) ? atRaw : 12 * 60,
    layoutIdByHangarId: parseLayouts(query.get("ly")),
    filterHangarIds: csv(query, "hangar"),
    filterOperatorIds: csv(query, "op"),
    filterAircraftTypeIds: csv(query, "type"),
    filterAircraftIds: csv(query, "ac"),
    filterEventTypeIds: csv(query, "et")
  };
}

export function serializeHangarViewShare(state: HangarViewShare & { sandboxId?: string | null }): URLSearchParams {
  const q = new URLSearchParams();
  if (isValidDateInput(state.fromDate)) q.set("from", state.fromDate);
  if (isValidDateInput(state.toDate)) q.set("to", state.toDate);
  if (state.viewMode === "moment") {
    q.set("mode", "moment");
    q.set("at", String(state.minuteOffset));
  }
  const ly = serializeLayouts(state.layoutIdByHangarId);
  if (ly) q.set("ly", ly);
  setCsv(q, "hangar", state.filterHangarIds);
  setCsv(q, "op", state.filterOperatorIds);
  setCsv(q, "type", state.filterAircraftTypeIds);
  setCsv(q, "ac", state.filterAircraftIds);
  setCsv(q, "et", state.filterEventTypeIds);
  putSandbox(q, state.sandboxId);
  return q;
}

export function syncHangarViewHash(state: HangarViewShare & { sandboxId?: string | null }) {
  if (typeof window === "undefined") return;
  const parsed = parseHashPage(location.hash);
  if (parsed.page !== "hangar") return;
  writePageHashQuery("hangar", serializeHangarViewShare(state));
}

const ANALYTICS_TABS = ["tat", "util", "tows", "compare", "monthly", "builder"] as const;
const ANALYTICS_GRAINS = ["day", "week", "month", "period"] as const;

export function parseAnalyticsViewShare(query: URLSearchParams): AnalyticsViewShare | null {
  if (!queryHasViewShare(query)) return null;
  const from = readDate(query, "from");
  const to = readDate(query, "to");
  const tabRaw = query.get("tab") ?? "tat";
  const grainRaw = query.get("grain") ?? "week";
  return {
    tab: (ANALYTICS_TABS as readonly string[]).includes(tabRaw) ? (tabRaw as AnalyticsViewShare["tab"]) : "tat",
    fromDate: from ?? "",
    toDate: to ?? "",
    compareA: query.get("ca")?.trim() || "prod",
    compareB: query.get("cb")?.trim() || "",
    efficiencyGrain: (ANALYTICS_GRAINS as readonly string[]).includes(grainRaw)
      ? (grainRaw as AnalyticsViewShare["efficiencyGrain"])
      : "week",
    filterHangarIds: csv(query, "hangar"),
    filterOperatorIds: csv(query, "op"),
    filterAircraftTypeIds: csv(query, "type"),
    filterAircraftIds: csv(query, "ac"),
    filterEventTypeIds: csv(query, "et")
  };
}

export function serializeAnalyticsViewShare(state: AnalyticsViewShare & { sandboxId?: string | null }): URLSearchParams {
  const q = new URLSearchParams();
  if (state.tab !== "tat") q.set("tab", state.tab);
  if (isValidDateInput(state.fromDate)) q.set("from", state.fromDate);
  if (isValidDateInput(state.toDate)) q.set("to", state.toDate);
  if (state.compareA && state.compareA !== "prod") q.set("ca", state.compareA);
  if (state.compareB) q.set("cb", state.compareB);
  if (state.efficiencyGrain !== "week") q.set("grain", state.efficiencyGrain);
  setCsv(q, "hangar", state.filterHangarIds);
  setCsv(q, "op", state.filterOperatorIds);
  setCsv(q, "type", state.filterAircraftTypeIds);
  setCsv(q, "ac", state.filterAircraftIds);
  setCsv(q, "et", state.filterEventTypeIds);
  putSandbox(q, state.sandboxId);
  return q;
}

export function syncAnalyticsViewHash(state: AnalyticsViewShare & { sandboxId?: string | null }) {
  if (typeof window === "undefined") return;
  const parsed = parseHashPage(location.hash);
  if (parsed.page !== "analytics") return;
  writePageHashQuery("analytics", serializeAnalyticsViewShare(state));
}

export function parseTowsViewShare(query: URLSearchParams): TowsViewShare | null {
  if (!queryHasViewShare(query)) return null;
  const from = readDate(query, "from");
  const to = readDate(query, "to");
  return {
    fromDate: from ?? "",
    toDate: to ?? "",
    filterHangarIds: csv(query, "hangar"),
    filterOperatorIds: csv(query, "op"),
    filterAircraftTypeIds: csv(query, "type"),
    filterAircraftIds: csv(query, "ac")
  };
}

export function serializeTowsViewShare(state: TowsViewShare & { sandboxId?: string | null }): URLSearchParams {
  const q = new URLSearchParams();
  if (isValidDateInput(state.fromDate)) q.set("from", state.fromDate);
  if (isValidDateInput(state.toDate)) q.set("to", state.toDate);
  setCsv(q, "hangar", state.filterHangarIds);
  setCsv(q, "op", state.filterOperatorIds);
  setCsv(q, "type", state.filterAircraftTypeIds);
  setCsv(q, "ac", state.filterAircraftIds);
  putSandbox(q, state.sandboxId);
  return q;
}

export function syncTowsViewHash(state: TowsViewShare & { sandboxId?: string | null }) {
  if (typeof window === "undefined") return;
  const parsed = parseHashPage(location.hash);
  if (parsed.page !== "tows") return;
  writePageHashQuery("tows", serializeTowsViewShare(state));
}

export const REF_SHARE_KINDS = [
  "operators",
  "aircraft-types",
  "aircraft",
  "aircraft-type-palette",
  "event-types",
  "event-statuses",
  "workshops",
  "hangars",
  "layouts",
  "stands",
  "placement-priorities",
  "optimization-profiles",
  "optimization-score-rules",
  "skills",
  "persons",
  "shifts",
  "materials",
  "warehouses"
] as const;

export type RefShareKind = (typeof REF_SHARE_KINDS)[number];

export type RefViewShare = {
  kind: RefShareKind;
  search: string;
  filterHangarId: string;
  filterLayoutId: string;
};

function parseRefKind(raw: string | null): RefShareKind {
  return raw && (REF_SHARE_KINDS as readonly string[]).includes(raw) ? (raw as RefShareKind) : "operators";
}

export function parseRefViewShare(query: URLSearchParams): RefViewShare | null {
  if (!queryHasViewShare(query)) return null;
  return {
    kind: parseRefKind(query.get("kind")),
    search: query.get("q")?.trim() ?? "",
    filterHangarId: csv(query, "hangar")[0] ?? "",
    filterLayoutId: query.get("layout")?.trim() ?? ""
  };
}

export function serializeRefViewShare(state: RefViewShare): URLSearchParams {
  const q = new URLSearchParams();
  q.set("kind", state.kind);
  if (state.search.trim()) q.set("q", state.search.trim());
  if (state.filterHangarId) q.set("hangar", state.filterHangarId);
  if (state.filterLayoutId) q.set("layout", state.filterLayoutId);
  return q;
}

export function syncRefViewHash(state: RefViewShare) {
  if (typeof window === "undefined") return;
  const parsed = parseHashPage(location.hash);
  if (parsed.page !== "ref") return;
  writePageHashQuery("ref", serializeRefViewShare(state));
}
