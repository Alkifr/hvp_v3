import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet } from "../../lib/api";
import { sandboxIsArchived, useActiveSandbox, type SandboxSummary } from "../components/SandboxSwitcher";

type TabId = "tat" | "util" | "compare";

type TatResponse = {
  ok: true;
  period: { from: string; to: string };
  summary: {
    events: number;
    withActual: number;
    missingActual: number;
    avgTatVarianceH: number | null;
    avgStartDelayH: number | null;
    onTime: number;
    lateStart: number;
    tatOverrun: number;
  };
  deviationBreakdown: Array<{ label: string; count: number }>;
  reasonBreakdown: Array<{ reason: string; count: number }>;
  rows: Array<{
    eventId: string;
    title: string;
    status: string;
    aircraft: string;
    eventType: string;
    hangar: string | null;
    planTatH: number;
    actualTatH: number | null;
    tatVarianceH: number | null;
    startDelayH: number | null;
    endDelayH: number | null;
    deviationLabels: string[];
    reason: string | null;
    planStartAt: string;
    planEndAt: string;
    actualStartAt: string | null;
    actualEndAt: string | null;
  }>;
};

type UtilResponse = {
  ok: true;
  period: { from: string; to: string; hours: number };
  summary: {
    hangars: number;
    stands: number;
    occupiedH: number;
    idleH: number;
    capacityH: number;
    utilizationPct: number;
  };
  hangars: Array<{
    hangarId: string;
    hangarName: string;
    standCount: number;
    occupiedH: number;
    idleH: number;
    capacityH: number;
    utilizationPct: number;
    reservationCount: number;
  }>;
  stands: Array<{
    standId: string;
    standCode: string;
    hangarName: string;
    layoutName: string;
    occupiedH: number;
    idleH: number;
    utilizationPct: number;
    reservationCount: number;
  }>;
};

type CompareResponse = {
  ok: true;
  period: { from: string; to: string; hours: number };
  a: SideMetrics;
  b: SideMetrics;
  delta: {
    events: number;
    placed: number;
    unplaced: number;
    aircraftHours: number;
    occupiedStandHours: number;
    idleH: number;
    utilizationPct: number;
    avgEventTatH: number;
  };
  hangarCompare: Array<{
    hangarId: string;
    hangarName: string;
    aOccupiedH: number;
    bOccupiedH: number;
    deltaH: number;
  }>;
};

type SideMetrics = {
  scope: string;
  sandboxId: string | null;
  name: string;
  events: number;
  placed: number;
  unplaced: number;
  aircraftHours: number;
  occupiedStandHours: number;
  idleH: number;
  capacityH: number;
  utilizationPct: number;
  avgEventTatH: number;
};

function toInputDate(d: dayjs.Dayjs): string {
  return d.format("YYYY-MM-DD");
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function fmtSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = fmtNum(n);
  return n > 0 ? `+${s}` : s;
}

function scopeLabel(id: string, list: SandboxSummary[]): string {
  if (id === "prod") return "Рабочий контур";
  return list.find((s) => s.id === id)?.name ?? id;
}

