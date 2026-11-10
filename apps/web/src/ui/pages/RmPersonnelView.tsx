import { Fragment, startTransition, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "../../lib/api";
import {
  balanceClass,
  clampResourcePeriod,
  dateKey,
  formatPersonnelNumber,
  mondayOfWeek,
  periodDates,
  personnelViewDefaults,
  readPersonnelView,
  savedIdList,
  type PersonnelTab,
  shiftPeriod,
  periodTimelinePosition
} from "../../lib/personnelPlanning";
import { contrastTextColor } from "../../lib/colorContrast";
import { exportPersonnelPlanExcel } from "../../lib/personnelPlanExcel";
import { hasPermission } from "../../lib/permissionCatalog";
import { authMe } from "../auth/authApi";
import { BlockHelp } from "../components/BlockHelp";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { PersonnelCapacityPanel } from "./PersonnelCapacityPanel";
import { PersonnelResourceGrid } from "./PersonnelResourceGrid";
import { PersonnelDraftStore } from "../../lib/personnelResourceModel";
import { useActiveSandbox } from "../components/SandboxSwitcher";

type Tab = PersonnelTab;
type Department = "ME" | "AV" | "INT" | "NDT" | "SHOP" | "CAB_REP" | "PAINT";
type Meta = {
  departments: Department[];
  categories: Array<{ code: string; name: string; department: Department | null; isAuthorized: boolean; sortOrder: number }>;
  workshopCategoryMappings: Array<{ workshopId: string; categoryCode: string }>;
  shifts: Array<{ id: string; code: string; name: string; startMin: number; endMin: number }>;
  workshops: Array<{ id: string; code: string; name: string }>;
  aircraftTypes: Array<{ id: string; name: string; icaoType?: string | null }>;
  workshopAircraftTypes?: Array<{ workshopId: string; aircraftTypeId: string }>;
};
type Placement = {
  id: string;
  startAt: string;
  endAt: string;
  budgetStartAt?: string | null;
  budgetEndAt?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  hangar?: { name?: string; code?: string } | null;
  stand?: { name?: string; code?: string } | null;
};
type PersonnelEvent = {
  id: string;
  title: string;
  aircraftLabel?: string;
  status: string;
  statusLabel?: string;
  planningKind?: string;
  startAt: string;
  endAt: string;
  budgetStartAt?: string | null;
  budgetEndAt?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  aircraft?: { tailNumber?: string } | null;
  aircraftType?: { id?: string; name?: string; icaoType?: string } | null;
  operator?: { id?: string; code?: string; name?: string } | null;
  workshop?: { id?: string; code?: string; name?: string } | null;
  eventType?: { code?: string; name?: string } | null;
  hangar?: { code?: string; name?: string } | null;
  workshopId?: string;
  placements: Placement[];
  towSegments?: Array<{ id: string; startAt: string; endAt: string }>;
  reportMetrics: Array<{ department: Department; manHours: number | string }>;
};
type DayCalculation = {
  date: string;
  normHours: number;
  demand: Record<Department, number>;
  authorizedSupply: Record<Department, number>;
  strictBalance: Record<Department, number>;
  overallDemand: number;
  overallSupply: number;
  overallBalance: number;
  qualificationSupply?: Record<string, number>;
  eventDemand?: Array<{
    id: string;
    title: string;
    aircraftLabel: string;
    eventType: string;
    operator: string;
    placement: string;
    hours: number;
    byDepartment: Record<Department, number>;
  }>;
};
type AvailabilityCell = { date: string; shiftId: string; aircraftTypeId: string; categoryCode: string | null; skillId?: string | null; headcount: number | string };
type AvailabilityWeek = { weekStart: string; version: number; isLocked: boolean };
type ResourceCategory = WeekResponse["mappedCategories"][number];
type ResourceSheet = {
  workshopId: string;
  code: string;
  name: string;
  aircraftTypes: Array<{ id: string; name: string; icaoType?: string | null }>;
  mappedCategories: ResourceCategory[];
  items: AvailabilityCell[];
  weeks: AvailabilityWeek[];
};
type AvailabilityResponse = {
  items?: AvailabilityCell[];
  weeks?: AvailabilityWeek[];
  sheets?: ResourceSheet[];
};
type WeekResponse = {
  week: { version: number; isLocked: boolean; lockedAt?: string | null; lockedBy?: { displayName?: string; email: string } | null };
  aircraftTypes: Array<{ id: string; name: string; icaoType?: string | null }>;
  demandDepartments?: Department[];
  balanceLines?: BalanceLine[];
  mappedCategories: Array<{ categoryCode: string; skillId?: string | null; department: Department | null; category: { code?: string; name?: string; department: Department | null } }>;
  availability: Array<{ date: string; shiftId: string; aircraftTypeId: string; categoryCode: string | null; skillId?: string | null; headcount: number | string }>;
  events: PersonnelEvent[];
  calculation: DayCalculation[];
  calculationByAircraftType: Record<string, DayCalculation[]>;
  baseline: { snapshot: { version: number; createdAt: string }; data: unknown } | null;
  lockedWeeks?: Array<{ weekStart: string; version: number; createdAt: string }>;
  planningWeeks?: Array<{ weekStart: string; isLocked: boolean; version: number }>;
  resourceSlices?: Array<{ workshopId: string; aircraftTypeId: string; planned: number; available: number; difference: number }>;
  deltaFromBaseline: {
    calculation: Array<{
      date: string;
      overallDemand: number;
      overallSupply: number;
      overallBalance: number;
      departments: Record<Department, { demand: number; authorizedSupply: number; strictBalance: number }>;
    }>;
    calculationByAircraftType: Record<string, Array<{
      date: string;
      overallDemand: number;
      overallSupply: number;
      overallBalance: number;
      departments: Record<Department, { demand: number; authorizedSupply: number; strictBalance: number }>;
    }>>;
    events: { added: string[]; removed: string[] };
    availabilityChanged: boolean;
    normsChanged: boolean;
    factorsChanged: boolean;
  } | null;
};
const API = "/api/personnel-planning";
const DEPT_LABEL: Record<Department, string> = {
  ME: "ME", AV: "AV", INT: "INT", NDT: "NDT", SHOP: "SHOP", CAB_REP: "Cabin repair", PAINT: "Paint"
};
type BalanceLine = {
  key: string;
  label: string;
  planDepartment: Department | null;
  supply: "department" | "qualification";
};

function fmtDayMonth(value: string) {
  const [, month, day] = value.split("-");
  return day && month ? `${day}.${month}` : value;
}

function fmtShortDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}.${month}.${year.slice(2)}` : value;
}

function fmtDate(value: string | null | undefined, time = false) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", time
    ? { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

function errorText(error: unknown) {
  return String((error as Error)?.message ?? error);
}

const PERSONNEL_UI_LS_KEY = "hangarPlanning:personnelUi:v1";

function readSavedPersonnelView() {
  const defaults = personnelViewDefaults();
  try {
    const raw = window.localStorage.getItem(PERSONNEL_UI_LS_KEY);
    return readPersonnelView(raw ? JSON.parse(raw) : null, defaults);
  } catch {
    return readPersonnelView(null, defaults);
  }
}

function readSavedScale(): "week" | "month" {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PERSONNEL_UI_LS_KEY) ?? "null") as { planScale?: unknown } | null;
    return raw?.planScale === "month" ? "month" : "week";
  } catch {
    return "week";
  }
}

function readSavedResourceWorkshops(fallback: string) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PERSONNEL_UI_LS_KEY) ?? "null") as Record<string, unknown> | null;
    return savedIdList(raw?.resourceWorkshopIds, fallback);
  } catch {
    return savedIdList(undefined, fallback);
  }
}

function readSavedIdList(key: "workshopIds" | "aircraftTypeIds", fallback: string) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PERSONNEL_UI_LS_KEY) ?? "null") as Record<string, unknown> | null;
    return savedIdList(raw?.[key], fallback);
  } catch {
    return savedIdList(undefined, fallback);
  }
}

const NO_SHIFTS: Meta["shifts"] = [];

export function RmPersonnelView() {
  const qc = useQueryClient();
  const { activeId: sandboxId } = useActiveSandbox();
  const production = !sandboxId;
  const [savedView] = useState(readSavedPersonnelView);
  const [tab, setTab] = useState<Tab>(savedView.tab);
  const [weekStart] = useState(savedView.weekStart);
  const [periodFrom, setPeriodFrom] = useState(savedView.periodFrom);
  const [periodTo, setPeriodTo] = useState(savedView.periodTo);
  const [workshopId, setWorkshopId] = useState(savedView.workshopId);
  const [resourceWorkshopIds, setResourceWorkshopIds] = useState(() => readSavedResourceWorkshops(savedView.workshopId));
  const [aircraftTypeId, setAircraftTypeId] = useState(savedView.aircraftTypeId);
  const [workshopIds, setWorkshopIds] = useState(() => readSavedIdList("workshopIds", savedView.workshopId));
  const [aircraftTypeIds, setAircraftTypeIds] = useState(() => readSavedIdList("aircraftTypeIds", savedView.aircraftTypeId));
  const [planScale, setPlanScale] = useState<"week" | "month">(readSavedScale);
  const [planExporting, setPlanExporting] = useState(false);
  const [planExportError, setPlanExportError] = useState("");
  const [openDates, setOpenDates] = useState<string[]>([]);
  const draftStore = useRef<PersonnelDraftStore | null>(null);
  const resourceDraft = draftStore.current ?? (draftStore.current = new PersonnelDraftStore());

  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: authMe });
  const permissions = meQ.data?.ok ? meQ.data.user.permissions : [];
  const canWrite = hasPermission(permissions, "personnel:write");
  const canLock = hasPermission(permissions, "personnel:lock");
  const canUnlock = hasPermission(permissions, "personnel:unlock");

  const metaQ = useQuery({
    queryKey: ["personnel", "meta"],
    queryFn: () => apiGet<Meta>(`${API}/meta`),
    enabled: production
  });
  const meta = metaQ.data;
  useEffect(() => {
    if (!meta?.workshops.length) return;
    const known = new Set(meta.workshops.map((row) => row.id));
    setResourceWorkshopIds((old) => {
      if (!old.length) return old;
      const next = old.filter((id) => known.has(id));
      if (next.length === old.length) return old;
      return next.length ? next : [meta.workshops[0].id];
    });
    if (!known.has(workshopId)) setWorkshopId(meta.workshops[0].id);
  }, [meta, workshopId]);
  useEffect(() => {
    if (!workshopId) return;
    try {
      window.localStorage.setItem(PERSONNEL_UI_LS_KEY, JSON.stringify({ tab, weekStart, periodFrom, periodTo, workshopId, aircraftTypeId, workshopIds, aircraftTypeIds, resourceWorkshopIds, planScale }));
    } catch {
      // ignore
    }
  }, [tab, weekStart, periodFrom, periodTo, workshopId, aircraftTypeId, workshopIds, aircraftTypeIds, resourceWorkshopIds, planScale]);

  const weekQ = useQuery({
    queryKey: ["personnel", "week", weekStart, workshopId],
    queryFn: () => apiGet<WeekResponse>(`${API}/week?${new URLSearchParams({ weekStart, workshopId })}`),
    enabled: production && Boolean(workshopId)
  });
  const week = weekQ.data;
  useEffect(() => {
    const types = week?.aircraftTypes ?? [];
    if (!types.length) return;
    if (!types.some((type) => type.id === aircraftTypeId)) setAircraftTypeId(types[0].id);
  }, [week?.aircraftTypes, aircraftTypeId]);
  const workshopFilterOptions = useMemo(() => {
    const links = meta?.workshopAircraftTypes ?? [];
    return (meta?.workshops ?? [])
      .filter((workshop) => !aircraftTypeIds.length || links.some((link) => link.workshopId === workshop.id && aircraftTypeIds.includes(link.aircraftTypeId)))
      .map((workshop) => ({ id: workshop.id, label: workshop.code }));
  }, [meta, aircraftTypeIds]);
  const typeFilterOptions = useMemo(() => {
    const links = meta?.workshopAircraftTypes ?? [];
    const scope = new Set(workshopIds.length ? workshopIds : (meta?.workshops ?? []).map((row) => row.id));
    const allowed = new Set(links.filter((link) => scope.has(link.workshopId)).map((link) => link.aircraftTypeId));
    return (meta?.aircraftTypes ?? [])
      .filter((type) => allowed.has(type.id))
      .map((type) => ({ id: type.id, label: type.icaoType || type.name }));
  }, [meta, workshopIds]);
  useEffect(() => {
    if (!meta) return;
    const workshops = new Set(workshopFilterOptions.map((row) => row.id));
    const types = new Set(typeFilterOptions.map((row) => row.id));
    setWorkshopIds((old) => {
      const next = old.filter((id) => workshops.has(id));
      return next.length === old.length ? old : next;
    });
    setAircraftTypeIds((old) => {
      const next = old.filter((id) => types.has(id));
      return next.length === old.length ? old : next;
    });
  }, [meta, workshopFilterOptions, typeFilterOptions]);
  const paletteQ = useQuery({
    queryKey: ["ref", "aircraft-type-palette"],
    queryFn: () => apiGet<Array<{ operatorId: string; aircraftTypeId: string; color: string; isActive?: boolean }>>("/api/ref/aircraft-type-palette"),
    enabled: production && tab === "week",
    staleTime: 60_000
  });
  const palette = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of paletteQ.data ?? []) {
      if (row.isActive === false || !row.color) continue;
      map.set(`${row.operatorId}|${row.aircraftTypeId}`, row.color);
    }
    return map;
  }, [paletteQ.data]);
  const balanceTypeIds = aircraftTypeIds.length ? aircraftTypeIds : typeFilterOptions.map((row) => row.id);
  const balanceQ = useQuery({
    queryKey: ["personnel", "balance", [...workshopIds].sort().join(","), [...balanceTypeIds].sort().join(","), periodFrom, periodTo],
    queryFn: () => apiGet<WeekResponse>(`${API}/balance?${new URLSearchParams({ workshopIds: workshopIds.join(","), aircraftTypeIds: balanceTypeIds.join(","), from: periodFrom, to: periodTo })}`),
    enabled: production && tab !== "resources" && workshopIds.length > 0 && balanceTypeIds.length > 0
  });
  const orderedResourceIds = useMemo(() => {
    const selected = new Set(resourceWorkshopIds);
    const known = (meta?.workshops ?? []).filter((row) => selected.has(row.id)).map((row) => row.id);
    return known.length ? known : resourceWorkshopIds;
  }, [meta?.workshops, resourceWorkshopIds]);
  const availabilityQ = useQuery({
    queryKey: ["personnel", "availability", [...orderedResourceIds].sort().join(","), periodFrom, periodTo],
    queryFn: () => apiGet<AvailabilityResponse>(`${API}/availability?${new URLSearchParams({ workshopIds: orderedResourceIds.join(","), from: periodFrom, to: periodTo })}`),
    enabled: production && tab === "resources" && orderedResourceIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000
  });
  const resourceSheets = useMemo(() => {
    const byId = new Map((availabilityQ.data?.sheets ?? []).map((sheet) => [sheet.workshopId, sheet]));
    return orderedResourceIds.flatMap((id) => {
      const sheet = byId.get(id);
      return sheet ? [sheet] : [];
    });
  }, [availabilityQ.data?.sheets, orderedResourceIds]);

  const dates = useMemo(() => periodDates(periodFrom, periodTo), [periodFrom, periodTo]);
  const today = dateKey(new Date());
  const categories = week?.mappedCategories ?? [];
  const balance = tab === "balance" ? balanceQ.data : week;
  const sheet = tab === "resources" ? week : balanceQ.data;
  const planMonday = mondayOfWeek(periodFrom);
  const planWorkshopId = workshopIds.length === 1 ? workshopIds[0] ?? "" : "";
  const planLocked = Boolean(balanceQ.data?.planningWeeks?.some((row) => dateKey(row.weekStart) === planMonday && row.isLocked));
  const selectedEvents = useMemo(() => {
    const events = sheet?.events ?? [];
    if (tab === "resources") return events.filter((event) => event.aircraftType?.id === aircraftTypeId);
    const allowed = new Set(balanceTypeIds);
    return events.filter((event) => event.aircraftType?.id && allowed.has(event.aircraftType.id));
  }, [sheet?.events, aircraftTypeId, balanceTypeIds, tab]);
  const selectedCalculation = useMemo(() => {
    if (tab === "balance") return balance?.calculation ?? [];
    const direct = balance?.calculationByAircraftType?.[aircraftTypeId];
    if (direct) return direct;
    return (balance?.calculation ?? []).map((day) => {
      const zeros = Object.fromEntries((meta?.departments ?? []).map((department) => [department, 0])) as Record<Department, number>;
      return {
        ...day,
        demand: { ...zeros },
        authorizedSupply: { ...zeros },
        strictBalance: { ...zeros },
        overallDemand: 0,
        overallSupply: 0,
        overallBalance: 0
      };
    });
  }, [balance, aircraftTypeId, meta?.departments, tab]);
  const lockM = useMutation({
    mutationFn: (action: "lock" | "unlock") => apiPost(`${API}/weeks/${planWorkshopId}/${planMonday}/${action}`, {}),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["personnel", "week"] });
      await qc.invalidateQueries({ queryKey: ["personnel", "availability"] });
      await qc.invalidateQueries({ queryKey: ["personnel", "balance"] });
    }
  });

  const exportPlan = async () => {
    setPlanExportError("");
    setPlanExporting(true);
    try {
      const data = await apiGet<AvailabilityResponse>(`${API}/availability?${new URLSearchParams({ workshopIds: workshopIds.join(","), from: periodFrom, to: periodTo })}`);
      const allowed = new Set(balanceTypeIds);
      const byId = new Map((data.sheets ?? []).map((sheet) => [sheet.workshopId, sheet]));
      const workshopCode = new Map((meta?.workshops ?? []).map((row) => [row.id, row.code || row.name]));
      const typeCode = new Map((meta?.aircraftTypes ?? []).map((row) => [row.id, row.icaoType || row.name]));
      const dateSet = new Set(dates);
      await exportPersonnelPlanExcel({
        from: periodFrom,
        to: periodTo,
        scale: planScale,
        dates,
        shifts: meta?.shifts ?? [],
        sheets: workshopIds.flatMap((id) => {
          const sheet = byId.get(id);
          if (!sheet) return [];
          const categories = sheet.mappedCategories.map((row) => ({ code: row.categoryCode, department: row.department }));
          const known = new Set(categories.map((row) => row.code));
          return [{
            workshopId: sheet.workshopId,
            code: sheet.code,
            name: sheet.name,
            aircraftTypes: sheet.aircraftTypes.filter((type) => allowed.has(type.id)),
            categories,
            items: sheet.items.flatMap((item) => {
              const raw = item as AvailabilityCell & { skill?: { code?: string | null } | null };
              const code = raw.skill?.code || raw.categoryCode || "";
              const date = dateKey(raw.date);
              const headcount = Number(raw.headcount);
              if (!code || !known.has(code) || !allowed.has(raw.aircraftTypeId) || !dateSet.has(date) || !Number.isFinite(headcount) || headcount === 0) return [];
              return [{ date, shiftId: raw.shiftId, aircraftTypeId: raw.aircraftTypeId, categoryCode: code, headcount }];
            })
          }];
        }),
        days: (balanceQ.data?.calculation ?? []).map((day) => ({
          date: dateKey(day.date),
          normHours: Number(day.normHours ?? 0),
          eventDemand: (day.eventDemand ?? []).map((event) => ({ id: event.id, byDepartment: event.byDepartment }))
        })),
        events: selectedEvents.map((event) => {
          const place = planPlace(event, periodFrom, periodTo);
          const typeId = event.aircraftType?.id ?? "";
          const ownerId = event.workshopId ?? event.workshop?.id ?? "";
          return {
            id: event.id,
            title: event.title,
            tail: event.aircraftLabel || event.aircraft?.tailNumber || "—",
            hangarLabel: place.hangarLabel,
            workshopId: ownerId,
            workshop: workshopCode.get(ownerId) || event.workshop?.code || event.workshop?.name || "—",
            operator: event.operator?.code || event.operator?.name || "—",
            aircraftTypeId: typeId,
            aircraftType: typeCode.get(typeId) || event.aircraftType?.icaoType || event.aircraftType?.name || "—",
            stand: place.stand,
            status: event.statusLabel || event.status || "—",
            startAt: event.startAt,
            endAt: event.endAt,
            color: barColor(event, palette),
            towSegments: (event.towSegments ?? []).map((tow) => ({ startAt: tow.startAt, endAt: tow.endAt }))
          };
        }),
        departments: balanceQ.data?.demandDepartments ?? [],
        slices: (balanceQ.data?.resourceSlices ?? []).map((row) => ({
          workshopId: row.workshopId,
          workshop: workshopCode.get(row.workshopId) || "—",
          aircraftTypeId: row.aircraftTypeId,
          aircraftType: typeCode.get(row.aircraftTypeId) || "—"
        }))
      });
    } catch (error) {
      setPlanExportError(errorText(error));
    } finally {
      setPlanExporting(false);
    }
  };

  if (!production) {
    return (
      <div className="personnelPage">
        <section className="massHero">
          <div className="massHeroText"><div className="massEyebrow">Ресурсное планирование</div><h1>РМ Персонал</h1></div>
          <div className="massHeroStats"><span><b>Только рабочий контур</b></span></div>
        </section>
        <section className="card personnelEmpty">
          <h2>Ресурсы персонала не сценарные</h2>
          <p className="muted">Доступность, нормы и фиксация недель ведутся только в рабочем контуре. Переключитесь на «Рабочий контур»; запросы к данным персонала в песочнице не выполняются.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="personnelPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Ресурсное планирование · рабочий контур</div>
          <h1>РМ Персонал</h1>
        </div>
        <div className="massHeroStats">
          <span><b>{tab === "resources" ? resourceSheets.reduce((sum, sheet) => sum + sheet.mappedCategories.length, 0) : categories.length}</b> квалификаций</span>
          <span><b>{selectedEvents.length}</b> событий выбранного типа</span>
          <span><b>{dates.length}</b> дн.</span>
          {tab === "week" && planWorkshopId ? <span><b>{planLocked ? "Неделя зафиксирована" : "Неделя — черновик"}</b></span> : null}
        </div>
      </section>

      <section className="card personnelToolbar">
        <div className="personnelFilters">
          <button type="button" className="btn" onClick={() => startTransition(() => { const next = shiftPeriod(periodFrom, periodTo, -1); setPeriodFrom(next.from); setPeriodTo(next.to); })}>←</button>
          <label>С<input type="date" name="personnelPeriodFrom" autoComplete="off" value={periodFrom} onChange={(e) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return; const next = clampResourcePeriod(e.target.value, periodTo); if (!next.from) return; startTransition(() => { setPeriodFrom(next.from); setPeriodTo(next.to); }); }} /></label>
          <label>По<input type="date" name="personnelPeriodTo" autoComplete="off" value={periodTo} max={clampResourcePeriod(periodFrom, "2999-12-31").to} onChange={(e) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return; const next = clampResourcePeriod(periodFrom, e.target.value); if (!next.from) return; startTransition(() => { setPeriodFrom(next.from); setPeriodTo(next.to); }); }} /></label>
          <button type="button" className="btn" onClick={() => startTransition(() => { const next = shiftPeriod(periodFrom, periodTo, 1); setPeriodFrom(next.from); setPeriodTo(next.to); })}>→</button>
          {tab === "resources" ? null : (
            <>
              <label>Цех<MultiSelectDropdown options={workshopFilterOptions} value={workshopIds} onChange={(ids) => startTransition(() => setWorkshopIds(ids))} placeholder="Цех" selectedLabelMode="labels" collapseAllLabel="Все цеха" compact portal /></label>
              <label>Тип ВС<MultiSelectDropdown options={typeFilterOptions} value={aircraftTypeIds} onChange={(ids) => startTransition(() => setAircraftTypeIds(ids))} placeholder="Все типы цеха" selectedLabelMode="labels" collapseAllLabel="Все типы" compact portal /></label>
            </>
          )}
          {tab === "resources" ? (
            <label>Цех<MultiSelectDropdown options={(meta?.workshops ?? []).map((row) => ({ id: row.id, label: row.code }))} value={resourceWorkshopIds} onChange={(ids) => startTransition(() => setResourceWorkshopIds(ids))} placeholder="Цех" selectedLabelMode="labels" collapseAllLabel="Все цеха" compact portal /></label>
          ) : null}
          {tab === "week" ? (
            <div className="personnelScale" role="group" aria-label="Масштаб">
              <button type="button" className={planScale === "week" ? "active" : ""} onClick={() => setPlanScale("week")}>Неделя</button>
              <button type="button" className={planScale === "month" ? "active" : ""} onClick={() => setPlanScale("month")}>Месяц</button>
            </div>
          ) : null}
        </div>
        <div className="personnelLockActions">
          {tab === "week" && planWorkshopId && planLocked && canUnlock ? <button className="btn" disabled={lockM.isPending || planMonday < mondayOfWeek(today)} onClick={() => lockM.mutate("unlock")}>Снять фиксацию {fmtDayMonth(planMonday)}</button> : null}
          {tab === "week" && planWorkshopId && !planLocked && canLock ? <button className="btn btnPrimary" disabled={lockM.isPending || planMonday < mondayOfWeek(today)} onClick={() => lockM.mutate("lock")}>Зафиксировать неделю {fmtDayMonth(planMonday)}</button> : null}
        </div>
      </section>

      <div className="personnelTabs" role="tablist">
        {([
          ["resources", "Доступный ресурс"], ["balance", "План/Доступность"], ["week", "График/План"], ["capacity", "Capacity"]
        ] as Array<[Tab, string]>).map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {metaQ.isLoading || ((tab === "balance" || tab === "week") && weekQ.isLoading) || (tab === "resources" && orderedResourceIds.length > 0 && !resourceSheets.length && (availabilityQ.isLoading || availabilityQ.isFetching)) || (tab !== "resources" && balanceQ.isLoading) ? <section className="card">Загрузка…</section> : null}
      {metaQ.error || weekQ.error || availabilityQ.error || balanceQ.error ? <div className="error">{errorText(metaQ.error || weekQ.error || availabilityQ.error || balanceQ.error)}</div> : null}

      {tab === "resources" && !orderedResourceIds.length ? (
        <section className="card personnelEmpty"><h2>Выберите цех</h2></section>
      ) : null}

      {tab === "resources" && orderedResourceIds.length > 0 && resourceSheets.length > 0 ? (
        <PersonnelResourceGrid
          store={resourceDraft}
          sheets={resourceSheets}
          dates={dates}
          shifts={meta?.shifts ?? NO_SHIFTS}
          today={today}
          canWrite={canWrite}
          fetching={availabilityQ.isFetching}
        />
      ) : null}

      {tab === "balance" && !workshopIds.length ? (
        <section className="card personnelEmpty"><h2>Выберите цех</h2></section>
      ) : null}
      {tab === "balance" && workshopIds.length > 0 && !balanceTypeIds.length ? (
        <section className="card personnelEmpty"><h2>Для выбранных цехов нет типов ВС</h2></section>
      ) : null}
      {tab === "balance" && workshopIds.length > 0 && balance ? (
        <BalancePanel
          days={selectedCalculation}
          lines={balance.balanceLines ?? []}
          openDates={openDates}
          onToggleDate={(date) => setOpenDates((old) => old.includes(date) ? old.filter((item) => item !== date) : [...old, date])}
          events={selectedEvents}
          added={new Set(balance.deltaFromBaseline?.events.added ?? [])}
          resourceWorkshop={meta?.workshops.filter((row) => workshopIds.includes(row.id)).map((row) => row.code).join(", ") || "—"}
          baselineNote={balance.lockedWeeks?.length ? `База: фиксации ${balance.lockedWeeks.map((row) => fmtDate(row.weekStart)).join(", ")}.` : ""}
        />
      ) : null}

      {tab === "capacity" && !workshopIds.length ? (
        <section className="card personnelEmpty"><h2>Выберите цех</h2></section>
      ) : null}
      {tab === "capacity" && workshopIds.length > 0 && !balanceTypeIds.length ? (
        <section className="card personnelEmpty"><h2>Для выбранных цехов нет типов ВС</h2></section>
      ) : null}
      {tab === "capacity" && workshopIds.length > 0 && balanceTypeIds.length > 0 && balanceQ.data ? (
        <PersonnelCapacityPanel
          days={balanceQ.data.calculation ?? []}
          lines={balanceQ.data.balanceLines ?? []}
          slices={balanceQ.data.resourceSlices ?? []}
          workshops={meta?.workshops ?? []}
          aircraftTypes={meta?.aircraftTypes ?? []}
        />
      ) : null}

      {tab === "week" && !workshopIds.length ? (
        <section className="card personnelEmpty"><h2>Выберите цех</h2></section>
      ) : null}
      {tab === "week" && workshopIds.length > 0 && !balanceTypeIds.length ? (
        <section className="card personnelEmpty"><h2>Для выбранных цехов нет типов ВС</h2></section>
      ) : null}
      {tab === "week" && workshopIds.length > 0 && balanceTypeIds.length > 0 && balanceQ.data ? (
        <WeeklyTimeline
          events={selectedEvents}
          from={periodFrom}
          to={periodTo}
          palette={palette}
          slices={balanceQ.data.resourceSlices ?? []}
          demandDays={balanceQ.data.calculation ?? []}
          workshops={meta?.workshops ?? []}
          aircraftTypes={meta?.aircraftTypes ?? []}
          scale={planScale}
          departments={balanceQ.data.demandDepartments ?? []}
          exporting={planExporting}
          onExport={() => void exportPlan()}
        />
      ) : null}
      {tab === "week" && planExportError ? <div className="error">{planExportError}</div> : null}
      {lockM.error ? <div className="error">{errorText(lockM.error)}</div> : null}
    </div>
  );
}

function BalancePanel({ days, lines, openDates, onToggleDate, events, added, resourceWorkshop, baselineNote }: {
  days: DayCalculation[];
  lines: BalanceLine[];
  openDates: string[];
  onToggleDate: (date: string) => void;
  events: PersonnelEvent[];
  added: Set<string>;
  resourceWorkshop: string;
  baselineNote: string;
}) {
  const lineOf = (day: DayCalculation, line: BalanceLine) => {
    const demand = line.planDepartment ? day.demand?.[line.planDepartment] ?? 0 : 0;
    const supply = line.supply === "department" && line.planDepartment
      ? day.authorizedSupply?.[line.planDepartment] ?? 0
      : day.qualificationSupply?.[line.key] ?? 0;
    return { demand, supply, balance: supply - demand };
  };
  const metricOf = (day: DayCalculation) => ({
    overallDemand: day.overallDemand,
    overallSupply: day.overallSupply,
    overallBalance: day.overallBalance,
    lines: Object.fromEntries(lines.map((line) => [line.key, lineOf(day, line)])) as Record<string, { demand: number; supply: number; balance: number }>
  });
  const totals = days.reduce((sum, day) => {
    const row = metricOf(day);
    sum.overallDemand += row.overallDemand;
    sum.overallSupply += row.overallSupply;
    sum.overallBalance += row.overallBalance;
    for (const column of lines) {
      const values = row.lines[column.key]!;
      const total = sum.lines[column.key] ?? { demand: 0, supply: 0, balance: 0 };
      sum.lines[column.key] = { demand: total.demand + values.demand, supply: total.supply + values.supply, balance: total.balance + values.balance };
    }
    return sum;
  }, {
    overallDemand: 0,
    overallSupply: 0,
    overallBalance: 0,
    lines: {} as Record<string, { demand: number; supply: number; balance: number }>
  });
  const metricCells = (row: { overallDemand: number; overallSupply: number; overallBalance: number; lines: Record<string, { demand: number; supply: number; balance: number }> }) => (
    <>
      <td className="personnelNum">{formatPersonnelNumber(row.overallDemand)}</td>
      <td className="personnelNum">{formatPersonnelNumber(row.overallSupply)}</td>
      <td className={`personnelNum balance-${balanceClass(row.overallBalance)}`}>{formatPersonnelNumber(row.overallBalance)}</td>
      {lines.map((column) => {
        const values = row.lines[column.key] ?? { demand: 0, supply: 0, balance: 0 };
        return (
          <Fragment key={column.key}>
            <td className="personnelNum">{formatPersonnelNumber(values.demand)}</td>
            <td className="personnelNum">{formatPersonnelNumber(values.supply)}</td>
            <td className={`personnelNum balance-${balanceClass(values.balance)}`}>{formatPersonnelNumber(values.balance)}</td>
          </Fragment>
        );
      })}
    </>
  );
  const columnCount = 5 + lines.length * 3;
  return (
    <div className="personnelStack">
      <section className="card">
        <div className="personnelSectionHead"><div><h2 className="personnelResourceTitle">Баланс по суткам<BlockHelp label="Баланс по суткам"><p>Сутки выбранного периода: хватает ли доступного ресурса на плановую трудоёмкость событий.</p><ul><li>П — плановая трудоёмкость, ч·ч. Д — доступный ресурс, ч·ч. Diff — разница: доступный ресурс минус план.</li><li>Зелёная разница — ресурс больше плана, красная — план больше ресурса.</li><li>Дальше идут группы по категориям. В каждой снова П, Д и Diff: план категории и ресурс, который к ней относится.</li><li>«+» у даты раскрывает события, из которых собрана плановая трудоёмкость этих суток: борт, часы, заказчик, название и размещение.</li><li>Строка «Итого» суммирует все сутки периода.</li><li>Если под таблицей есть строка «База», сравнение идёт с зафиксированными неделями.</li></ul></BlockHelp></h2></div></div>
        <div className="personnelTableScroll"><table className="personnelBalance">
          <colgroup>
            <col className="personnelColDrill" />
            <col className="personnelColDate" />
            <col className="personnelColHours" />
            <col className="personnelColSupply" />
            <col className="personnelColDiff" />
            {lines.flatMap((line) => [
              <col key={`${line.key}-p`} className="personnelColMetric" />,
              <col key={`${line.key}-d`} className="personnelColMetric" />,
              <col key={`${line.key}-x`} className="personnelColMetric" />
            ])}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className="personnelDrillCol" />
              <th rowSpan={2}>Дата</th>
              <th rowSpan={2} title="Плановая трудоемкость">П</th>
              <th rowSpan={2} title="Доступный ресурс">Д</th>
              <th rowSpan={2} title="Разница">Diff</th>
              {lines.map((line) => <th key={line.key} colSpan={3}>{line.label}</th>)}
            </tr>
            <tr>{lines.map((line) => <Fragment key={line.key}><th title="План">П</th><th title="Доступность">Д</th><th title="Разница">Diff</th></Fragment>)}</tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const open = openDates.includes(day.date);
              return (
                <Fragment key={day.date}>
                  <tr>
                    <th className="personnelDrillCol"><button type="button" className="personnelDrillBtn" aria-expanded={open} onClick={() => onToggleDate(day.date)}>{open ? "−" : "+"}</button></th>
                    <th>{fmtShortDate(day.date)}</th>
                    {metricCells(metricOf(day))}
                  </tr>
                  {open ? (day.eventDemand?.length ? day.eventDemand.map((event) => (
                    <tr key={event.id} className="personnelDrillRow">
                      <td />
                      <td>{event.aircraftLabel || "—"}</td>
                      <td>{formatPersonnelNumber(event.hours)}</td>
                      <td>{[event.operator, event.eventType].filter(Boolean).join(" - ") || "—"}</td>
                      <td><div>{event.title || "—"}</div><small>{event.placement || "—"}</small></td>
                      {lines.map((line) => (
                        <Fragment key={line.key}>
                          <td>{line.planDepartment ? formatPersonnelNumber(event.byDepartment[line.planDepartment]) : ""}</td>
                          <td />
                          <td />
                        </Fragment>
                      ))}
                    </tr>
                  )) : (
                    <tr className="personnelDrillRow"><td colSpan={columnCount}><span className="muted">В этот день нет плановой трудоёмкости.</span></td></tr>
                  )) : null}
                </Fragment>
              );
            })}
            <tr className="personnelTotalRow"><th className="personnelDrillCol" /><th>Итого</th>{metricCells(totals)}</tr>
          </tbody>
        </table></div>
        {baselineNote ? <div className="muted personnelBaseline">{baselineNote}</div> : null}
      </section>
      <EventsTable events={events} added={added} resourceWorkshop={resourceWorkshop} />
    </div>
  );
}

function EventsTable({ events, added, resourceWorkshop }: { events: PersonnelEvent[]; added: Set<string>; resourceWorkshop: string }) {
  return <section className="card"><div className="personnelSectionHead"><div><h2 className="personnelResourceTitle">События спроса<BlockHelp label="События спроса"><p>События, чья плановая трудоёмкость вошла в баланс выбранного периода.</p><ul><li>В строке — название, борт, тип ВС, заказчик, форма ТО, статус и вид планирования.</li><li>Цех сверху — выбранные в фильтре цеха ресурса. Под ним — цех самого события.</li><li>Период события показан тремя контурами: план, бюджет и факт. Так же расписано каждое размещение: ангар, место и те же три контура.</li><li>«MPS по отделам» — плановые человеко-часы события по категориям.</li><li>Метка «новое» стоит на событии, которого не было в зафиксированной базе.</li><li>Список учитывает фильтр цехов и типов ВС. Событие без размещения остаётся в таблице с пометкой «Без размещений».</li></ul></BlockHelp></h2></div></div>
    <div className="personnelTableScroll"><table className="personnelEvents"><thead><tr><th>Событие</th><th>ВС / оператор</th><th>Тип / статус</th><th>Цех</th><th>Период события</th><th>Размещения</th><th>MPS по отделам</th></tr></thead>
      <tbody>{events.length ? events.map((event) => <tr key={event.id}><td><b>{event.title}</b>{added.has(event.id) ? <span className="personnelNewBadge">новое</span> : null}</td><td>{event.aircraftLabel || event.aircraft?.tailNumber || "—"}<small>{event.aircraftType?.icaoType || event.aircraftType?.name || "—"} · {event.operator?.code || event.operator?.name || "—"}</small></td><td>{event.eventType?.name || event.eventType?.code || "—"}<small>{event.statusLabel || event.status} · {event.planningKind || "—"}</small></td><td>{resourceWorkshop}<small>Цех события: {event.workshop?.code || event.workshop?.name || "—"}</small></td><td>План: {fmtDate(event.startAt, true)} — {fmtDate(event.endAt, true)}<small>Бюджет: {fmtDate(event.budgetStartAt, true)} — {fmtDate(event.budgetEndAt, true)}<br />Факт: {fmtDate(event.actualStartAt, true)} — {fmtDate(event.actualEndAt, true)}</small></td><td>{event.placements.length ? event.placements.map((p, i) => <div key={p.id} className="personnelPlacement"><b>{i + 1}. {p.hangar?.code || p.hangar?.name || "Ангар"} / {p.stand?.code || p.stand?.name || "место —"}</b><br />План: {fmtDate(p.startAt, true)} — {fmtDate(p.endAt, true)}<br />Бюджет: {fmtDate(p.budgetStartAt, true)} — {fmtDate(p.budgetEndAt, true)}<br />Факт: {fmtDate(p.actualStartAt, true)} — {fmtDate(p.actualEndAt, true)}</div>) : "Без размещений"}</td><td>{event.reportMetrics.map((m) => <div key={m.department}>{DEPT_LABEL[m.department]}: {formatPersonnelNumber(Number(m.manHours))}</div>)}</td></tr>) : <tr><td colSpan={7}>Нет событий спроса за выбранный период.</td></tr>}</tbody>
    </table></div></section>;
}

const PLAN_DEPARTMENTS: Department[] = ["ME", "AV", "INT", "NDT", "SHOP", "CAB_REP", "PAINT"];

function moscowDate(value: string) {
  return new Date(new Date(value).getTime() + 180 * 60_000);
}

function fmtClock(value: string) {
  const date = moscowDate(value);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function fmtTill(value: string) {
  const date = moscowDate(value);
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCFullYear()).slice(2)} ${fmtClock(value)}`;
}

