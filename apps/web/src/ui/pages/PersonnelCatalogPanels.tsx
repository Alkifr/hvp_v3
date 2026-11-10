import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiGet, apiPost, apiPut } from "../../lib/api";
import { dateKey, formatPersonnelNumber } from "../../lib/personnelPlanning";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { SingleSelectDropdown } from "../components/SingleSelectDropdown";
import { SwitchToggle } from "../components/SwitchToggle";
import { ClickRow, RecordCard } from "./FleetRefCards";

export const PERSONNEL_CATALOG_KINDS = ["personnel-hours", "personnel-factors", "personnel-composition", "personnel-categories", "aircraft-workshops"] as const;
export type PersonnelCatalogKind = (typeof PERSONNEL_CATALOG_KINDS)[number];

export function isPersonnelCatalogKind(kind: string): kind is PersonnelCatalogKind {
  return (PERSONNEL_CATALOG_KINDS as readonly string[]).includes(kind);
}

type Department = "ME" | "AV" | "INT" | "NDT" | "SHOP" | "CAB_REP" | "PAINT";
type Meta = {
  categories: Array<{ code: string; name: string; department: Department | null }>;
  workshops: Array<{ id: string; code: string; name: string }>;
  aircraftTypes: Array<{ id: string; name: string; icaoType?: string | null }>;
};
type Norm = { id: string; effectiveFrom: string; hours: number | string };
type Factor = { id: string; aircraftTypeId: string; effectiveFrom: string; factor: number | string; aircraftType?: { name: string; icaoType?: string | null } };

function aircraftTypeCode(row: { icaoType?: string | null; name?: string | null } | null | undefined) {
  return row?.icaoType || row?.name || "—";
}
type Assignment = {
  id: string;
  checkKind: "A" | "C";
  choice: "FIXED" | "PRIMARY" | "ALTERNATE";
  dependsOnCustomerPlan: boolean;
  note: string | null;
  aircraft: { id: string; tailNumber: string; typeId: string; typeName: string; operatorId: string; operatorName: string };
  workshop: { id: string; code: string; name: string };
  hangars: Array<{ id: string; code: string; name: string }>;
};
type RefRow = { id: string; code?: string; name?: string; tailNumber?: string; icaoType?: string | null };

const API = "/api/personnel-planning";
const CHOICE_LABEL = { FIXED: "Фиксировано", PRIMARY: "Основное", ALTERNATE: "По плану заказчика" } as const;

function errorText(error: unknown) {
  return String((error as Error)?.message ?? error);
}

export function PersonnelCatalogPanel({
  kind,
  search,
  canWrite,
  createActionRef
}: {
  kind: PersonnelCatalogKind;
  search: string;
  canWrite: boolean;
  createActionRef: MutableRefObject<(() => void) | null>;
}) {
  if (kind === "personnel-hours") return <HoursPanel canWrite={canWrite} search={search} createActionRef={createActionRef} />;
  if (kind === "personnel-factors") return <FactorsPanel canWrite={canWrite} search={search} createActionRef={createActionRef} />;
  if (kind === "personnel-composition") return <CompositionPanel canWrite={canWrite} search={search} createActionRef={createActionRef} />;
  if (kind === "personnel-categories") return <CategoriesPanel canWrite={canWrite} search={search} createActionRef={createActionRef} />;
  return <AircraftWorkshopPanel canWrite={canWrite} search={search} createActionRef={createActionRef} />;
}

function useBindCreate(ref: MutableRefObject<(() => void) | null>, open: () => void, enabled: boolean) {
  useEffect(() => {
    ref.current = enabled ? open : null;
    return () => {
      if (ref.current === open) ref.current = null;
    };
  });
}

function formatCatalogDate(value: string) {
  const [year, month, day] = dateKey(value).split("-");
  return day && month && year ? `${day}.${month}.${year}` : dateKey(value);
}