export function AnalyticsView() {
  const { active, list } = useActiveSandbox();
  const activeSandboxes = useMemo(() => list.filter((s) => !sandboxIsArchived(s)), [list]);

  const [tab, setTab] = useState<TabId>("tat");
  const [from, setFrom] = useState(() => toInputDate(dayjs().subtract(30, "day")));
  const [to, setTo] = useState(() => toInputDate(dayjs().add(1, "day")));
  const [compareA, setCompareA] = useState("prod");
  const [compareB, setCompareB] = useState(() => active?.id ?? "");

  const fromIso = dayjs(from).startOf("day").toISOString();
  const toIso = dayjs(to).endOf("day").toISOString();
  const periodOk = dayjs(to).isAfter(dayjs(from));

  const tatQ = useQuery({
    queryKey: ["analytics", "tat-variance", fromIso, toIso, active?.id ?? "prod"],
    queryFn: () =>
      apiGet<TatResponse>(
        `/api/analytics/tat-variance?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
      ),
    enabled: tab === "tat" && periodOk
  });

  const utilQ = useQuery({
    queryKey: ["analytics", "utilization", fromIso, toIso, active?.id ?? "prod"],
    queryFn: () =>
      apiGet<UtilResponse>(
        `/api/analytics/utilization?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
      ),
    enabled: tab === "util" && periodOk
  });

  const compareReady = Boolean(compareA && compareB && compareA !== compareB);
  const compareQ = useQuery({
    queryKey: ["analytics", "sandbox-compare", fromIso, toIso, compareA, compareB],
    queryFn: () =>
      apiGet<CompareResponse>(
        `/api/analytics/sandbox-compare?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&a=${encodeURIComponent(compareA)}&b=${encodeURIComponent(compareB)}`
      ),
    enabled: tab === "compare" && periodOk && compareReady
  });

  return (
    <div className="analyticsPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Аналитика после факта</div>
          <h1>Отчёты плана</h1>
          <p>
            TAT variance и причины отклонений, загрузка ангаров и мест, сравнение сценариев песочниц по загрузке и
            простоям. TAT и utilization считаются в текущем контуре
            {active ? ` («${active.name}»)` : " (рабочий контур)"}.
          </p>
        </div>
      </section>

      <div className="analyticsToolbar card">
        <label className="analyticsField">
          <span>С</span>
          <input type="date" className="evInput" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="analyticsField">
          <span>По</span>
          <input type="date" className="evInput" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="analyticsPresets">
          <button type="button" className="btn" onClick={() => { setFrom(toInputDate(dayjs().subtract(7, "day"))); setTo(toInputDate(dayjs())); }}>
            7 дн
          </button>
          <button type="button" className="btn" onClick={() => { setFrom(toInputDate(dayjs().subtract(30, "day"))); setTo(toInputDate(dayjs())); }}>
            30 дн
          </button>
          <button type="button" className="btn" onClick={() => { setFrom(toInputDate(dayjs().subtract(90, "day"))); setTo(toInputDate(dayjs())); }}>
            90 дн
          </button>
        </div>
        {!periodOk ? <span className="error">Дата «по» должна быть позже «с»</span> : null}
      </div>

      <div className="sandboxesTabs">
        <button type="button" className={tab === "tat" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setTab("tat")}>
          TAT variance
        </button>
        <button type="button" className={tab === "util" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setTab("util")}>
          Utilization
        </button>
        <button type="button" className={tab === "compare" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setTab("compare")}>
          Сценарии A vs B
        </button>
      </div>

      {tab === "tat" ? <TatPanel q={tatQ} /> : null}
      {tab === "util" ? <UtilPanel q={utilQ} /> : null}
      {tab === "compare" ? (
        <ComparePanel
          q={compareQ}
          list={activeSandboxes}
          compareA={compareA}
          compareB={compareB}
          setCompareA={setCompareA}
          setCompareB={setCompareB}
          compareReady={compareReady}
        />
      ) : null}
    </div>
  );
}