const PLAN_BANDS: Array<Array<Department | null>> = [
  ["ME", "AV", "INT"],
  ["NDT", "SHOP", null],
  ["CAB_REP", "PAINT", null]
];

const BAND_LABEL: Record<Department, string> = {
  ME: "ME", AV: "AV", INT: "INT", NDT: "NDT", SHOP: "SHOP", CAB_REP: "CAB_REP", PAINT: "PAINT"
};

function visibleBands(departments: Department[]) {
  const active = new Set(departments);
  return PLAN_BANDS
    .map((band) => band.filter((department): department is Department => department != null && active.has(department)))
    .filter((band) => band.length > 0);
}

function recordLevels(values: Record<Department, number> | undefined) {
  return PLAN_DEPARTMENTS.flatMap((department) => {
    const hours = values?.[department] ?? 0;
    return Math.abs(hours) >= 0.5 ? [{ department, hours }] : [];
  });
}

function HourBands({ bands, levels, balance = false }: { bands: Department[][]; levels: Array<{ department: Department; hours: number }>; balance?: boolean }) {
  const byDepartment = new Map(levels.map((level) => [level.department, level.hours]));
  return <div className="personnelPlanBands">
    {bands.map((band) => <div key={band.join("-")} className="personnelPlanSlots">
      {band.map((department) => {
        const hours = byDepartment.get(department) ?? 0;
        const visible = Math.abs(hours) >= 0.5;
        const text = visible ? Math.round(hours).toLocaleString("ru-RU", { maximumFractionDigits: 0, useGrouping: false }) : "";
        return <span key={department} className={balance && visible ? `balance-${balanceClass(hours)}` : undefined} title={visible ? `${BAND_LABEL[department]} ${text}` : undefined}>{text}</span>;
      })}
    </div>)}
  </div>;
}