function HoursPanel({ canWrite, search, createActionRef }: { canWrite: boolean; search: string; createActionRef: MutableRefObject<(() => void) | null> }) {
  const qc = useQueryClient();
  const today = dateKey(new Date());
  const normsQ = useQuery({ queryKey: ["personnel", "norms"], queryFn: () => apiGet<{ items: Norm[] }>(`${API}/norms`) });
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [hours, setHours] = useState("11");
  const [initial, setInitial] = useState({ effectiveFrom: today, hours: "11" });
  const [attempted, setAttempted] = useState(false);
  const needle = search.trim().toLowerCase();
  const rows = (normsQ.data?.items ?? []).filter((row) => {
    if (!needle) return true;
    const text = `${formatCatalogDate(row.effectiveFrom)} ${dateKey(row.effectiveFrom)} ${row.hours}`.toLowerCase();
    return text.includes(needle);
  });
  const historical = mode === "edit" && effectiveFrom < today;
  const editable = canWrite && !historical;
  const hoursNumber = Number(hours.replace(",", "."));
  const hoursError = !Number.isFinite(hoursNumber) || hoursNumber <= 0 || hoursNumber > 24 ? "Укажите часы от 0,1 до 24" : "";
  const dateError = !effectiveFrom ? "Укажите дату" : editable && effectiveFrom < today ? "Прошлую дату выбрать нельзя" : "";
  const dirty = effectiveFrom !== initial.effectiveFrom || hours !== initial.hours;
  const openCreate = () => {
    setMode("create");
    setEditId("");
    setEffectiveFrom(today);
    setHours("11");
    setInitial({ effectiveFrom: today, hours: "11" });
    setAttempted(false);
  };
  const openEdit = (row: Norm) => {
    const nextDate = dateKey(row.effectiveFrom);
    const nextHours = String(Number(row.hours));
    setMode("edit");
    setEditId(row.id);
    setEffectiveFrom(nextDate);
    setHours(nextHours);
    setInitial({ effectiveFrom: nextDate, hours: nextHours });
    setAttempted(false);
  };
  useBindCreate(createActionRef, openCreate, canWrite);
  const refresh = async () => qc.invalidateQueries({ queryKey: ["personnel", "norms"] });
  const saveM = useMutation({
    mutationFn: () => mode === "create"
      ? apiPost(`${API}/norms`, { effectiveFrom, hours: hoursNumber })
      : apiPut(`${API}/norms/${editId}`, { effectiveFrom, hours: hoursNumber }),
    onSuccess: async () => { await refresh(); setMode(null); }
  });
  const deleteM = useMutation({
    mutationFn: () => apiDelete(`${API}/norms/${editId}`),
    onSuccess: async () => { await refresh(); setMode(null); }
  });
  return (
    <section>
      <table className="table refTable">
        <thead><tr><th>С даты</th><th>Часов</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <ClickRow key={row.id} editing={mode === "edit" && editId === row.id} onOpen={() => openEdit(row)}>
              <td>{formatCatalogDate(row.effectiveFrom)}</td>
              <td>{formatPersonnelNumber(Number(row.hours), 1)}</td>
            </ClickRow>
          ))}
        </tbody>
      </table>
      {!normsQ.isLoading && rows.length === 0 ? <div className="refEmpty"><div className="refEmptyTitle">{needle ? "Ничего не найдено" : "Записей пока нет"}</div></div> : null}
      {normsQ.error ? <div className="error">{errorText(normsQ.error)}</div> : null}
      {mode ? (
        <RecordCard
          titleId="hoursNormCardTitle"
          kicker="Справочники · Норма часов"
          title={mode === "create" ? "Новая норма" : formatCatalogDate(effectiveFrom)}
          subtitle={historical ? "Историческое значение" : "Часов на человека в смене"}
          active={!historical}
          canEdit={editable}
          saving={saveM.isPending}
          deleting={deleteM.isPending}
          dirty={dirty}
          error={saveM.error || deleteM.error ? errorText(saveM.error || deleteM.error) : attempted && (dateError || hoursError) ? dateError || hoursError : null}
          record={mode === "edit" ? { id: editId } : null}
          onClose={() => setMode(null)}
          onSave={() => { setAttempted(true); if (!dateError && !hoursError) saveM.mutate(); }}
          onDelete={editable && mode === "edit" ? () => { if (confirm("Удалить норму?")) deleteM.mutate(); } : undefined}
        >
          <label className="refLabel">
            <span>С даты</span>
            <input className="refInput" type="date" min={editable ? today : undefined} value={effectiveFrom} disabled={!editable} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </label>
          <label className="refLabel">
            <span>Часов</span>
            <input className="refInput" type="number" min="0.1" max="24" step="0.1" value={hours} disabled={!editable} onChange={(e) => setHours(e.target.value)} />
          </label>
        </RecordCard>
      ) : null}
    </section>
  );
}

