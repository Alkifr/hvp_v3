import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiDelete, apiGet, apiPost } from "../../lib/api";

type Skill = { id: string; code: string; name: string };
type Shift = { id: string; code: string; name: string; startMin: number; endMin: number };

type PlanLine = {
  id: string;
  date: string;
  plannedHeadcount?: number | null;
  notes?: string | null;
  skill: Skill;
  shift: Shift;
};

type ActualLine = {
  id: string;
  date: string;
  actualHeadcount: number;
  notes?: string | null;
  skill: Skill;
  shift: Shift;
};

export function EventResourcesPanel(props: { eventId: string }) {
  const qc = useQueryClient();

  const skillsQ = useQuery({ queryKey: ["ref", "skills"], queryFn: () => apiGet<Skill[]>("/api/ref/skills") });
  const shiftsQ = useQuery({ queryKey: ["ref", "shifts"], queryFn: () => apiGet<Shift[]>("/api/ref/shifts") });

  const planQ = useQuery({
    queryKey: ["resources", "plan", props.eventId],
    queryFn: () => apiGet<PlanLine[]>(`/api/resources/events/${props.eventId}/plan`)
  });

  const actualQ = useQuery({
    queryKey: ["resources", "actual", props.eventId],
    queryFn: () => apiGet<ActualLine[]>(`/api/resources/events/${props.eventId}/actual`)
  });

  const invalidateAll = async () => {
    await qc.invalidateQueries({ queryKey: ["resources", "plan", props.eventId] });
    await qc.invalidateQueries({ queryKey: ["resources", "actual", props.eventId] });
  };

  // ---- формы ----
  const defaultSkillId = skillsQ.data?.[0]?.id ?? "";
  const defaultShiftId = shiftsQ.data?.[0]?.id ?? "";

  const [planDate, setPlanDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [planShiftId, setPlanShiftId] = useState(defaultShiftId);
  const [planSkillId, setPlanSkillId] = useState(defaultSkillId);
  const [planPeople, setPlanPeople] = useState(1);

  const [actualDate, setActualDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [actualShiftId, setActualShiftId] = useState(defaultShiftId);
  const [actualSkillId, setActualSkillId] = useState(defaultSkillId);
  const [actualPeople, setActualPeople] = useState(1);

  // синхронизация дефолтов после загрузки справочников (простая)
  useMemo(() => {
    if (!planShiftId && defaultShiftId) setPlanShiftId(defaultShiftId);
    if (!planSkillId && defaultSkillId) setPlanSkillId(defaultSkillId);
    if (!actualShiftId && defaultShiftId) setActualShiftId(defaultShiftId);
    if (!actualSkillId && defaultSkillId) setActualSkillId(defaultSkillId);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultShiftId, defaultSkillId]);

  const addPlanM = useMutation({
    mutationFn: () =>
      apiPost(`/api/resources/events/${props.eventId}/plan`, {
        date: dayjs(planDate).startOf("day").toISOString(),
        shiftId: planShiftId,
        skillId: planSkillId,
        plannedHeadcount: planPeople
      }),
    onSuccess: invalidateAll
  });

  const delPlanM = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/resources/events/plan/${id}`),
    onSuccess: invalidateAll
  });

  const addActualM = useMutation({
    mutationFn: () =>
      apiPost(`/api/resources/events/${props.eventId}/actual`, {
        date: dayjs(actualDate).startOf("day").toISOString(),
        shiftId: actualShiftId,
        skillId: actualSkillId,
        actualHeadcount: actualPeople
      }),
    onSuccess: invalidateAll
  });

  const delActualM = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/resources/events/actual/${id}`),
    onSuccess: invalidateAll
  });

  const summary = useMemo(() => {
    const plan = planQ.data ?? [];
    const actual = actualQ.data ?? [];
    const keyOf = (d: string, shiftCode: string, skillCode: string) => `${dayjs(d).format("YYYY-MM-DD")}|${shiftCode}|${skillCode}`;
    const map = new Map<string, { date: string; shift: Shift; skill: Skill; planned: number; actual: number }>();
    for (const p of plan) {
      const k = keyOf(p.date, p.shift.code, p.skill.code);
      map.set(k, {
        date: p.date,
        shift: p.shift,
        skill: p.skill,
        planned: Number(p.plannedHeadcount ?? 0),
        actual: map.get(k)?.actual ?? 0
      });
    }
    for (const a of actual) {
      const k = keyOf(a.date, a.shift.code, a.skill.code);
      map.set(k, {
        date: a.date,
        shift: a.shift,
        skill: a.skill,
        planned: map.get(k)?.planned ?? 0,
        actual: Number(a.actualHeadcount ?? 0)
      });
    }
    return Array.from(map.values()).sort((x, y) => {
      const d = String(x.date).localeCompare(String(y.date));
      if (d !== 0) return d;
      const s = x.shift.code.localeCompare(y.shift.code);
      if (s !== 0) return s;
      return x.skill.code.localeCompare(y.skill.code);
    });
  }, [planQ.data, actualQ.data]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <strong>Ресурсы (персонал без персоналий)</strong>
        <div className="muted" style={{ marginTop: 4 }}>
          План/факт: сколько людей нужно/было по сменам и квалификациям.
        </div>
      </div>

      <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <strong>План (квалификации/смены)</strong>
          {planQ.isFetching ? <span className="muted">обновление…</span> : null}
        </div>
        {planQ.error ? <div className="error">{String((planQ.error as any)?.message ?? planQ.error)}</div> : null}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Дата</span>
            <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Смена</span>
            <select value={planShiftId} onChange={(e) => setPlanShiftId(e.target.value)}>
              {(shiftsQ.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} • {s.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Квалификация</span>
            <select value={planSkillId} onChange={(e) => setPlanSkillId(e.target.value)}>
              {(skillsQ.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} • {s.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Кол-во (чел.)</span>
            <input type="number" step={1} value={planPeople} onChange={(e) => setPlanPeople(Number(e.target.value))} style={{ width: 140 }} />
          </label>
          <button className="btn btnPrimary" onClick={() => addPlanM.mutate()} disabled={addPlanM.isPending || !planSkillId || !planShiftId}>
            Добавить
          </button>
          {addPlanM.error ? <span className="error">{String((addPlanM.error as any)?.message ?? addPlanM.error)}</span> : null}
        </div>

        {(planQ.data ?? []).length === 0 ? <div className="muted" style={{ marginTop: 8 }}>План пока пустой.</div> : null}
      </div>

      <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <strong>Факт (по сменам)</strong>
          {actualQ.isFetching ? <span className="muted">обновление…</span> : null}
        </div>
        {actualQ.error ? <div className="error">{String((actualQ.error as any)?.message ?? actualQ.error)}</div> : null}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Дата</span>
            <input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Квалификация</span>
            <select value={actualSkillId} onChange={(e) => setActualSkillId(e.target.value)}>
              {(skillsQ.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} • {s.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Смена</span>
            <select value={actualShiftId} onChange={(e) => setActualShiftId(e.target.value)} style={{ width: 180 }}>
              {(shiftsQ.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} • {s.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Кол-во (чел.)</span>
            <input type="number" step={1} value={actualPeople} onChange={(e) => setActualPeople(Number(e.target.value))} style={{ width: 140 }} />
          </label>
          <button className="btn btnPrimary" onClick={() => addActualM.mutate()} disabled={addActualM.isPending || !actualShiftId || !actualSkillId}>
            Добавить
          </button>
          {addActualM.error ? <span className="error">{String((addActualM.error as any)?.message ?? addActualM.error)}</span> : null}
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <strong>Сводка (план vs факт)</strong>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {summary.map((r) => (
              <div key={`${r.date}|${r.shift.code}|${r.skill.code}`} className="row">
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{dayjs(r.date).format("DD.MM.YYYY")}</span>
                <span className="muted">{r.shift.code}</span>
                <span>
                  <strong>{r.skill.code}</strong> <span className="muted">({r.skill.name})</span>
                </span>
                <span className="muted">план: {r.planned}</span>
                <span className="muted">факт: {r.actual}</span>
                <span className="muted">Δ: {r.actual - r.planned}</span>
                <span style={{ flex: "1 1 auto" }} />
              </div>
            ))}
            {summary.length === 0 ? <div className="muted">Пока нет ни плана, ни факта.</div> : null}
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {(planQ.data ?? []).map((l) => (
              <div key={l.id} className="row">
                <span className="muted">План</span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{dayjs(l.date).format("DD.MM.YYYY")}</span>
                <span className="muted">{l.shift.code}</span>
                <span className="muted">{l.skill.code}</span>
                <span className="muted">{Number(l.plannedHeadcount ?? 0)} чел.</span>
                <span style={{ flex: "1 1 auto" }} />
                <button className="btn" onClick={() => delPlanM.mutate(l.id)} disabled={delPlanM.isPending}>
                  Удалить
                </button>
              </div>
            ))}
            {(actualQ.data ?? []).map((a) => (
              <div key={a.id} className="row">
                <span className="muted">Факт</span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{dayjs(a.date).format("DD.MM.YYYY")}</span>
                <span className="muted">{a.shift.code}</span>
                <span className="muted">{a.skill.code}</span>
                <span className="muted">{Number(a.actualHeadcount ?? 0)} чел.</span>
                <span style={{ flex: "1 1 auto" }} />
                <button className="btn" onClick={() => delActualM.mutate(a.id)} disabled={delActualM.isPending}>
                  Удалить
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