function BandLabels({ bands }: { bands: Department[][] }) {
  return <div className="personnelPlanBands personnelPlanBandLabels">
    {bands.map((band) => <div key={band.join("-")} className="personnelPlanSlots">
      {band.map((department) => <span key={department}>{BAND_LABEL[department]}</span>)}
    </div>)}
  </div>;
}

function hangarBannerLabel(hangar: { code?: string | null; name?: string | null } | null | undefined) {
  const name = hangar?.name?.trim() ?? "";
  const code = hangar?.code?.trim() ?? "";
  if (/^ангар\b/i.test(name)) return name.replace(/^ангар/i, "Ангар");
  const source = name || code;
  const digits = source.match(/\d+/)?.[0];
  if (digits && /^(?:h-?)?\d+$/i.test(source)) return `Ангар ${digits}`;
  if (name) return name;
  if (code) return code;
  return "Без ангара";
}

function planPlace(event: PersonnelEvent, from: string, to: string) {
  const start = new Date(`${from}T00:00:00+03:00`).getTime();
  const end = new Date(`${to}T00:00:00+03:00`).getTime() + 86_400_000;
  let best: Placement | null = null;
  let bestOverlap = 0;
  for (const placement of event.placements ?? []) {
    const overlap = Math.max(0, Math.min(new Date(placement.endAt).getTime(), end) - Math.max(new Date(placement.startAt).getTime(), start));
    if (overlap > bestOverlap) {
      best = placement;
      bestOverlap = overlap;
    }
  }
  const hangarRef = best?.hangar ?? event.hangar ?? null;
  const hangar = hangarRef?.code || hangarRef?.name || "—";
  const hangarLabel = hangarBannerLabel(hangarRef);
  const stand = best?.stand?.code || best?.stand?.name || "—";
  return { hangar, hangarLabel, stand };
}