function FactorsPanel({ canWrite, search, createActionRef }: { canWrite: boolean; search: string; createActionRef: MutableRefObject<(() => void) | null> }) {
  const qc = useQueryClient();
  const today = dateKey(new Date());
  const metaQ = useQuery({ queryKey: ["personnel", "meta"], queryFn: () => apiGet<Meta>(`${API}/meta`) });
  const factorsQ = useQuery({ queryKey: ["personnel", "factors"], queryFn: () => apiGet<{ fallback: number; items: Factor[] }>(`${API}/factors`) });
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState("");
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [factor, setFactor] = useState("1.4");
  const [initial, setInitial] = useState({ typeIds: [] as string[], effectiveFrom: today, factor: "1.4" });
  const [attempted, setAttempted] = useState(false);
  const needle = search.trim().toLowerCase();
  const rows = (factorsQ.data?.items ?? []).filter((row) => {
    if (!needle) return true;
    const text = `${aircraftTypeCode(row.aircraftType)} ${formatCatalogDate(row.effectiveFrom)} ${row.factor}`.toLowerCase();
    return text.includes(needle);
  });
  const typeOptions = (metaQ.data?.aircraftTypes ?? []).map((row) => ({ id: row.id, label: aircraftTypeCode(row) }));
  const historical = mode === "edit" && effectiveFrom < today;
  const editable = canWrite && !historical;
  const factorNumber = Number(factor.replace(",", "."));
  const factorError = !Number.isFinite(factorNumber) || factorNumber <= 0 || factorNumber > 100 ? "Укажите коэффициент больше 0" : "";
  const dateError = !effectiveFrom ? "Укажите дату" : editable && effectiveFrom < today ? "Прошлую дату выбрать нельзя" : "";
  const typeError = typeIds.length ? "" : "Выберите хотя бы один тип ВС";
  const dirty = effectiveFrom !== initial.effectiveFrom || factor !== initial.factor || typeIds.slice().sort().join() !== initial.typeIds.slice().sort().join();
  const openCreate = () => {
    setMode("create");
    setEditId("");
    setTypeIds([]);
    setEffectiveFrom(today);
    setFactor("1.4");
    setInitial({ typeIds: [], effectiveFrom: today, factor: "1.4" });
    setAttempted(false);
  };
  const openEdit = (row: Factor) => {
    const nextDate = dateKey(row.effectiveFrom);
    const nextFactor = String(Number(row.factor));
    const nextTypes = [row.aircraftTypeId];
    setMode("edit");
    setEditId(row.id);
    setTypeIds(nextTypes);
    setEffectiveFrom(nextDate);
    setFactor(nextFactor);
    setInitial({ typeIds: nextTypes, effectiveFrom: nextDate, factor: nextFactor });
    setAttempted(false);
  };
  useBindCreate(createActionRef, openCreate, canWrite);
  const refresh = async () => qc.invalidateQueries({ queryKey: ["personnel", "factors"] });
  const saveM = useMutation({
    mutationFn: () => apiPost(`${API}/factors`, {
      aircraftTypeIds: typeIds,
      effectiveFrom,
      factor: factorNumber,
      ...(mode === "edit" ? { replaceId: editId } : {})
    }),
    onSuccess: async () => { await refresh(); setMode(null); }
  });
  const deleteM = useMutation({
    mutationFn: () => apiDelete(`${API}/factors/${editId}`),
    onSuccess: async () => { await refresh(); setMode(null); }
  });
  return (
    <section>
      <table className="table refTable">
        <thead><tr><th>Тип ВС</th><th>С даты</th><th>Коэффициент</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <ClickRow key={row.id} editing={mode === "edit" && editId === row.id} onOpen={() => openEdit(row)}>
              <td><span className="refCodeChip">{aircraftTypeCode(row.aircraftType)}</span></td>
              <td>{formatCatalogDate(row.effectiveFrom)}</td>
              <td>{formatPersonnelNumber(Number(row.factor), 4)}</td>
            </ClickRow>
          ))}
        </tbody>
      </table>
      {!factorsQ.isLoading && rows.length === 0 ? <div className="refEmpty"><div className="refEmptyTitle">{needle ? "Ничего не найдено" : "Записей пока нет"}</div></div> : null}
      {factorsQ.error ? <div className="error">{errorText(factorsQ.error)}</div> : null}
      {mode ? (
        <RecordCard
          titleId="mpsFactorCardTitle"
          kicker="Справочники · Коэффициенты MPS"
          title={mode === "create" ? "Новый коэффициент" : aircraftTypeCode(rows.find((row) => row.id === editId)?.aircraftType ?? (factorsQ.data?.items ?? []).find((row) => row.id === editId)?.aircraftType)}
          subtitle={historical ? "Историческое значение" : "Один коэффициент на выбранные типы ВС"}
          active={!historical}
          canEdit={editable}
          saving={saveM.isPending}
          deleting={deleteM.isPending}
          dirty={dirty}
          error={saveM.error || deleteM.error ? errorText(saveM.error || deleteM.error) : attempted && (typeError || dateError || factorError) ? typeError || dateError || factorError : null}
          record={mode === "edit" ? { id: editId } : null}
          onClose={() => setMode(null)}
          onSave={() => { setAttempted(true); if (!typeError && !dateError && !factorError) saveM.mutate(); }}
          onDelete={editable && mode === "edit" ? () => { if (confirm("Удалить коэффициент?")) deleteM.mutate(); } : undefined}
        >
          <label className="refLabel">
            <span>Типы ВС</span>
            <MultiSelectDropdown
              options={typeOptions}
              value={typeIds}
              onChange={setTypeIds}
              placeholder="Выберите типы ВС"
              searchable
              searchPlaceholder="Код типа"
              selectedLabelMode="labels"
              portal
              disabled={!editable}
              width={420}
            />
          </label>
          <label className="refLabel">
            <span>С даты</span>
            <input className="refInput" type="date" min={editable ? today : undefined} value={effectiveFrom} disabled={!editable} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </label>
          <label className="refLabel">
            <span>Коэффициент</span>
            <input className="refInput" type="number" min="0.01" step="0.01" value={factor} disabled={!editable} onChange={(e) => setFactor(e.target.value)} />
          </label>
        </RecordCard>
      ) : null}
    </section>
  );
}

type CompositionItem = { code: string; name: string; department: string | null; sortOrder: number };
type CompositionResponse = { departments: string[]; items: CompositionItem[] };

