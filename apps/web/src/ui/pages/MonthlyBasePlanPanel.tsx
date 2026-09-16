import { useMemo, useState, type CSSProperties } from "react";

import { exportMonthlyBasePlanExcel } from "../../lib/analyticsExcel";
import { contrastTextColor, isDarkFill } from "../../lib/colorContrast";
import { occupiedHalfRanges } from "../../lib/monthlyPlanLayout";

type LaborSource = "plan_lines" | "mps" | "budget" | "none";

export type MonthlyBasePlanResponse = {
  ok: true;
  period: { from: string; to: string };
  nrcFactor: number;
  days: Array<{ key: string; label: string; weekday: number; weekend: boolean }>;
  events: Array<{
    eventId: string;
    title: string;
    aircraft: string;
    aircraftType: string;
    operatorCode: string;
    operatorId: string | null;
    aircraftId: string | null;
    aircraftTypeId: string | null;
    eventTypeId: string | null;
    hangarId: string | null;
    hangarName: string;
    workshopId: string | null;
    workshopName: string;
    color: string;
    startAt: string;
    endAt: string;
    laborSource: LaborSource;
    laborTotal: number;
    qualifications: {
      ME: number;
      AV: number;
      INT: number;
      NDT: number;
      SHOP: number;
      CAB_REP: number;
    };
    occupied: Array<{ day: boolean; evening: boolean }>;
    labor: Array<{ day: number; evening: number }>;
  }>;
  shops: Array<{
    workshopId: string;
    workshopName: string;
    planned: number[];
    plannedWithNrc: number[];
  }>;
  summary: {
    events: number;
    shops: number;
    laborTotal: number;
    laborWithNrc: number;
    withPlanLines: number;
    withSpreadLabor: number;
    withoutLabor: number;
  };
};

type AnalyticsFilters = {
  hangarIds: string[];
  operatorIds: string[];
  aircraftTypeIds: string[];
  aircraftIds: string[];
  eventTypeIds: string[];
};