function barColor(event: PersonnelEvent, palette: Map<string, string>) {
  const color = palette.get(`${event.operator?.id ?? ""}|${event.aircraftType?.id ?? ""}`);
  return color || "#64748b";
}

function demandLevels(days: DayCalculation[], eventId: string, date: string) {
  const day = days.find((row) => row.date.slice(0, 10) === date);
  const item = day?.eventDemand?.find((row) => row.id === eventId);
  if (!item) return [];
  return PLAN_DEPARTMENTS.flatMap((department) => {
    const hours = item.byDepartment?.[department] ?? 0;
    return hours >= 0.5 ? [{ department, hours }] : [];
  });
}

function WeeklyTimeline({ events, from, to, palette, slices, demandDays, workshops, aircraftTypes, scale, departments, exporting, onExport }: {
  events: PersonnelEvent[];
  from: string;
  to: string;
  palette: Map<string, string>;
  slices: Array<{ workshopId: string; aircraftTypeId: string; planned: number; available: number; difference: number }>;
  demandDays: DayCalculation[];
  workshops: Array<{ id: string; code: string; name: string }>;
  aircraftTypes: Array<{ id: string; name: string; icaoType?: string | null }>;
  scale: "week" | "month";
  departments: Department[];
  exporting: boolean;
  onExport: () => void;
}) {
  const dates = periodDates(from, to);
  const bands = visibleBands(departments);
  const slotColumns = Math.max(1, ...bands.map((band) => band.length));
  const rows = events.map((event) => {
    const place = planPlace(event, from, to);
    return {
      event,
      hangar: place.hangar,
      hangarLabel: place.hangarLabel,
      workshop: event.workshop?.code || event.workshop?.name || "—",
      operator: event.operator?.code || event.operator?.name || "—",
      aircraftType: event.aircraftType?.icaoType || event.aircraftType?.name || "—",
      stand: place.stand,
      status: event.statusLabel || event.status || "—"
    };
  }).sort((a, b) => {
    const hangarKey = (label: string) => (label === "Без ангара" ? "\uffff" : label);
    const hangar = hangarKey(a.hangarLabel).localeCompare(hangarKey(b.hangarLabel), "ru", { numeric: true });
    if (hangar) return hangar;
    return a.workshop.localeCompare(b.workshop, "ru", { numeric: true })
      || a.operator.localeCompare(b.operator, "ru", { numeric: true })
      || a.aircraftType.localeCompare(b.aircraftType, "ru", { numeric: true })
      || (a.event.aircraftLabel || "").localeCompare(b.event.aircraftLabel || "", "ru", { numeric: true })
      || a.event.title.localeCompare(b.event.title, "ru");
  });
  const groups: Array<{ hangarLabel: string; rows: typeof rows }> = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (!last || last.hangarLabel !== row.hangarLabel) groups.push({ hangarLabel: row.hangarLabel, rows: [row] });
    else last.rows.push(row);
  }
  const calculationByDate = new Map(demandDays.map((day) => [day.date.slice(0, 10), day]));
  const dayTotals = dates.map((date) => {
    const day = calculationByDate.get(date);
    return {
      date,
      demand: recordLevels(day?.demand),
      supply: recordLevels(day?.authorizedSupply),
      difference: recordLevels(day?.strictBalance)
    };
  });
  const rangeStart = new Date(`${from}T00:00:00+03:00`).getTime();
  const rangeEnd = new Date(`${to}T00:00:00+03:00`).getTime() + 86_400_000;
  const dayCount = Math.max(dates.length, 1);
  const month = scale === "month";
  const workshopName = new Map(workshops.map((row) => [row.id, row.code || row.name]));
  const typeName = new Map(aircraftTypes.map((row) => [row.id, row.icaoType || row.name]));
  const summaryRows = [...slices].sort((a, b) => (workshopName.get(a.workshopId) || a.workshopId).localeCompare(workshopName.get(b.workshopId) || b.workshopId, "ru", { numeric: true }) || (typeName.get(a.aircraftTypeId) || a.aircraftTypeId).localeCompare(typeName.get(b.aircraftTypeId) || b.aircraftTypeId, "ru", { numeric: true }));
  const summaryTotal = summaryRows.reduce((sum, row) => ({ planned: sum.planned + row.planned, available: sum.available + row.available, difference: sum.difference + row.difference }), { planned: 0, available: 0, difference: 0 });
  const quarterCount = dayCount * 4;
  return <section className="card personnelTimelineCard"><div className="personnelSectionHead personnelPlanHead"><div><h2 className="personnelResourceTitle">График/План<BlockHelp label="График/План"><p>События выбранного периода на шкале времени, с потребностью по категориям.</p><ul><li>Оранжевая полоса — ангар. Под ней строки бортов, которые стоят в этом ангаре. Событие без ангара собрано в группу «Без ангара».</li><li>Слева — борт, ангар, цех, заказчик, тип ВС, место и статус.</li><li>Цветная полоса — само событие. На ней название. Время начала и окончания стоит снаружи у краёв. Если событие кончается позже периода, на полосе остаётся till с датой окончания.</li><li>Красная заливка на полосе — период буксировки.</li><li>Под полосой — плановые человеко-часы события по категориям на каждый день. Категории только те, что заданы выбранным цехам. Фильтр типа ВС сужает и цеха, и события.</li><li>Шкала «Неделя» показывает часы 0, 6, 12 и 18. «Месяц» сжимает те же сутки. Стрелки периода листают окно.</li><li>Три нижние строки — итог по всем событиям: потребность, доступный ресурс и разница. Разница окрашена: зелёная, если ресурс больше потребности, красная — если меньше.</li><li>Кнопка с листом выгружает этот график в Excel.</li></ul></BlockHelp></h2></div><button type="button" className="btn ganttIconBtn" onClick={onExport} disabled={exporting} title="Выгрузить график в Excel" aria-label="Выгрузить график в Excel"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 2h7l4 4v12H5z" /><path d="M12 2v4h4" /><path d="M7 14l2-4" /><path d="M11 14l-2-4" /><path d="M12.5 14h2.5" /><path d="M12.5 10h2.5" /></svg></button></div>
    <div className="personnelTimelineScroll"><table className={month ? "personnelPlan personnelPlanMonth" : "personnelPlan"} style={{ width: "100%", minWidth: !month && dates.length > 7 ? `${(dates.length / 7) * 100}%` : undefined, ["--plan-slot-columns" as string]: slotColumns, ["--plan-days" as string]: dayCount, ["--plan-quarters" as string]: quarterCount }}>
      <thead>
        <tr>
          <th className="personnelPlanIdentity">Событие</th>
          <th className="personnelPlanBandsCol">Категории</th>
          <th className="personnelPlanScale">
            <div className="personnelPlanDays" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}>{dates.map((date) => <span key={date}>{fmtDayMonth(date)}</span>)}</div>
            <div className="personnelPlanHours" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}>{dates.map((date) => <div key={date} className="personnelPlanHourMarks"><span>0</span><span>6</span><span>12</span><span>18</span></div>)}</div>
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => <Fragment key={group.hangarLabel}>
          <tr className="personnelHangarBar">
            <th colSpan={3}><span className="personnelHangarBarLabel">{group.hangarLabel}</span></th>
          </tr>
          {group.rows.map((row) => {
            const event = row.event;
            const pos = periodTimelinePosition(event.startAt, event.endAt, from, to);
            const barStart = pos ? rangeStart + (pos.left / 100) * (rangeEnd - rangeStart) : 0;
            const barEnd = pos ? barStart + (pos.width / 100) * (rangeEnd - rangeStart) : 0;
            const tail = event.aircraftLabel || event.aircraft?.tailNumber || "—";
            const fill = barColor(event, palette);
            const startLabel = fmtClock(event.startAt);
            const till = pos?.endsAfter === true;
            const endLabel = till ? `till ${fmtTill(event.endAt)}` : fmtClock(event.endAt);
            return <tr key={event.id}>
              <td className="personnelPlanIdentity" title={event.title}>
                <b>{tail}</b>
                <span>{row.hangar} · {row.workshop}</span>
                <span>{row.operator} · {row.aircraftType}</span>
                <small>{row.stand} · {row.status}</small>
              </td>
              <td className="personnelPlanBandsCol">
                <div className="personnelPlanLane" />
                <BandLabels bands={bands} />
              </td>
              <td className="personnelPlanTrack">
                <div className="personnelPlanGridLines" />
                <div className="personnelPlanLane">
                  {pos ? <>
                    <span className="personnelPlanClock" style={{ left: `${pos.left}%` }}>{startLabel}</span>
                    <div className="personnelPlanBar" style={{ left: `${pos.left}%`, width: `${pos.width}%`, background: fill, color: contrastTextColor(fill) }} title={`${startLabel} ${event.title} ${endLabel}`.trim()}>
                      <span className="personnelPlanBarTitle">{event.title}</span>
                      {till ? <span className="personnelPlanBarTime">{endLabel}</span> : null}
                      {(event.towSegments ?? []).map((tow) => {
                        const towStart = new Date(tow.startAt).getTime();
                        const towEnd = new Date(tow.endAt).getTime();
                        const visibleStart = Math.max(towStart, barStart);
                        const visibleEnd = Math.min(towEnd, barEnd);
                        if (!(barEnd > barStart) || visibleEnd <= visibleStart) return null;
                        return <span key={tow.id} className="personnelPlanTow" style={{ left: `${((visibleStart - barStart) / (barEnd - barStart)) * 100}%`, width: `${((visibleEnd - visibleStart) / (barEnd - barStart)) * 100}%` }} title="Буксировка" />;
                      })}
                    </div>
                    {till ? null : <span className="personnelPlanClock personnelPlanClockEnd" style={{ left: `${pos.left + pos.width}%` }}>{endLabel}</span>}
                  </> : null}
                </div>
                <div className="personnelPlanLabor" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}>
                  {dates.map((date) => <div key={date} className="personnelPlanLaborDay"><HourBands bands={bands} levels={demandLevels(demandDays, event.id, date)} /></div>)}
                </div>
              </td>
            </tr>;
          })}
        </Fragment>)}
        {rows.length ? <>
          <tr className="personnelTotalRow">
            <td className="personnelPlanIdentity">Итого потребность</td>
            <td className="personnelPlanBandsCol"><BandLabels bands={bands} /></td>
            <td className="personnelPlanNumbers"><div className="personnelPlanGridLines" /><div className="personnelPlanLabor" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}>{dayTotals.map((day) => <div key={day.date} className="personnelPlanLaborDay"><HourBands bands={bands} levels={day.demand} /></div>)}</div></td>
          </tr>
          <tr className="personnelTotalRow">
            <td className="personnelPlanIdentity">Итого доступный ресурс</td>
            <td className="personnelPlanBandsCol"><BandLabels bands={bands} /></td>
            <td className="personnelPlanNumbers"><div className="personnelPlanGridLines" /><div className="personnelPlanLabor" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}>{dayTotals.map((day) => <div key={day.date} className="personnelPlanLaborDay"><HourBands bands={bands} levels={day.supply} /></div>)}</div></td>
          </tr>
          <tr className="personnelTotalRow">
            <td className="personnelPlanIdentity" title="Доступный ресурс − потребность">Итого разница</td>
            <td className="personnelPlanBandsCol"><BandLabels bands={bands} /></td>
            <td className="personnelPlanNumbers"><div className="personnelPlanGridLines" /><div className="personnelPlanLabor" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}>{dayTotals.map((day) => <div key={day.date} className="personnelPlanLaborDay"><HourBands bands={bands} levels={day.difference} balance /></div>)}</div></td>
          </tr>
        </> : <tr><td colSpan={3}>Нет событий за выбранный период.</td></tr>}
      </tbody>
    </table></div>
    <div className="personnelPlanSummary">
      <h3 className="personnelResourceTitle">Сводка за период<BlockHelp label="Сводка за период"><p>Плановая трудоёмкость и доступный ресурс за весь выбранный период, без разбивки по суткам.</p><ul><li>Строка — один цех и один тип ВС из фильтра.</li><li>Плановая трудоёмкость — сумма человеко-часов событий. Доступный ресурс — численность, пересчитанная в человеко-часы. Разница — ресурс минус план.</li><li>Зелёная разница — запас, красная — нехватка.</li><li>«Итого» складывает все строки. Это тот же разрез, что таблица «Ёмкость по цеху и типу ВС» на вкладке Capacity.</li></ul></BlockHelp></h3>
      <table className="personnelSimpleTable">
        <thead><tr><th>Цех</th><th>Тип ВС</th><th>Плановая трудоемкость</th><th>Доступный ресурс</th><th>Разница</th></tr></thead>
        <tbody>
          {summaryRows.length ? summaryRows.map((row) => <tr key={`${row.workshopId}|${row.aircraftTypeId}`}>
            <td>{workshopName.get(row.workshopId) || "—"}</td>
            <td>{typeName.get(row.aircraftTypeId) || "—"}</td>
            <td>{formatPersonnelNumber(row.planned)}</td>
            <td>{formatPersonnelNumber(row.available)}</td>
            <td className={`balance-${balanceClass(row.difference)}`}>{formatPersonnelNumber(row.difference)}</td>
          </tr>) : <tr><td colSpan={5}>Нет плановой трудоёмкости и доступного ресурса за период.</td></tr>}
          {summaryRows.length ? <tr className="personnelTotalRow"><td colSpan={2}>Итого</td><td>{formatPersonnelNumber(summaryTotal.planned)}</td><td>{formatPersonnelNumber(summaryTotal.available)}</td><td className={`balance-${balanceClass(summaryTotal.difference)}`}>{formatPersonnelNumber(summaryTotal.difference)}</td></tr> : null}
        </tbody>
      </table>
    </div>
  </section>;
}