function CompositionPanel({ canWrite, search, createActionRef }: { canWrite: boolean; search: string; createActionRef: MutableRefObject<(() => void) | null> }) {
  const qc = useQueryClient();
  const rowsQ = useQuery({
    queryKey: ["personnel", "category-composition"],
    queryFn: () => apiGet<CompositionResponse>(`${API}/category-composition`)
  });
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [department, setDepartment] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [initialCodes, setInitialCodes] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const items = rowsQ.data?.items ?? [];
  const departments = rowsQ.data?.departments ?? [];
  const needle = search.trim().toLowerCase();
  const grouped = departments
    .map((code) => ({
      department: code,
      qualifications: items.filter((row) => row.department === code).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    }))
    .filter((row) => row.qualifications.length > 0)
    .filter((row) => !needle || `${row.department} ${row.qualifications.map((item) => `${item.code} ${item.name}`).join(" ")}`.toLowerCase().includes(needle));
  const departmentChoices = departments;
  const qualificationOptions = items.map((row) => ({
    id: row.code,
    label: row.department && row.department !== department ? `${row.code} · ${row.department}` : row.code
  }));
  const openCreate = () => {
    setMode("create");
    setDepartment("");
    setCodes([]);
    setInitialCodes([]);
    setAttempted(false);
  };
  useBindCreate(createActionRef, openCreate, canWrite);
  const chooseDepartment = (code: string) => {
    const current = items.filter((row) => row.department === code).map((row) => row.code);
    setDepartment(code);
    setCodes(current);
    setInitialCodes(current);
  };
  const openEdit = (row: { department: string; qualifications: CompositionItem[] }) => {
    const next = row.qualifications.map((item) => item.code);
    setMode("edit");
    setDepartment(row.department);
    setCodes(next);
    setInitialCodes(next);
    setAttempted(false);
  };
  const close = () => setMode(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["personnel", "category-composition"] });
    await qc.invalidateQueries({ queryKey: ["personnel", "week"] });
    await qc.invalidateQueries({ queryKey: ["personnel", "availability"] });
  };
  const saveM = useMutation({
    mutationFn: () => apiPut(`${API}/category-composition`, { department, codes }),
    onSuccess: async () => { await refresh(); close(); }
  });
  const deleteM = useMutation({
    mutationFn: () => apiPut(`${API}/category-composition`, { department, codes: [] }),
    onSuccess: async () => { await refresh(); close(); }
  });
  const dirty = codes.slice().sort().join() !== initialCodes.slice().sort().join() || (mode === "create" && Boolean(department));
  return (
    <section>
      <table className="table refTable">
        <thead><tr><th>Категория</th><th>Квалификации</th></tr></thead>
        <tbody>
          {grouped.map((row) => (
            <ClickRow key={row.department} editing={mode === "edit" && department === row.department} onOpen={() => openEdit(row)}>
              <td><span className="refCodeChip">{row.department}</span></td>
              <td>{row.qualifications.map((item) => <span key={item.code} className="refCodeChip" style={{ marginRight: 6 }}>{item.code}</span>)}</td>
            </ClickRow>
          ))}
        </tbody>
      </table>
      {!rowsQ.isLoading && grouped.length === 0 ? <div className="refEmpty"><div className="refEmptyTitle">{needle ? "Ничего не найдено" : "Записей пока нет"}</div></div> : null}
      {rowsQ.error ? <div className="error">{errorText(rowsQ.error)}</div> : null}
      {mode ? (
        <RecordCard
          titleId="categoryCompositionTitle"
          kicker="Справочники · Состав категорий"
          title={mode === "create" ? "Новая категория" : department || "Состав категории"}
          subtitle="Квалификации, которые входят в категорию"
          active
          canEdit={canWrite}
          saving={saveM.isPending}
          deleting={deleteM.isPending}
          dirty={dirty}
          error={saveM.error || deleteM.error ? errorText(saveM.error || deleteM.error) : attempted && !department ? "Выберите категорию" : attempted && !codes.length ? "Выберите хотя бы одну квалификацию" : null}
          record={mode === "edit" ? { id: department } : null}
          onClose={close}
          onSave={() => { setAttempted(true); if (department && codes.length) saveM.mutate(); }}
          onDelete={mode === "edit" ? () => { if (confirm("Убрать квалификации из категории?")) deleteM.mutate(); } : undefined}
        >
          <label className="refLabel">
            <span>Категория</span>
            <select className="refInput" value={department} disabled={!canWrite || mode === "edit"} onChange={(e) => chooseDepartment(e.target.value)}>
              <option value="">Выберите категорию</option>
              {departmentChoices.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label className="refLabel">
            <span>Квалификации</span>
            <MultiSelectDropdown
              options={qualificationOptions}
              value={codes}
              onChange={setCodes}
              placeholder="Выберите квалификации"
              searchable
              searchPlaceholder="Код"
              selectedLabelMode="labels"
              portal
              disabled={!canWrite}
              width={420}
            />
          </label>
        </RecordCard>
      ) : null}
    </section>
  );
}

type WorkshopSkillRow = {
  workshopId: string;
  workshop: { id: string; code: string; name: string };
  skills: Array<{ id: string; code: string; name: string }>;
};
type SkillOption = { id: string; code: string; name: string; isActive?: boolean };