function StatCards(props: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="analyticsStats">
      {props.items.map((it) => (
        <div key={it.label} className="analyticsStat card">
          <div className="analyticsStatLabel">{it.label}</div>
          <div className="analyticsStatValue">{it.value}</div>
          {it.hint ? <div className="muted analyticsStatHint">{it.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

function TatPanel(props: { q: { isLoading: boolean; error: Error | null; data?: TatResponse } }) {
  const { q } = props;
  if (q.isLoading) return <div className="muted">Загрузка…</div>;
  if (q.error) return <div className="error">{String((q.error as any).message ?? q.error)}</div>;
  const data = q.data;
  if (!data) return null;

  return (
    <div className="analyticsStack">
      <StatCards
        items={[
          { label: "Событий", value: String(data.summary.events) },
          { label: "С фактом", value: String(data.summary.withActual), hint: `без факта: ${data.summary.missingActual}` },
          { label: "Ср. Δ TAT, ч", value: fmtSigned(data.summary.avgTatVarianceH), hint: "факт − план" },
          { label: "Ср. задержка старта, ч", value: fmtSigned(data.summary.avgStartDelayH) },
          { label: "В срок", value: String(data.summary.onTime) },
          { label: "Поздний старт / overrun", value: `${data.summary.lateStart} / ${data.summary.tatOverrun}` }
        ]}
      />

      <div className="analyticsSplit">
        <section className="card analyticsCard">
          <h3>Типы отклонений</h3>
          {data.deviationBreakdown.length === 0 ? (
            <div className="muted">Нет данных</div>
          ) : (
            <ul className="analyticsBarList">
              {data.deviationBreakdown.map((x) => (
                <li key={x.label}>
                  <span>{x.label}</span>
                  <b>{x.count}</b>
                  <span
                    className="analyticsBarFill"
                    style={{ width: `${Math.max(6, (x.count / Math.max(1, data.summary.events)) * 100)}%` }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card analyticsCard">
          <h3>Причины (из истории / примечаний)</h3>
          {data.reasonBreakdown.length === 0 ? (
            <div className="muted">Нет данных</div>
          ) : (
            <ul className="analyticsBarList">
              {data.reasonBreakdown.map((x) => (
                <li key={x.reason}>
                  <span title={x.reason}>{x.reason}</span>
                  <b>{x.count}</b>
                  <span
                    className="analyticsBarFill analyticsBarFillAlt"
                    style={{ width: `${Math.max(6, (x.count / Math.max(1, data.summary.events)) * 100)}%` }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card analyticsCard">
        <h3>События</h3>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Борт</th>
                <th>Событие</th>
                <th>План TAT</th>
                <th>Факт TAT</th>
                <th>Δ TAT</th>
                <th>Δ старт</th>
                <th>Отклонения</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.eventId}>
                  <td>{r.aircraft}</td>
                  <td>
                    <div className="analyticsEventTitle">{r.title}</div>
                    <div className="muted">{r.eventType}{r.hangar ? ` · ${r.hangar}` : ""}</div>
                  </td>
                  <td>{fmtNum(r.planTatH)}</td>
                  <td>{fmtNum(r.actualTatH)}</td>
                  <td className={r.tatVarianceH != null && r.tatVarianceH > 2 ? "analyticsBad" : undefined}>
                    {fmtSigned(r.tatVarianceH)}
                  </td>
                  <td className={r.startDelayH != null && r.startDelayH > 2 ? "analyticsBad" : undefined}>
                    {fmtSigned(r.startDelayH)}
                  </td>
                  <td>
                    <div className="analyticsTags">
                      {r.deviationLabels.map((l) => (
                        <span key={l} className="analyticsTag">
                          {l}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td title={r.reason ?? undefined}>{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function UtilPanel(props: { q: { isLoading: boolean; error: Error | null; data?: UtilResponse } }) {
  const { q } = props;
  if (q.isLoading) return <div className="muted">Загрузка…</div>;
  if (q.error) return <div className="error">{String((q.error as any).message ?? q.error)}</div>;
  const data = q.data;
  if (!data) return null;

  return (
    <div className="analyticsStack">
      <StatCards
        items={[
          { label: "Utilization", value: `${fmtNum(data.summary.utilizationPct)}%`, hint: "занятость ёмкости мест" },
          { label: "Занято, ч", value: fmtNum(data.summary.occupiedH) },
          { label: "Простой, ч", value: fmtNum(data.summary.idleH) },
          { label: "Ёмкость, ч", value: fmtNum(data.summary.capacityH), hint: `период ${fmtNum(data.period.hours)} ч` },
          { label: "Ангаров", value: String(data.summary.hangars) },
          { label: "Мест", value: String(data.summary.stands) }
        ]}
      />

      <section className="card analyticsCard">
        <h3>Ангары</h3>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Ангар</th>
                <th>Мест</th>
                <th>Занято, ч</th>
                <th>Простой, ч</th>
                <th>Utilization</th>
                <th>Резервов</th>
              </tr>
            </thead>
            <tbody>
              {data.hangars.map((h) => (
                <tr key={h.hangarId}>
                  <td>{h.hangarName}</td>
                  <td>{h.standCount}</td>
                  <td>{fmtNum(h.occupiedH)}</td>
                  <td>{fmtNum(h.idleH)}</td>
                  <td>
                    <div className="analyticsUtilCell">
                      <span>{fmtNum(h.utilizationPct)}%</span>
                      <span className="analyticsUtilTrack">
                        <span className="analyticsUtilFill" style={{ width: `${Math.min(100, h.utilizationPct)}%` }} />
                      </span>
                    </div>
                  </td>
                  <td>{h.reservationCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card analyticsCard">
        <h3>Места стоянки</h3>
        <div className="analyticsTableWrap">
          <table className="analyticsTable">
            <thead>
              <tr>
                <th>Место</th>
                <th>Ангар</th>
                <th>Схема</th>
                <th>Занято, ч</th>
                <th>Простой, ч</th>
                <th>Utilization</th>
              </tr>
            </thead>
            <tbody>
              {data.stands.slice(0, 80).map((s) => (
                <tr key={s.standId}>
                  <td>{s.standCode}</td>
                  <td>{s.hangarName}</td>
                  <td>{s.layoutName}</td>
                  <td>{fmtNum(s.occupiedH)}</td>
                  <td>{fmtNum(s.idleH)}</td>
                  <td>{fmtNum(s.utilizationPct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.stands.length > 80 ? <div className="muted">Показаны топ-80 мест по загрузке</div> : null}
        </div>
      </section>
    </div>
  );
}

function ComparePanel(props: {
  q: { isLoading: boolean; error: Error | null; data?: CompareResponse };
  list: SandboxSummary[];
  compareA: string;
  compareB: string;
  setCompareA: (v: string) => void;
  setCompareB: (v: string) => void;
  compareReady: boolean;
}) {
  const { q, list, compareA, compareB, setCompareA, setCompareB, compareReady } = props;

  return (
    <div className="analyticsStack">
      <div className="analyticsToolbar card">
        <label className="analyticsField analyticsFieldGrow">
          <span>Сценарий A</span>
          <select className="evInput" value={compareA} onChange={(e) => setCompareA(e.target.value)}>
            <option value="prod">Рабочий контур</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="analyticsField analyticsFieldGrow">
          <span>Сценарий B</span>
          <select className="evInput" value={compareB} onChange={(e) => setCompareB(e.target.value)}>
            <option value="">— выберите —</option>
            <option value="prod">Рабочий контур</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!compareReady ? (
        <div className="muted">Выберите два разных сценария для сравнения.</div>
      ) : q.isLoading ? (
        <div className="muted">Загрузка…</div>
      ) : q.error ? (
        <div className="error">{String((q.error as any).message ?? q.error)}</div>
      ) : q.data ? (
        <>
          <div className="analyticsCompareHeads">
            <div className="card analyticsCard">
              <div className="muted">A · {scopeLabel(compareA, list)}</div>
              <h3>{q.data.a.name}</h3>
              <div className="analyticsMiniStats">
                <span><b>{q.data.a.events}</b> событий</span>
                <span><b>{fmtNum(q.data.a.utilizationPct)}%</b> util</span>
                <span><b>{fmtNum(q.data.a.idleH)}</b> ч простоя</span>
                <span><b>{fmtNum(q.data.a.aircraftHours)}</b> ВС·ч</span>
              </div>
            </div>
            <div className="card analyticsCard">
              <div className="muted">B · {scopeLabel(compareB, list)}</div>
              <h3>{q.data.b.name}</h3>
              <div className="analyticsMiniStats">
                <span><b>{q.data.b.events}</b> событий</span>
                <span><b>{fmtNum(q.data.b.utilizationPct)}%</b> util</span>
                <span><b>{fmtNum(q.data.b.idleH)}</b> ч простоя</span>
                <span><b>{fmtNum(q.data.b.aircraftHours)}</b> ВС·ч</span>
              </div>
            </div>
          </div>

          <StatCards
            items={[
              { label: "Δ событий", value: fmtSigned(q.data.delta.events) },
              { label: "Δ размещённых", value: fmtSigned(q.data.delta.placed) },
              { label: "Δ неразмещённых", value: fmtSigned(q.data.delta.unplaced) },
              { label: "Δ ВС·ч", value: fmtSigned(q.data.delta.aircraftHours) },
              { label: "Δ занятость мест, ч", value: fmtSigned(q.data.delta.occupiedStandHours) },
              { label: "Δ простой, ч", value: fmtSigned(q.data.delta.idleH) },
              { label: "Δ utilization, п.п.", value: fmtSigned(q.data.delta.utilizationPct) },
              { label: "Δ ср. TAT, ч", value: fmtSigned(q.data.delta.avgEventTatH) }
            ]}
          />

          <section className="card analyticsCard">
            <h3>Загрузка по ангарам (A vs B)</h3>
            <div className="analyticsTableWrap">
              <table className="analyticsTable">
                <thead>
                  <tr>
                    <th>Ангар</th>
                    <th>A, ч</th>
                    <th>B, ч</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.hangarCompare.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        Нет резервов мест в периоде
                      </td>
                    </tr>
                  ) : (
                    q.data.hangarCompare.map((h) => (
                      <tr key={h.hangarId}>
                        <td>{h.hangarName}</td>
                        <td>{fmtNum(h.aOccupiedH)}</td>
                        <td>{fmtNum(h.bOccupiedH)}</td>
                        <td className={h.deltaH > 0 ? "analyticsBad" : h.deltaH < 0 ? "analyticsGood" : undefined}>
                          {fmtSigned(h.deltaH)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
