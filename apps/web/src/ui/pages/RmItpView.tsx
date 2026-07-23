import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import { isValidDateInput } from "../../lib/dateInput";
import { SwitchToggle } from "../components/SwitchToggle";
import { useActiveSandbox } from "../components/SandboxSwitcher";

const ITP_SELECTED_EVENT_KEY = "hangarPlanning:itpSelectedEventId";

const PLAN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  IN_REVIEW: "На проверке",
  READY: "Готово к выполнению",
  IN_PROGRESS: "В работе",
  BLOCKED: "Есть блокеры",
  DONE: "Закрыто",
  CANCELLED: "Отменено"
};

const NEED_CATEGORY_LABEL: Record<string, string> = {
  PERSONNEL: "Персонал",
  MATERIAL: "Материалы",
  TOOL: "Инструмент",
  DOCUMENTATION: "Документация",
  EQUIPMENT: "Оснастка",
  CONTRACTOR: "Подрядчик",
  OTHER: "Прочее"
};

const NEED_STATUS_LABEL: Record<string, string> = {
  NEEDED: "Нужно",
  REQUESTED: "Запрошено",
  IN_PROGRESS: "В работе",
  READY: "Готово",
  BLOCKED: "Блокер",
  CANCELLED: "Отменено"
};

const STEP_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Не начат",
  READY: "Готов к старту",
  IN_PROGRESS: "В работе",
  BLOCKED: "Заблокирован",
  DONE: "Завершен",
  SKIPPED: "Пропущен"
};

const DEFAULT_NETWORK_GROUP = "Без зоны / системы";

type TechnicalNeed = {
  id: string;
  category: string;
  description: string;
  quantity?: string | null;
  requiredAt?: string | null;
  responsible?: string | null;
  status: string;
  isBlocker: boolean;
  notes?: string | null;
};

type TechnicalStepDependency = {
  predecessorStepId: string;
  successorStepId: string;
};

type TechnicalStep = {
  id: string;
  seq: number;
  title: string;
  description?: string | null;
  responsible?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  status: string;
  progressPct: number;
  isBlocker: boolean;
  notes?: string | null;
  predecessors?: TechnicalStepDependency[];
};

type TechnicalPlan = {
  id: string;
  eventId: string;
  status: string;
  leadEngineer?: string | null;
  readinessPct: number;
  notes?: string | null;
  needs: TechnicalNeed[];
  steps: TechnicalStep[];
  event: ItpEvent;
};

type ItpEvent = {
  id: string;
  title: string;
  status: string;
  startAt: string;
  endAt: string;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  aircraft?: { tailNumber: string; operator?: { name: string }; type?: { name: string; icaoType?: string | null } } | null;
  eventType?: { name: string } | null;
  hangar?: { name: string } | null;
  layout?: { name: string } | null;
  technicalPlan?: {
    id: string;
    status: string;
    readinessPct: number;
    leadEngineer?: string | null;
    needs: TechnicalNeed[];
    steps: TechnicalStep[];
  } | null;
};

function isoFromLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.valueOf()) ? d.toISOString() : null;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = dayjs(value);
  return d.isValid() ? d.format("DD.MM.YYYY HH:mm") : "—";
}

function eventLabel(ev?: ItpEvent | null) {
  if (!ev) return "—";
  const tail = ev.aircraft?.tailNumber ?? "Вирт. борт";
  return `${tail} • ${ev.title}`;
}

function statusClass(status: string) {
  if (status === "BLOCKED") return "itpBadge itpBadgeBad";
  if (status === "DONE" || status === "READY") return "itpBadge itpBadgeGood";
  if (status === "IN_PROGRESS" || status === "IN_REVIEW" || status === "REQUESTED") return "itpBadge itpBadgeWarn";
  return "itpBadge";
}

function planStats(plan?: TechnicalPlan | null) {
  const needs = plan?.needs ?? [];
  const steps = plan?.steps ?? [];
  return {
    blockers: needs.filter((n) => n.isBlocker || n.status === "BLOCKED").length + steps.filter((s) => s.isBlocker || s.status === "BLOCKED").length,
    needsReady: needs.filter((n) => n.status === "READY").length,
    needsTotal: needs.length,
    stepsDone: steps.filter((s) => s.status === "DONE").length,
    stepsTotal: steps.length
  };
}