function CategoriesPanel({ canWrite, search, createActionRef }: { canWrite: boolean; search: string; createActionRef: MutableRefObject<(() => void) | null> }) {
  const qc = useQueryClient();
  const rowsQ = useQuery({ queryKey: ["ref", "workshop-skills"], queryFn: () => apiGet<WorkshopSkillRow[]>("/api/ref/workshop-skills") });
  const workshopsQ = useQuery({ queryKey: ["ref", "workshops"], queryFn: () => apiGet<RefRow[]>("/api/ref/workshops") });
  const skillsQ = useQuery({ queryKey: ["ref", "skills"], queryFn: () => apiGet<SkillOption[]>("/api/ref/skills") });
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [workshopId, setWorkshopId] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [initialSkillIds, setInitialSkillIds] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const needle = search.trim().toLowerCase();
  const rows = (rowsQ.data ?? []).filter((row) => {
    if (!needle) return true;
    const text = `${row.workshop.code} ${row.workshop.name} ${row.skills.map((skill) => `${skill.code} ${skill.name}`).join(" ")}`.toLowerCase();
    return text.includes(needle);
  });
  const skillOptions = (skillsQ.data ?? []).filter((skill) => skill.isActive !== false).map((skill) => ({ id: skill.id, label: skill.code }));
  const openCreate = () => {
    setMode("create");
    setWorkshopId("");
    setSkillIds([]);
    setInitialSkillIds([]);
    setAttempted(false);
  };
  useBindCreate(createActionRef, openCreate, canWrite);
  const openEdit = (row: WorkshopSkillRow) => {
    const ids = row.skills.map((skill) => skill.id);
    setMode("edit");
    setWorkshopId(row.workshopId);
    setSkillIds(ids);
    setInitialSkillIds(ids);
    setAttempted(false);
  };
  const close = () => setMode(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["ref", "workshop-skills"] });
    await qc.invalidateQueries({ queryKey: ["personnel", "week"] });
  };
  const saveM = useMutation({
    mutationFn: () => apiPut(`/api/ref/workshop-skills/${workshopId}`, { skillIds }),
    onSuccess: async () => { await refresh(); close(); }
  });
  const deleteM = useMutation({
    mutationFn: () => apiDelete(`/api/ref/workshop-skills/${workshopId}`),
    onSuccess: async () => { await refresh(); close(); }
  });
  const dirty = skillIds.slice().sort().join() !== initialSkillIds.slice().sort().join() || (mode === "create" && Boolean(workshopId));
  const taken = new Set((rowsQ.data ?? []).map((row) => row.workshopId));
  const workshopChoices = (workshopsQ.data ?? []).filter((row) => mode === "edit" || !taken.has(row.id));
  return (
    <section>
      <table className="table refTable">
        <thead><tr><th>Цех</th><th>Категории</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <ClickRow key={row.workshopId} editing={mode === "edit" && workshopId === row.workshopId} onOpen={() => openEdit(row)}>
              <td><span className="refCodeChip">{row.workshop.code}</span></td>
              <td>{row.skills.map((skill) => <span key={skill.id} className="refCodeChip" style={{ marginRight: 6 }}>{skill.code}</span>)}</td>
            </ClickRow>
          ))}
        </tbody>
      </table>
      {!rowsQ.isLoading && rows.length === 0 ? <div className="refEmpty"><div className="refEmptyTitle">{needle ? "Ничего не найдено" : "Записей пока нет"}</div></div> : null}
      {rowsQ.error ? <div className="error">{errorText(rowsQ.error)}</div> : null}
      {mode ? (
        <RecordCard
          titleId="workshopSkillCardTitle"
          kicker="Справочники · Категории цеха"
          title={mode === "create" ? "Новая связка" : workshopChoices.find((row) => row.id === workshopId)?.code || "Категории цеха"}
          subtitle="Код цеха и категории"
          active
          canEdit={canWrite}
          saving={saveM.isPending}
          deleting={deleteM.isPending}
          dirty={dirty}
          error={saveM.error || deleteM.error ? errorText(saveM.error || deleteM.error) : attempted && !workshopId ? "Выберите цех" : attempted && !skillIds.length ? "Выберите хотя бы одну категорию" : null}
          record={mode === "edit" ? { id: workshopId } : null}
          onClose={close}
          onSave={() => { setAttempted(true); if (workshopId && skillIds.length) saveM.mutate(); }}
          onDelete={mode === "edit" ? () => { if (confirm("Удалить связку цеха с категориями?")) deleteM.mutate(); } : undefined}
        >
          <label className="refLabel">
            <span>Цех</span>
            <select className="refInput" value={workshopId} disabled={!canWrite || mode === "edit"} onChange={(e) => setWorkshopId(e.target.value)}>
              <option value="">Выберите цех</option>
              {workshopChoices.map((row) => <option key={row.id} value={row.id}>{row.code}</option>)}
            </select>
          </label>
          <label className="refLabel">
            <span>Категории</span>
            <MultiSelectDropdown
              options={skillOptions}
              value={skillIds}
              onChange={setSkillIds}
              placeholder="Выберите категории"
              searchable
              searchPlaceholder="Код или название"
              selectedLabelMode="labels"
              portal
              disabled={!canWrite}
              width={420}
            />
          </label>
        </RecordCard>
      ) : null}
    </section>
  );
}