function matchFilters(
  row: {
    hangarId?: string | null;
    operatorId?: string | null;
    aircraftTypeId?: string | null;
    aircraftId?: string | null;
    eventTypeId?: string | null;
  },
  filters: AnalyticsFilters
): boolean {
  if (filters.hangarIds.length > 0) {
    const id = row.hangarId ? String(row.hangarId) : "";
    if (id && !filters.hangarIds.includes(id)) return false;
  }
  if (filters.operatorIds.length > 0) {
    const id = row.operatorId ? String(row.operatorId) : "";
    if (!id || !filters.operatorIds.includes(id)) return false;
  }
  if (filters.aircraftTypeIds.length > 0) {
    const id = row.aircraftTypeId ? String(row.aircraftTypeId) : "";
    if (!id || !filters.aircraftTypeIds.includes(id)) return false;
  }
  if (filters.aircraftIds.length > 0) {
    const id = row.aircraftId ? String(row.aircraftId) : "";
    if (!id || !filters.aircraftIds.includes(id)) return false;
  }
  if (filters.eventTypeIds.length > 0) {
    const id = row.eventTypeId ? String(row.eventTypeId) : "";
    if (!id || !filters.eventTypeIds.includes(id)) return false;
  }
  return true;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function laborDayTotal(labor: { day: number; evening: number } | undefined): number {
  return (labor?.day ?? 0) + (labor?.evening ?? 0);
}

const META_COL_PX = 76;
const SHIFT_COL_PX = 18;

function planTableWidth(dayCount: number): number {
  return META_COL_PX * 3 + SHIFT_COL_PX * 2 * dayCount;
}

function stickyStyle(left: number, z: number): CSSProperties {
  return {
    position: "sticky",
    left,
    zIndex: z,
    background: "#f8fafc"
  };
}

function MonthlyPlanColgroup({ days }: { days: MonthlyBasePlanResponse["days"] }) {
  return (
    <colgroup>
      <col style={{ width: META_COL_PX }} />
      <col style={{ width: META_COL_PX }} />
      <col style={{ width: META_COL_PX }} />
      {days.flatMap((d) => [
        <col key={`${d.key}-d`} style={{ width: SHIFT_COL_PX }} />,
        <col key={`${d.key}-e`} style={{ width: SHIFT_COL_PX }} />
      ])}
    </colgroup>
  );
}

function MonthlyPlanShiftHead({
  days,
  labels
}: {
  days: MonthlyBasePlanResponse["days"];
  labels: [string, string, string];
}) {
  return (
    <thead>
      <tr>
        <th className="monthlyPlanMeta" rowSpan={2} style={stickyStyle(0, 5)}>
          {labels[0]}
        </th>
        <th className="monthlyPlanMeta" rowSpan={2} style={stickyStyle(META_COL_PX, 5)}>
          {labels[1]}
        </th>
        <th className="monthlyPlanMeta" rowSpan={2} style={stickyStyle(META_COL_PX * 2, 5)}>
          {labels[2]}
        </th>
        {days.flatMap((d) => [
          <th
            key={`${d.key}-date`}
            className={`monthlyPlanShift monthlyPlanDayHead monthlyPlanDayHeadStart${d.weekend ? " monthlyPlanWeekend" : ""}`}
            title={d.key}
          >
            <span className="monthlyPlanDayLabel">{d.label}</span>
          </th>,
          <th
            key={`${d.key}-pad`}
            className={`monthlyPlanShift monthlyPlanDayHead monthlyPlanDayEdge${d.weekend ? " monthlyPlanWeekend" : ""}`}
          />
        ])}
      </tr>
      <tr>
        {days.flatMap((d) => [
          <th
            key={`${d.key}-d`}
            className={d.weekend ? "monthlyPlanWeekend monthlyPlanShift monthlyPlanShiftEdge" : "monthlyPlanShift monthlyPlanShiftEdge"}
          >
            Д
          </th>,
          <th
            key={`${d.key}-e`}
            className={d.weekend ? "monthlyPlanWeekend monthlyPlanShift monthlyPlanDayEdge" : "monthlyPlanShift monthlyPlanDayEdge"}
          >
            Н
          </th>
        ])}
      </tr>
    </thead>
  );
}

export function MonthlyBasePlanPanel(props: {
  q: { isLoading: boolean; error: Error | null; data?: MonthlyBasePlanResponse };
  filters: AnalyticsFilters;
  periodLabel: string;
}) {
  const { q, filters, periodLabel } = props;
  const [exporting, setExporting] = useState(false);
  const data = q.data;

  const events = useMemo(
    () => (data?.events ?? []).filter((e) => matchFilters(e, filters)),
    [data?.events, filters]
  );

  const shops = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { workshopId: string; workshopName: string; planned: number[]; plannedWithNrc: number[] }>();
    for (const ev of events) {
      const id = ev.workshopId ?? `name:${ev.workshopName}`;
      let shop = map.get(id);
      if (!shop) {
        shop = {
          workshopId: id,
          workshopName: ev.workshopName,
          planned: data.days.map(() => 0),
          plannedWithNrc: data.days.map(() => 0)
        };
        map.set(id, shop);
      }
      for (let i = 0; i < data.days.length; i++) {
        shop.planned[i] += laborDayTotal(ev.labor[i]);
      }
    }
    const factor = data.nrcFactor;
    return Array.from(map.values())
      .map((s) => ({
        ...s,
        planned: s.planned.map((n) => Math.round(n * 10) / 10),
        plannedWithNrc: s.planned.map((n) => Math.round(n * factor * 10) / 10)
      }))
      .sort((a, b) => a.workshopName.localeCompare(b.workshopName, "ru"));
  }, [data, events]);

  const summary = useMemo(() => {
    const laborTotal = events.reduce((s, e) => s + e.laborTotal, 0);
    const factor = data?.nrcFactor ?? 1.2;
    return {
      events: events.length,
      shops: shops.length,
      laborTotal,
      laborWithNrc: laborTotal * factor,
      withPlanLines: events.filter((e) => e.laborSource === "plan_lines").length,
      withSpreadLabor: events.filter((e) => e.laborSource === "mps" || e.laborSource === "budget").length,
      withoutLabor: events.filter((e) => e.laborSource === "none").length
    };
  }, [events, shops.length, data?.nrcFactor]);

  const groups = useMemo(() => {
    const out: Array<{ hangarName: string; events: typeof events }> = [];
    for (const ev of events) {
      const last = out[out.length - 1];
      if (last && last.hangarName === ev.hangarName) last.events.push(ev);
      else out.push({ hangarName: ev.hangarName, events: [ev] });
    }
    return out;
  }, [events]);

  const onExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await exportMonthlyBasePlanExcel({
        periodLabel,
        nrcFactor: data.nrcFactor,
        days: data.days,
        events: events.map((ev) => ({
          title: ev.title,
          aircraft: ev.aircraft,
          aircraftType: ev.aircraftType,
          operatorCode: ev.operatorCode,
          hangarName: ev.hangarName,
          workshopName: ev.workshopName,
          color: ev.color,
          startAt: ev.startAt,
          endAt: ev.endAt,
          occupied: ev.occupied,
          labor: ev.labor,
          qualifications: ev.qualifications ?? { ME: 0, AV: 0, INT: 0, NDT: 0, SHOP: 0, CAB_REP: 0 }
        })),
        shops
      });
    } finally {
      setExporting(false);
    }
  };

  if (q.isLoading) return <div className="card analyticsCard">Загрузка…</div>;
  if (q.error) return <div className="error">{String((q.error as Error).message ?? q.error)}</div>;
  if (!data) return null;

  return (
    <div className="analyticsStack">
      <section className="card analyticsCard">
        <div className="analyticsModuleHead">
          <div>
            <h3>Месячный план Base</h3>
            <div className="muted">
              Слоты ТО и плановые ч/ч по дням. Ёмкость цеха в интерфейсе не хранится — пустые строки в Excel
              заполняются вручную. NRC {String(data.nrcFactor).replace(".", ",")} к объёму работ.
            </div>
          </div>
          <button
            type="button"
            className="btn ganttIconBtn"
            onClick={() => void onExport()}
            disabled={exporting || events.length === 0}
            title="Скачать Excel"
            aria-label="Скачать Excel"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 2h7l4 4v12H5z" />
              <path d="M12 2v4h4" />
              <path d="M7 14l2-4" />
              <path d="M11 14l-2-4" />
              <path d="M12.5 14h2.5" />
              <path d="M12.5 10h2.5" />
            </svg>
          </button>
        </div>
        <div className="analyticsStats">
          {[
            { label: "Визитов", value: String(summary.events) },
            { label: "Цехов", value: String(summary.shops) },
            { label: "План, ч/ч", value: fmtNum(summary.laborTotal) },
            { label: "План + NRC, ч/ч", value: fmtNum(summary.laborWithNrc), hint: `×${data.nrcFactor}` },
            {
              label: "Источник ч/ч",
              value: `${summary.withPlanLines} / ${summary.withSpreadLabor}`,
              hint: "посменно / размазано"
            }
          ].map((it) => (
            <div key={it.label} className="analyticsStat card">
              <div className="analyticsStatLabel">{it.label}</div>
              <div className="analyticsStatValue">{it.value}</div>
              {it.hint ? <div className="muted analyticsStatHint">{it.hint}</div> : null}
            </div>
          ))}
        </div>
      </section>

      {events.length === 0 ? (
        <section className="card analyticsCard">
          <div className="muted">Нет событий за период (или они скрыты фильтрами).</div>
        </section>
      ) : (
        <section className="card analyticsCard">
          <div className="monthlyPlanHScroll">
            <div className="monthlyPlanInner" style={{ width: planTableWidth(data.days.length) }}>
              <div className="monthlyPlanWrap">
                <table className="analyticsTable monthlyPlanTable" style={{ width: planTableWidth(data.days.length) }}>
                  <MonthlyPlanColgroup days={data.days} />
                  <MonthlyPlanShiftHead days={data.days} labels={["Тип ВС", "Борт", "Оператор / цех"]} />
              <tbody>
                {groups.flatMap((g) => [
                  <tr key={`h-${g.hangarName}`} className="monthlyPlanHangarRow">
                    <td colSpan={3 + data.days.length * 2}>{g.hangarName}</td>
                  </tr>,
                  ...g.events.flatMap((ev) => {
                    const titleFrom = occupiedHalfRanges(ev.occupied)[0]?.from ?? -1;
                    return [
                      <tr key={`${ev.eventId}-slot`} className="monthlyPlanSlotRow">
                        <td className="monthlyPlanSticky monthlyPlanMeta" rowSpan={2} style={stickyStyle(0, 6)}>
                          {ev.aircraftType}
                        </td>
                        <td className="monthlyPlanSticky monthlyPlanMeta monthlyPlanAcGreen" style={stickyStyle(META_COL_PX, 6)}>
                          {ev.aircraft}
                        </td>
                        <td className="monthlyPlanSticky monthlyPlanMeta monthlyPlanAcGreen" style={stickyStyle(META_COL_PX * 2, 6)}>
                          {ev.operatorCode}
                        </td>
                        {data.days.flatMap((d, i) => {
                          const occ = ev.occupied[i];
                          const halves = [
                            { on: Boolean(occ?.day), half: i * 2 },
                            { on: Boolean(occ?.evening), half: i * 2 + 1 }
                          ];
                          return halves.map((h) => {
                            const evening = h.half % 2 === 1;
                            const edgeClass = evening ? "monthlyPlanDayEdge" : "monthlyPlanShiftEdge";
                            const showTitle = h.on && h.half === titleFrom;
                            return (
                              <td
                                key={`${ev.eventId}-s-${h.half}`}
                                className={`monthlyPlanShift ${edgeClass}${h.on ? " monthlyPlanSlot" : ""}${showTitle ? " monthlyPlanSlotStart" : ""}`}
                                style={h.on ? { background: ev.color } : undefined}
                                title={h.on ? ev.title : undefined}
                              >
                                {showTitle ? (
                                  <span
                                    className={
                                      isDarkFill(ev.color)
                                        ? "monthlyPlanSlotTitle monthlyPlanSlotTitleHalo"
                                        : "monthlyPlanSlotTitle"
                                    }
                                    style={{ color: contrastTextColor(ev.color) }}
                                  >
                                    {ev.title}
                                  </span>
                                ) : null}
                              </td>
                            );
                          });
                        })}
                      </tr>,
                      <tr key={`${ev.eventId}-labor`} className="monthlyPlanLaborRow">
                        <td className="monthlyPlanSticky monthlyPlanMeta monthlyPlanAcGreen" style={stickyStyle(META_COL_PX, 6)} />
                        <td className="monthlyPlanSticky monthlyPlanMeta monthlyPlanAcGreen" style={stickyStyle(META_COL_PX * 2, 6)}>
                          {ev.workshopName}
                        </td>
                        {data.days.flatMap((d, i) => {
                          const lab = ev.labor[i];
                          return [
                            <td
                              key={`${ev.eventId}-l-${d.key}-d`}
                              className="monthlyPlanLabor monthlyPlanShift monthlyPlanShiftEdge"
                            >
                              {(lab?.day ?? 0) > 0 ? fmtNum(lab!.day) : ""}
                            </td>,
                            <td
                              key={`${ev.eventId}-l-${d.key}-e`}
                              className="monthlyPlanLabor monthlyPlanShift monthlyPlanDayEdge"
                            >
                              {(lab?.evening ?? 0) > 0 ? fmtNum(lab!.evening) : ""}
                            </td>
                          ];
                        })}
                      </tr>
                    ];
                  })
                ])}
              </tbody>
                </table>
              </div>
              {shops.length > 0 ? (
                <>
                  <h3 className="monthlyPlanShopTitle">Объём по цехам и заглушки ёмкости</h3>
                  <div className="muted monthlyPlanShopNote">
                    «План + NRC» считается автоматически. Расчётные ресурсы в этой вкладке не задаются — внесите их в
                    жёлтые ячейки Excel после выгрузки.
                  </div>
                  <div className="monthlyPlanFooterWrap">
                    <table className="analyticsTable monthlyPlanTable" style={{ width: planTableWidth(data.days.length) }}>
                      <MonthlyPlanColgroup days={data.days} />
                      <MonthlyPlanShiftHead days={data.days} labels={["Цех", "", "Показатель"]} />
                      <tbody>
                        {shops.map((s) => (
                          <tr key={`${s.workshopId}-nrc`}>
                            <td className="monthlyPlanSticky monthlyPlanMeta" style={stickyStyle(0, 6)}>
                              {s.workshopName}
                            </td>
                            <td className="monthlyPlanSticky monthlyPlanMeta" style={stickyStyle(META_COL_PX, 6)} />
                            <td className="monthlyPlanSticky monthlyPlanMeta" style={stickyStyle(META_COL_PX * 2, 6)}>
                              План + NRC
                            </td>
                            {s.plannedWithNrc.flatMap((n, i) => {
                              const d = data.days[i]!;
                              return [
                                <td
                                  key={`${s.workshopId}-n-${d.key}-d`}
                                  className="monthlyPlanLabor monthlyPlanShift monthlyPlanShiftEdge monthlyPlanDayHeadStart"
                                >
                                  {n > 0 ? <span className="monthlyPlanDayValue">{fmtNum(n)}</span> : null}
                                </td>,
                                <td
                                  key={`${s.workshopId}-n-${d.key}-e`}
                                  className="monthlyPlanLabor monthlyPlanShift monthlyPlanDayEdge"
                                />
                              ];
                            })}
                          </tr>
                        ))}
                        {shops.map((s) => (
                          <tr key={`${s.workshopId}-cap`} className="monthlyPlanStubRow">
                            <td className="monthlyPlanSticky monthlyPlanMeta" style={stickyStyle(0, 6)}>
                              {s.workshopName}
                            </td>
                            <td className="monthlyPlanSticky monthlyPlanMeta" style={stickyStyle(META_COL_PX, 6)} />
                            <td className="monthlyPlanSticky monthlyPlanMeta" style={stickyStyle(META_COL_PX * 2, 6)}>
                              Ёмкость
                            </td>
                            {data.days.flatMap((d) => [
                              <td
                                key={`${s.workshopId}-c-${d.key}-d`}
                                className="monthlyPlanStub monthlyPlanShift monthlyPlanShiftEdge"
                              >
                                —
                              </td>,
                              <td
                                key={`${s.workshopId}-c-${d.key}-e`}
                                className="monthlyPlanStub monthlyPlanShift monthlyPlanDayEdge"
                              />
                            ])}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