function stepGroup(step: TechnicalStep) {
  return (step.description ?? "").trim() || DEFAULT_NETWORK_GROUP;
}

export function RmItpView() {
  const qc = useQueryClient();
  const { active: activeSandbox } = useActiveSandbox();
  const [rangeFromInput, setRangeFromInput] = useState(() => dayjs().add(-14, "day").format("YYYY-MM-DD"));
  const [rangeToInput, setRangeToInput] = useState(() => dayjs().add(45, "day").format("YYYY-MM-DD"));
  const rangeFromRef = useRef(rangeFromInput);
  const rangeToRef = useRef(rangeToInput);
  if (isValidDateInput(rangeFromInput)) rangeFromRef.current = rangeFromInput;
  if (isValidDateInput(rangeToInput)) rangeToRef.current = rangeToInput;
  const rangeFrom = isValidDateInput(rangeFromInput) ? rangeFromInput : rangeFromRef.current;
  const rangeTo = isValidDateInput(rangeToInput) ? rangeToInput : rangeToRef.current;
  const [search, setSearch] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string>(() => localStorage.getItem(ITP_SELECTED_EVENT_KEY) ?? "");
  const [planDraft, setPlanDraft] = useState({ status: "DRAFT", leadEngineer: "", readinessPct: 0, notes: "" });
  const [needDraft, setNeedDraft] = useState({
    category: "MATERIAL",
    description: "",
    quantity: "",
    requiredAtLocal: "",
    responsible: "",
    status: "NEEDED",
    isBlocker: false,
    notes: ""
  });
  const [stepDraft, setStepDraft] = useState({
    seq: 0,
    title: "",
    description: "",
    responsible: "",
    plannedStartLocal: "",
    plannedEndLocal: "",
    status: "NOT_STARTED",
    progressPct: 0,
    predecessorStepIds: [] as string[],
    isBlocker: false,
    notes: ""
  });

  const eventsQ = useQuery({
    queryKey: ["itp-events", rangeFrom, rangeTo, search],
    enabled: isValidDateInput(rangeFrom) && isValidDateInput(rangeTo),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("from", dayjs(rangeFrom).startOf("day").toISOString());
      params.set("to", dayjs(rangeTo).add(1, "day").startOf("day").toISOString());
      if (search.trim()) params.set("q", search.trim());
      return apiGet<ItpEvent[]>(`/api/technical-plans/events?${params.toString()}`);
    },
    placeholderData: (prev) => prev ?? []
  });

  const events = eventsQ.data ?? [];
  const selectedEvent = events.find((ev) => ev.id === selectedEventId) ?? events[0] ?? null;

  useEffect(() => {
    if (!selectedEventId && events[0]) setSelectedEventId(events[0].id);
  }, [events, selectedEventId]);

  useEffect(() => {
    if (selectedEventId) localStorage.setItem(ITP_SELECTED_EVENT_KEY, selectedEventId);
  }, [selectedEventId]);

  const planQ = useQuery({
    queryKey: ["itp-plan", selectedEvent?.id],
    enabled: Boolean(selectedEvent?.id),
    queryFn: () => apiGet<TechnicalPlan | null>(`/api/technical-plans/events/${selectedEvent!.id}/plan`)
  });

  const plan = planQ.data ?? null;
  const stats = planStats(plan);

  useEffect(() => {
    if (!plan) {
      setPlanDraft({ status: "DRAFT", leadEngineer: "", readinessPct: 0, notes: "" });
      return;
    }
    setPlanDraft({
      status: plan.status,
      leadEngineer: plan.leadEngineer ?? "",
      readinessPct: plan.readinessPct ?? 0,
      notes: plan.notes ?? ""
    });
  }, [plan]);

  const ensurePlanM = useMutation({
    mutationFn: () =>
      apiPost<TechnicalPlan>(`/api/technical-plans/events/${selectedEvent!.id}/plan`, {
        status: planDraft.status,
        leadEngineer: planDraft.leadEngineer || null,
        readinessPct: Number(planDraft.readinessPct) || 0,
        notes: planDraft.notes || null
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["itp-plan", selectedEvent?.id] });
      await qc.invalidateQueries({ queryKey: ["itp-events"] });
    }
  });

  const savePlanM = useMutation({
    mutationFn: () =>
      apiPatch<TechnicalPlan>(`/api/technical-plans/${plan!.id}`, {
        status: planDraft.status,
        leadEngineer: planDraft.leadEngineer || null,
        readinessPct: Number(planDraft.readinessPct) || 0,
        notes: planDraft.notes || null
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["itp-plan", selectedEvent?.id] });
      await qc.invalidateQueries({ queryKey: ["itp-events"] });
    }
  });

  const addNeedM = useMutation({
    mutationFn: () =>
      apiPost<TechnicalNeed>(`/api/technical-plans/${plan!.id}/needs`, {
        category: needDraft.category,
        description: needDraft.description,
        quantity: needDraft.quantity || null,
        requiredAt: isoFromLocal(needDraft.requiredAtLocal),
        responsible: needDraft.responsible || null,
        status: needDraft.status,
        isBlocker: needDraft.isBlocker,
        notes: needDraft.notes || null
      }),
    onSuccess: async () => {
      setNeedDraft({ category: "MATERIAL", description: "", quantity: "", requiredAtLocal: "", responsible: "", status: "NEEDED", isBlocker: false, notes: "" });
      await qc.invalidateQueries({ queryKey: ["itp-plan", selectedEvent?.id] });
      await qc.invalidateQueries({ queryKey: ["itp-events"] });
    }
  });

  const patchNeedM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TechnicalNeed> }) => apiPatch<TechnicalNeed>(`/api/technical-plans/needs/${id}`, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["itp-plan", selectedEvent?.id] });
      await qc.invalidateQueries({ queryKey: ["itp-events"] });
    }
  });

  const deleteNeedM = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/technical-plans/needs/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["itp-plan", selectedEvent?.id] });
      await qc.invalidateQueries({ queryKey: ["itp-events"] });
    }
  });

  const addStepM = useMutation({
    mutationFn: async () => {
      const step = await apiPost<TechnicalStep>(`/api/technical-plans/${plan!.id}/steps`, {
        seq: Number(stepDraft.seq) || 0,
        title: stepDraft.title,
        description: stepDraft.description || null,
        responsible: stepDraft.responsible || null,
        plannedStartAt: isoFromLocal(stepDraft.plannedStartLocal),
        plannedEndAt: isoFromLocal(stepDraft.plannedEndLocal),
        status: stepDraft.status,
        progressPct: Number(stepDraft.progressPct) || 0,
        isBlocker: stepDraft.isBlocker,
        notes: stepDraft.notes || null
      });
      if (stepDraft.predecessorStepIds.length > 0) {
        await apiPut(`/api/technical-plans/steps/${step.id}/dependencies`, { predecessorStepIds: stepDraft.predecessorStepIds });
      }
      return step;
    },
    onSuccess: async () => {
      setStepDraft({
        seq: (plan?.steps?.length ?? 0) + 1,
        title: "",
        description: "",
        responsible: "",
        plannedStartLocal: "",
        plannedEndLocal: "",
        status: "NOT_STARTED",
        progressPct: 0,
        predecessorStepIds: [],
        isBlocker: false,
        notes: ""
      });
      await qc.invalidateQueries({ queryKey: ["itp-plan", selectedEvent?.id] });
      await qc.invalidateQueries({ queryKey: ["itp-events"] });
    }
  });

  const patchStepM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TechnicalStep> }) => apiPatch<TechnicalStep>(`/api/technical-plans/steps/${id}`, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["itp-plan", selectedEvent?.id] });
      await qc.invalidateQueries({ queryKey: ["itp-events"] });
    }
  });

  const deleteStepM = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/technical-plans/steps/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["itp-plan", selectedEvent?.id] });
      await qc.invalidateQueries({ queryKey: ["itp-events"] });
    }
  });

  const timeline = useMemo(() => {
    const steps = plan?.steps ?? [];
    const starts = steps.map((s) => s.plannedStartAt).filter(Boolean).map((v) => dayjs(v));
    const ends = steps.map((s) => s.plannedEndAt).filter(Boolean).map((v) => dayjs(v));
    const fallbackStart = selectedEvent ? dayjs(selectedEvent.startAt) : dayjs();
    const fallbackEnd = selectedEvent ? dayjs(selectedEvent.endAt) : dayjs().add(1, "day");
    const min = starts.length ? starts.reduce((a, b) => (b.isBefore(a) ? b : a), starts[0]!) : fallbackStart;
    const max = ends.length ? ends.reduce((a, b) => (b.isAfter(a) ? b : a), ends[0]!) : fallbackEnd;
    const start = min.startOf("day");
    const end = max.endOf("day");
    const totalMs = Math.max(60 * 60 * 1000, end.valueOf() - start.valueOf());
    const dayCount = Math.max(1, Math.ceil(end.diff(start, "day", true)));
    return { min: start, max: end, totalMs, dayCount };
  }, [plan?.steps, selectedEvent]);

  const networkGroups = useMemo(() => {
    const groups = new Map<string, TechnicalStep[]>();
    for (const step of plan?.steps ?? []) {
      const group = stepGroup(step);
      const list = groups.get(group) ?? [];
      list.push(step);
      groups.set(group, list);
    }
    return Array.from(groups.entries()).map(([group, steps]) => ({
      group,
      steps: steps.slice().sort((a, b) => a.seq - b.seq)
    }));
  }, [plan?.steps]);

  const timelineDays = useMemo(() => {
    const out: dayjs.Dayjs[] = [];
    for (let i = 0; i < timeline.dayCount; i++) out.push(timeline.min.add(i, "day"));
    return out;
  }, [timeline.dayCount, timeline.min]);

  return (
    <div className="itpPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Рабочее место ИТП</div>
          <h1>Технологическая подготовка событий</h1>
          <p>Выберите событие ТО, ведите потребности, ответственных, этапы и сетевой график выполнения работ.</p>
        </div>
        <div className="massHeroStats" aria-label="Сводка ИТП">
          <span><b>{events.length}</b> событий</span>
          <span><b>{activeSandbox ? "Песочница" : "Рабочий контур"}</b></span>
          <span><b>{stats.blockers}</b> блокеров</span>
        </div>
      </section>

      <div className={activeSandbox ? "contextNotice contextNoticeSandbox" : "contextNotice"}>
        {activeSandbox ? (
          <>
            <strong>Режим песочницы:</strong> техпланы ведутся внутри песочницы <b>{activeSandbox.name}</b>.
          </>
        ) : (
          <>
            <strong>Рабочий контур:</strong> изменения РМ ИТП относятся к основному плану.
          </>
        )}
      </div>

      <section className="itpEventPicker card">
        <div className="itpPickerGrid">
          <label>
            <span className="muted">С</span>
            <input type="date" value={rangeFromInput} onChange={(e) => setRangeFromInput(e.target.value)} />
          </label>
          <label>
            <span className="muted">По</span>
            <input type="date" value={rangeToInput} onChange={(e) => setRangeToInput(e.target.value)} />
          </label>
          <label>
            <span className="muted">Поиск</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Борт, событие, тип" />
          </label>
          <label className="itpPickerEvent">
            <span className="muted">Событие ТО</span>
            <select value={selectedEvent?.id ?? ""} onChange={(e) => setSelectedEventId(e.target.value)}>
              {events.map((ev) => {
                const s = planStats(ev.technicalPlan as any);
                const suffix = s.blockers > 0 ? ` • блокеры: ${s.blockers}` : "";
                return (
                  <option key={ev.id} value={ev.id}>
                    {eventLabel(ev)} • {formatDate(ev.startAt)} — {formatDate(ev.endAt)} • {PLAN_STATUS_LABEL[ev.technicalPlan?.status ?? "DRAFT"]} {ev.technicalPlan?.readinessPct ?? 0}%{suffix}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <div className="itpPickerSummary">
          {eventsQ.isLoading ? <span className="muted">Загрузка событий…</span> : <span className="muted">Найдено событий: {events.length}</span>}
          {selectedEvent ? <span className={statusClass(planDraft.status)}>{PLAN_STATUS_LABEL[planDraft.status]}</span> : null}
          {selectedEvent ? <span className="itpBadge">{planDraft.readinessPct}% готовности</span> : null}
          {stats.blockers > 0 ? <span className="itpBadge itpBadgeBad">Блокеры: {stats.blockers}</span> : null}
        </div>
      </section>

      <div className="itpLayout">
        <section className="itpWorkspace">
          {!selectedEvent ? (
            <div className="card muted">Выберите событие для технологической подготовки.</div>
          ) : (
            <>
              <section className="itpZone card">
                <header className="itpZoneHeader">
                  <div>
                    <div className="itpZoneTitle">1. Паспорт события</div>
                    <div className="muted">Контекст ТО и общий статус технологической подготовки.</div>
                  </div>
                  {plan ? (
                    <button className="btn btnPrimary" type="button" onClick={() => savePlanM.mutate()} disabled={savePlanM.isPending}>
                      Сохранить паспорт
                    </button>
                  ) : (
                    <button className="btn btnPrimary" type="button" onClick={() => ensurePlanM.mutate()} disabled={ensurePlanM.isPending}>
                      Создать техплан
                    </button>
                  )}
                </header>

                <div className="itpPassportGrid">
                  <div className="itpPassportCard">
                    <span className="muted">Событие</span>
                    <strong>{eventLabel(selectedEvent)}</strong>
                    <span>{selectedEvent.eventType?.name ?? "—"}</span>
                  </div>
                  <div className="itpPassportCard">
                    <span className="muted">Период</span>
                    <strong>{formatDate(selectedEvent.startAt)}</strong>
                    <span>до {formatDate(selectedEvent.endAt)}</span>
                  </div>
                  <div className="itpPassportCard">
                    <span className="muted">Место</span>
                    <strong>{selectedEvent.hangar?.name ?? "—"}</strong>
                    <span>{selectedEvent.layout?.name ?? "—"}</span>
                  </div>
                  <div className="itpPassportCard">
                    <span className="muted">Готовность</span>
                    <strong>{planDraft.readinessPct}%</strong>
                    <span className={statusClass(planDraft.status)}>{PLAN_STATUS_LABEL[planDraft.status]}</span>
                  </div>
                </div>

                <div className="itpFormGrid">
                  <label>
                    <span className="muted">Статус ИТП</span>
                    <select value={planDraft.status} onChange={(e) => setPlanDraft({ ...planDraft, status: e.target.value })}>
                      {Object.entries(PLAN_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="muted">Ведущий инженер</span>
                    <input value={planDraft.leadEngineer} onChange={(e) => setPlanDraft({ ...planDraft, leadEngineer: e.target.value })} />
                  </label>
                  <label>
                    <span className="muted">Готовность, %</span>
                    <input type="number" min={0} max={100} value={planDraft.readinessPct} onChange={(e) => setPlanDraft({ ...planDraft, readinessPct: Number(e.target.value) })} />
                  </label>
                  <label className="itpWideField">
                    <span className="muted">Комментарий</span>
                    <textarea value={planDraft.notes} onChange={(e) => setPlanDraft({ ...planDraft, notes: e.target.value })} rows={2} />
                  </label>
                </div>
                {ensurePlanM.error || savePlanM.error ? <div className="error">{String((ensurePlanM.error ?? savePlanM.error)?.message ?? "")}</div> : null}
              </section>

              <section className="itpZone card">
                <header className="itpZoneHeader">
                  <div>
                    <div className="itpZoneTitle">2. Потребности</div>
                    <div className="muted">Материалы, персонал, инструмент, документация и прочие условия готовности.</div>
                  </div>
                  <div className="itpZoneStat">{stats.needsReady}/{stats.needsTotal} готово</div>
                </header>

                {!plan ? <div className="muted">Создайте техплан, чтобы добавлять потребности.</div> : null}
                {plan ? (
                  <>
                    <div className="itpInlineForm">
                      <select value={needDraft.category} onChange={(e) => setNeedDraft({ ...needDraft, category: e.target.value })}>
                        {Object.entries(NEED_CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <input className="itpGrow" value={needDraft.description} onChange={(e) => setNeedDraft({ ...needDraft, description: e.target.value })} placeholder="Описание потребности" />
                      <input value={needDraft.quantity} onChange={(e) => setNeedDraft({ ...needDraft, quantity: e.target.value })} placeholder="Кол-во" />
                      <input type="datetime-local" value={needDraft.requiredAtLocal} onChange={(e) => setNeedDraft({ ...needDraft, requiredAtLocal: e.target.value })} />
                      <input value={needDraft.responsible} onChange={(e) => setNeedDraft({ ...needDraft, responsible: e.target.value })} placeholder="Ответственный" />
                      <SwitchToggle
                        compact
                        checked={needDraft.isBlocker}
                        onChange={(v) =>
                          setNeedDraft({
                            ...needDraft,
                            isBlocker: v,
                            status: v ? "BLOCKED" : needDraft.status
                          })
                        }
                        label="Блокер"
                      />
                      <button className="btn btnPrimary" type="button" disabled={!needDraft.description.trim() || addNeedM.isPending} onClick={() => addNeedM.mutate()}>
                        Добавить
                      </button>
                    </div>
                    <div className="itpTableWrap">
                      <table className="itpTable">
                        <thead>
                          <tr><th>Категория</th><th>Потребность</th><th>Срок</th><th>Ответственный</th><th>Статус</th><th /></tr>
                        </thead>
                        <tbody>
                          {plan.needs.map((n) => (
                            <tr key={n.id} className={n.isBlocker || n.status === "BLOCKED" ? "itpBlockedRow" : undefined}>
                              <td>{NEED_CATEGORY_LABEL[n.category] ?? n.category}</td>
                              <td><strong>{n.description}</strong>{n.quantity ? <div className="muted">Кол-во: {n.quantity}</div> : null}</td>
                              <td>{formatDate(n.requiredAt)}</td>
                              <td>{n.responsible || "—"}</td>
                              <td>
                                <select value={n.status} onChange={(e) => patchNeedM.mutate({ id: n.id, patch: { status: e.target.value, isBlocker: e.target.value === "BLOCKED" } as any })}>
                                  {Object.entries(NEED_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                              </td>
                              <td><button className="btn" type="button" onClick={() => deleteNeedM.mutate(n.id)}>Удалить</button></td>
                            </tr>
                          ))}
                          {plan.needs.length === 0 ? <tr><td colSpan={6} className="muted">Потребности пока не добавлены.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </section>

              <section className="itpZone card">
                <header className="itpZoneHeader">
                  <div>
                    <div className="itpZoneTitle">3. Этапы работ</div>
                    <div className="muted">Этапы сетевого графика, ответственные, даты, прогресс и блокеры.</div>
                  </div>
                  <div className="itpZoneStat">{stats.stepsDone}/{stats.stepsTotal} завершено</div>
                </header>

                {!plan ? <div className="muted">Создайте техплан, чтобы добавлять этапы.</div> : null}
                {plan ? (
                  <>
                    <div className="itpInlineForm itpStepForm">
                      <input type="number" min={0} value={stepDraft.seq} onChange={(e) => setStepDraft({ ...stepDraft, seq: Number(e.target.value) })} title="Порядок" />
                      <input value={stepDraft.description} onChange={(e) => setStepDraft({ ...stepDraft, description: e.target.value })} placeholder="Зона/система: крыло, БГО, авионика..." />
                      <input className="itpGrow" value={stepDraft.title} onChange={(e) => setStepDraft({ ...stepDraft, title: e.target.value })} placeholder="Название этапа" />
                      <input value={stepDraft.responsible} onChange={(e) => setStepDraft({ ...stepDraft, responsible: e.target.value })} placeholder="Ответственный" />
                      <input type="datetime-local" value={stepDraft.plannedStartLocal} onChange={(e) => setStepDraft({ ...stepDraft, plannedStartLocal: e.target.value })} />
                      <input type="datetime-local" value={stepDraft.plannedEndLocal} onChange={(e) => setStepDraft({ ...stepDraft, plannedEndLocal: e.target.value })} />
                      <select multiple value={stepDraft.predecessorStepIds} onChange={(e) => setStepDraft({ ...stepDraft, predecessorStepIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} title="Зависит от">
                        {plan.steps.map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.title}</option>)}
                      </select>
                      <button className="btn btnPrimary" type="button" disabled={!stepDraft.title.trim() || addStepM.isPending} onClick={() => addStepM.mutate()}>
                        Добавить этап
                      </button>
                    </div>
                    <div className="itpTableWrap">
                      <table className="itpTable">
                        <thead>
                          <tr><th>#</th><th>Зона/система</th><th>Этап</th><th>План</th><th>Ответственный</th><th>Статус</th><th>Прогресс</th><th>Зависит от</th><th /></tr>
                        </thead>
                        <tbody>
                          {plan.steps.map((s) => {
                            const predecessors = (s.predecessors ?? []).map((d) => plan.steps.find((p) => p.id === d.predecessorStepId)?.title).filter(Boolean);
                            return (
                              <tr key={s.id} className={s.isBlocker || s.status === "BLOCKED" ? "itpBlockedRow" : undefined}>
                                <td>{s.seq}</td>
                                <td>{stepGroup(s)}</td>
                                <td><strong>{s.title}</strong>{s.notes ? <div className="muted">{s.notes}</div> : null}</td>
                                <td>{formatDate(s.plannedStartAt)}<br /><span className="muted">до {formatDate(s.plannedEndAt)}</span></td>
                                <td>{s.responsible || "—"}</td>
                                <td>
                                  <select value={s.status} onChange={(e) => patchStepM.mutate({ id: s.id, patch: { status: e.target.value, isBlocker: e.target.value === "BLOCKED" } as any })}>
                                    {Object.entries(STEP_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <input type="number" min={0} max={100} value={s.progressPct} onChange={(e) => patchStepM.mutate({ id: s.id, patch: { progressPct: Number(e.target.value) } })} />
                                </td>
                                <td>{predecessors.length ? predecessors.join(", ") : "—"}</td>
                                <td><button className="btn" type="button" onClick={() => deleteStepM.mutate(s.id)}>Удалить</button></td>
                              </tr>
                            );
                          })}
                          {plan.steps.length === 0 ? <tr><td colSpan={9} className="muted">Этапы пока не добавлены.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </section>

              <section className="itpZone card">
                <header className="itpZoneHeader">
                  <div>
                    <div className="itpZoneTitle">4. Сетевой график</div>
                    <div className="muted">MVP-визуализация этапов по времени. Полноценный критический путь можно добавить следующим шагом.</div>
                  </div>
                  <div className="itpZoneStat">{timeline.min.format("DD.MM")} — {timeline.max.format("DD.MM")}</div>
                </header>
                {!plan || plan.steps.length === 0 ? (
                  <div className="muted">Добавьте этапы с плановыми датами, чтобы увидеть сетевой график.</div>
                ) : (
                  <div className="itpNetworkMatrix">
                    <div className="itpNetworkHeader" style={{ width: Math.max(720, timelineDays.length * 34) }}>
                      {timelineDays.map((d) => (
                        <div className="itpNetworkDay" key={d.toISOString()}>
                          <strong>{d.format("DD")}</strong>
                          <span>{d.format("MMM")}</span>
                        </div>
                      ))}
                    </div>
                    {networkGroups.map((group) => (
                      <div className="itpNetworkGroup" key={group.group}>
                        <div className="itpNetworkGroupTitle">{group.group}</div>
                        <div className="itpNetworkGroupRows">
                          {group.steps.map((s) => {
                            const start = s.plannedStartAt ? dayjs(s.plannedStartAt) : timeline.min;
                            const end = s.plannedEndAt ? dayjs(s.plannedEndAt) : start.add(1, "day");
                            const left = Math.max(0, ((start.valueOf() - timeline.min.valueOf()) / timeline.totalMs) * 100);
                            const width = Math.max(2, ((end.valueOf() - start.valueOf()) / timeline.totalMs) * 100);
                            return (
                              <div className="itpNetworkMatrixRow" key={s.id} style={{ width: Math.max(720, timelineDays.length * 34) }}>
                                <div className="itpNetworkMatrixTrack" />
                                <div
                                  className={`itpNetworkBar ${s.status === "BLOCKED" ? "itpNetworkBarBlocked" : ""}${s.status === "DONE" ? " itpNetworkBarDone" : ""}`}
                                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                                  title={`${s.title}: ${formatDate(s.plannedStartAt)} — ${formatDate(s.plannedEndAt)}`}
                                >
                                  <span>{s.seq}. {s.title}</span>
                                  <b>{s.progressPct}%</b>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {addNeedM.error || patchNeedM.error || deleteNeedM.error || addStepM.error || patchStepM.error || deleteStepM.error ? (
                <div className="error">
                  {String((addNeedM.error ?? patchNeedM.error ?? deleteNeedM.error ?? addStepM.error ?? patchStepM.error ?? deleteStepM.error)?.message ?? "")}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