function isPlanningHangar(row: { code?: string | null; name?: string | null }) {
  return /^H[1-5]$/.test(row.code ?? "") || /^Ангар [1-5]$/.test(row.name ?? "");
}

function hangarLabel(row: { code?: string | null; name?: string | null }) {
  return row.name || row.code || "—";
}

function sameIds(left: string[], right: string[]) {
  return left.slice().sort().join() === right.slice().sort().join();
}

type FleetAircraft = {
  id: string;
  tailNumber?: string | null;
  type?: { id?: string; name?: string | null; icaoType?: string | null } | null;
  operator?: { id?: string; name?: string | null } | null;
};

type AssignmentGroup = {
  key: string;
  typeId: string;
  typeName: string;
  operatorId: string;
  operatorName: string;
  checkKind: "A" | "C";
  workshop: Assignment["workshop"];
  hangars: Assignment["hangars"];
  choice: Assignment["choice"];
  dependsOnCustomerPlan: boolean;
  items: Assignment[];
};

function assignmentGroupKey(row: Assignment) {
  const hangars = row.hangars.map((hangar) => hangar.id).slice().sort().join(",");
  return [row.aircraft.typeId, row.aircraft.operatorId, row.checkKind, row.workshop.id, hangars, row.choice, row.dependsOnCustomerPlan ? "1" : "0"].join("|");
}

function groupAssignments(rows: Assignment[]) {
  const groups = new Map<string, AssignmentGroup>();
  for (const row of rows) {
    const key = assignmentGroupKey(row);
    const group = groups.get(key);
    if (group) group.items.push(row);
    else groups.set(key, {
      key,
      typeId: row.aircraft.typeId,
      typeName: row.aircraft.typeName,
      operatorId: row.aircraft.operatorId,
      operatorName: row.aircraft.operatorName,
      checkKind: row.checkKind,
      workshop: row.workshop,
      hangars: [...row.hangars].sort((a, b) => hangarLabel(a).localeCompare(hangarLabel(b), "ru")),
      choice: row.choice,
      dependsOnCustomerPlan: row.dependsOnCustomerPlan,
      items: [row]
    });
  }
  return [...groups.values()].sort((a, b) =>
    a.typeName.localeCompare(b.typeName, "ru")
    || a.operatorName.localeCompare(b.operatorName, "ru")
    || a.checkKind.localeCompare(b.checkKind)
    || a.workshop.code.localeCompare(b.workshop.code, "ru")
  );
}

function aircraftCountLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "борт" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "борта" : "бортов";
  return `${count} ${word}`;
}

function AircraftWorkshopPanel({ canWrite, search, createActionRef }: { canWrite: boolean; search: string; createActionRef: MutableRefObject<(() => void) | null> }) {
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: ["ref", "aircraft-workshops"], queryFn: () => apiGet<Assignment[]>("/api/ref/aircraft-workshops") });
  const workshopsQ = useQuery({ queryKey: ["ref", "workshops"], queryFn: () => apiGet<RefRow[]>("/api/ref/workshops") });
  const hangarsQ = useQuery({ queryKey: ["ref", "hangars"], queryFn: () => apiGet<RefRow[]>("/api/ref/hangars") });
  const aircraftQ = useQuery({ queryKey: ["ref", "aircraft"], queryFn: () => apiGet<FleetAircraft[]>("/api/ref/aircraft"), enabled: canWrite });
  const emptyForm = { typeId: "", operatorId: "", aircraftIds: [] as string[], checkKind: "C" as "A" | "C", workshopId: "", hangarIds: [] as string[], choice: "FIXED" as Assignment["choice"], dependsOnCustomerPlan: false };
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [groupKey, setGroupKey] = useState("");
  const [typeId, setTypeId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [aircraftIds, setAircraftIds] = useState<string[]>([]);
  const [checkKind, setCheckKind] = useState<"A" | "C">("C");
  const [workshopId, setWorkshopId] = useState("");
  const [hangarIds, setHangarIds] = useState<string[]>([]);
  const [choice, setChoice] = useState<Assignment["choice"]>("FIXED");
  const [dependsOnCustomerPlan, setDependsOnCustomerPlan] = useState(false);
  const [initial, setInitial] = useState(emptyForm);
  const [attempted, setAttempted] = useState(false);
  const needle = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const all = groupAssignments(listQ.data ?? []);
    if (!needle) return all;
    return all.filter((group) => {
      const text = `${group.typeName} ${group.operatorName} ${group.checkKind === "C" ? "C-check" : "A-check"} ${group.workshop.code} ${group.hangars.map((hangar) => `${hangar.code} ${hangar.name}`).join(" ")} ${CHOICE_LABEL[group.choice]} ${group.items.map((item) => item.aircraft.tailNumber).join(" ")}`.toLowerCase();
      return text.includes(needle);
    });
  }, [listQ.data, needle]);
  const editing = useMemo(() => groupAssignments(listQ.data ?? []).find((group) => group.key === groupKey), [listQ.data, groupKey]);
  const typeOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of aircraftQ.data ?? []) {
      if (row.type?.id) options.set(row.type.id, row.type.name || row.type.icaoType || "—");
    }
    if (editing && !options.has(editing.typeId)) options.set(editing.typeId, editing.typeName);
    return [...options.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [aircraftQ.data, editing]);
  const operatorOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of aircraftQ.data ?? []) {
      if (typeId && row.type?.id !== typeId) continue;
      if (row.operator?.id) options.set(row.operator.id, row.operator.name || "—");
    }
    if (editing && operatorId === editing.operatorId && !options.has(editing.operatorId)) options.set(editing.operatorId, editing.operatorName);
    return [...options.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [aircraftQ.data, typeId, operatorId, editing]);
  const tailOptions = useMemo(() => {
    const options = new Map<string, { id: string; label: string; description?: string }>();
    for (const row of aircraftQ.data ?? []) {
      if (typeId && row.type?.id !== typeId) continue;
      if (operatorId && row.operator?.id !== operatorId) continue;
      options.set(row.id, { id: row.id, label: row.tailNumber || "—", description: [row.type?.name || row.type?.icaoType, row.operator?.name].filter(Boolean).join(" · ") });
    }
    for (const item of editing?.items ?? []) {
      if (!options.has(item.aircraft.id) && (!typeId || item.aircraft.typeId === typeId) && (!operatorId || item.aircraft.operatorId === operatorId)) {
        options.set(item.aircraft.id, { id: item.aircraft.id, label: item.aircraft.tailNumber, description: [item.aircraft.typeName, item.aircraft.operatorName].filter(Boolean).join(" · ") });
      }
    }
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [aircraftQ.data, typeId, operatorId, editing]);
  const hangarOptions = useMemo(() => {
    const selected = new Set(hangarIds);
    return (hangarsQ.data ?? [])
      .filter((hangar) => isPlanningHangar(hangar) || selected.has(hangar.id))
      .map((hangar) => ({ id: hangar.id, label: hangarLabel(hangar) }));
  }, [hangarsQ.data, hangarIds]);
  const applyForm = (next: typeof emptyForm) => {
    setTypeId(next.typeId);
    setOperatorId(next.operatorId);
    setAircraftIds(next.aircraftIds);
    setCheckKind(next.checkKind);
    setWorkshopId(next.workshopId);
    setHangarIds(next.hangarIds);
    setChoice(next.choice);
    setDependsOnCustomerPlan(next.dependsOnCustomerPlan);
    setInitial(next);
    setAttempted(false);
  };
  const openCreate = () => {
    setMode("create");
    setGroupKey("");
    applyForm(emptyForm);
  };
  useBindCreate(createActionRef, openCreate, canWrite);
  const openEdit = (group: AssignmentGroup) => {
    setMode("edit");
    setGroupKey(group.key);
    applyForm({
      typeId: group.typeId,
      operatorId: group.operatorId,
      aircraftIds: group.items.map((item) => item.aircraft.id),
      checkKind: group.checkKind,
      workshopId: group.workshop.id,
      hangarIds: group.hangars.map((hangar) => hangar.id),
      choice: group.choice,
      dependsOnCustomerPlan: group.dependsOnCustomerPlan
    });
  };
  const chooseType = (nextTypeId: string) => {
    const operators = new Map<string, string>();
    for (const row of aircraftQ.data ?? []) {
      if (row.type?.id === nextTypeId && row.operator?.id) operators.set(row.operator.id, row.operator.name || "—");
    }
    setTypeId(nextTypeId);
    setOperatorId(operators.size === 1 ? [...operators.keys()][0] : "");
    setAircraftIds([]);
  };
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["ref", "aircraft-workshops"] });
  };
  const saveM = useMutation({
    mutationFn: () => apiPost("/api/ref/aircraft-workshops/group", {
      aircraftIds,
      checkKind,
      workshopId,
      hangarIds,
      choice,
      dependsOnCustomerPlan,
      ...(mode === "edit" ? { replace: { aircraftIds: initial.aircraftIds, checkKind: initial.checkKind, workshopId: initial.workshopId } } : {})
    }),
    onSuccess: async () => { await refresh(); setMode(null); }
  });
  const deleteM = useMutation({
    mutationFn: () => apiPost("/api/ref/aircraft-workshops/group/delete", {
      aircraftIds: initial.aircraftIds,
      checkKind: initial.checkKind,
      workshopId: initial.workshopId
    }),
    onSuccess: async () => { await refresh(); setMode(null); }
  });
  const dirty = typeId !== initial.typeId || operatorId !== initial.operatorId || checkKind !== initial.checkKind || workshopId !== initial.workshopId || choice !== initial.choice || dependsOnCustomerPlan !== initial.dependsOnCustomerPlan || !sameIds(aircraftIds, initial.aircraftIds) || !sameIds(hangarIds, initial.hangarIds);
  const formError = !attempted ? "" : !typeId ? "Выберите тип" : !operatorId ? "Выберите оператора" : !aircraftIds.length ? "Выберите хотя бы один борт" : !workshopId ? "Выберите цех" : "";
  const title = mode === "create" ? "Новая привязка" : typeOptions.find((option) => option.id === typeId)?.label || editing?.typeName || "Борт и цех";
  return (
    <section>
      <table className="table refTable">
        <thead><tr><th>Тип</th><th>Оператор</th><th>Форма</th><th>Цех</th><th>Ангар</th><th>Назначение</th><th>Борта</th></tr></thead>
        <tbody>
          {groups.map((group) => (
            <ClickRow key={group.key} editing={mode === "edit" && groupKey === group.key} onOpen={() => openEdit(group)}>
              <td><span className="refCodeChip">{group.typeName}</span></td>
              <td>{group.operatorName}</td>
              <td>{group.checkKind === "C" ? "C-check" : "A-check"}</td>
              <td><span className="refCodeChip">{group.workshop.code}</span></td>
              <td>{group.hangars.length ? group.hangars.map((hangar) => <span key={hangar.id} className="refCodeChip" style={{ marginRight: 6 }}>{hangarLabel(hangar)}</span>) : "—"}</td>
              <td>{CHOICE_LABEL[group.choice]}{group.dependsOnCustomerPlan && group.choice !== "ALTERNATE" ? " · план заказчика" : ""}</td>
              <td title={group.items.map((item) => item.aircraft.tailNumber).sort((a, b) => a.localeCompare(b, "ru")).join(", ")}>{aircraftCountLabel(group.items.length)}</td>
            </ClickRow>
          ))}
        </tbody>
      </table>
      {!listQ.isLoading && groups.length === 0 ? <div className="refEmpty"><div className="refEmptyTitle">{needle ? "Ничего не найдено" : "Записей пока нет"}</div></div> : null}
      {listQ.error ? <div className="error">{errorText(listQ.error)}</div> : null}
      {mode ? (
        <RecordCard
          titleId="aircraftWorkshopCardTitle"
          kicker="Справочники · Борт и цех"
          title={title}
          subtitle={checkKind === "C" ? "C-check" : "A-check"}
          active
          wide
          canEdit={canWrite}
          saving={saveM.isPending}
          deleting={deleteM.isPending}
          dirty={dirty}
          error={saveM.error || deleteM.error ? errorText(saveM.error || deleteM.error) : formError || null}
          record={mode === "edit" ? { id: groupKey } : null}
          onClose={() => setMode(null)}
          onSave={() => { setAttempted(true); if (typeId && operatorId && aircraftIds.length && workshopId) saveM.mutate(); }}
          onDelete={canWrite && mode === "edit" ? () => { if (confirm(`Удалить привязку для ${aircraftCountLabel(initial.aircraftIds.length)}?`)) deleteM.mutate(); } : undefined}
        >
          <label className="refLabel">
            <span>Тип</span>
            <SingleSelectDropdown
              options={typeOptions}
              value={typeId}
              onChange={chooseType}
              placeholder="Выберите тип"
              searchable
              searchPlaceholder="Тип ВС"
              disabled={!canWrite || mode === "edit"}
              width="100%"
            />
          </label>
          <label className="refLabel">
            <span>Оператор</span>
            <select className="refInput" value={operatorId} disabled={!canWrite || mode === "edit" || !typeId} onChange={(e) => { setOperatorId(e.target.value); setAircraftIds([]); }}>
              <option value="">Выберите оператора</option>
              {operatorOptions.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
            </select>
          </label>
          <label className="refLabel">
            <span>Борта</span>
            <MultiSelectDropdown
              options={tailOptions}
              value={aircraftIds}
              onChange={setAircraftIds}
              placeholder={typeId && operatorId ? "Выберите борта" : "Сначала выберите тип и оператора"}
              searchable
              searchPlaceholder="Бортовой номер"
              portal
              disabled={!canWrite || !typeId || !operatorId}
              width={420}
            />
          </label>
          <label className="refLabel">
            <span>Форма</span>
            <select className="refInput" value={checkKind} disabled={!canWrite} onChange={(e) => setCheckKind(e.target.value as "A" | "C")}>
              <option value="A">A-check</option>
              <option value="C">C-check</option>
            </select>
          </label>
          <label className="refLabel">
            <span>Цех</span>
            <select className="refInput" value={workshopId} disabled={!canWrite} onChange={(e) => setWorkshopId(e.target.value)}>
              <option value="">Выберите цех</option>
              {(workshopsQ.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.code || row.name}</option>)}
            </select>
          </label>
          <label className="refLabel">
            <span>Ангары</span>
            <MultiSelectDropdown
              options={hangarOptions}
              value={hangarIds}
              onChange={setHangarIds}
              placeholder="Выберите ангары"
              searchable
              searchPlaceholder="Ангар"
              selectedLabelMode="labels"
              portal
              disabled={!canWrite}
              width={420}
            />
          </label>
          <label className="refLabel">
            <span>Назначение</span>
            <select className="refInput" value={choice} disabled={!canWrite} onChange={(e) => {
              const next = e.target.value as Assignment["choice"];
              setChoice(next);
              if (next === "ALTERNATE") setDependsOnCustomerPlan(true);
            }}>
              <option value="FIXED">Фиксировано</option>
              <option value="PRIMARY">Основное</option>
              <option value="ALTERNATE">По плану заказчика</option>
            </select>
          </label>
          <SwitchToggle checked={dependsOnCustomerPlan} onChange={setDependsOnCustomerPlan} label="По плану заказчика" disabled={!canWrite} />
        </RecordCard>
      ) : null}
    </section>
  );
}
