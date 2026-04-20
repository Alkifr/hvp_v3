import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet, apiPut } from "../../lib/api";

type Hangar = { id: string; name: string; code: string };
type Layout = {
  id: string;
  name: string;
  code: string;
  hangarId: string;
  widthMeters?: number | null;
  heightMeters?: number | null;
  capacitySummary?: string;
};
type Stand = {
  id: string;
  code: string;
  name: string;
  bodyType?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
};
type LayoutDetail = {
  id: string;
  widthMeters?: number | null;
  heightMeters?: number | null;
  stands: Stand[];
  obstacles?: Array<{ type: string; x: number; y: number; w: number; h: number }> | null;
};
type Reservation = {
  id: string;
  standId: string;
  eventId: string;
  startAt: string;
  endAt: string;
  stand: { code: string };
  event: { id: string; title: string; aircraft: { tailNumber: string }; eventType: { name: string; color?: string | null } };
};
type EventRow = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  layoutId?: string | null;
  reservation?: { standId: string; layoutId: string } | null;
  aircraft?: { tailNumber: string } | null;
  virtualAircraft?: { label?: string } | null;
  eventType: { name: string; color?: string | null };
};

function overlapMinutes(rStart: number, rEnd: number, periodStart: number, periodEnd: number): number {
  const start = Math.max(rStart, periodStart);
  const end = Math.min(rEnd, periodEnd);
  return Math.max(0, end - start) / (60 * 1000);
}

function eventAircraftLabel(ev: {
  aircraft?: { tailNumber: string } | null;
  virtualAircraft?: { label?: string } | null;
}): string {
  return ev.aircraft?.tailNumber ?? ev.virtualAircraft?.label ?? "—";
}

function fillColorByUtilization(pct: number): string {
  if (pct <= 0) return "rgba(34,197,94,0.5)";
  if (pct < 25) return "rgba(34,197,94,0.65)";
  if (pct < 50) return "rgba(234,179,8,0.7)";
  if (pct < 75) return "rgba(249,115,22,0.75)";
  return "rgba(239,68,68,0.8)";
}

export function HangarView() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"as_is" | "planning">("as_is");
  const [fromDate, setFromDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState(() => dayjs().add(14, "day").format("YYYY-MM-DD"));
  const [expandedHangarId, setExpandedHangarId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [layoutIdByHangarId, setLayoutIdByHangarId] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Map<string, { layoutId: string; standId: string }>>(new Map());

  const from = useMemo(() => dayjs(fromDate).startOf("day").toISOString(), [fromDate]);
  const to = useMemo(() => dayjs(toDate).endOf("day").toISOString(), [toDate]);
  const periodStartMs = dayjs(from).valueOf();
  const periodEndMs = dayjs(to).valueOf();
  const periodMinutes = Math.max(0, (periodEndMs - periodStartMs) / (60 * 1000));

  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Hangar[]>("/api/ref/hangars")
  });
  const layoutsAllQ = useQuery({
    queryKey: ["ref", "layouts", "all"],
    queryFn: () => apiGet<Layout[]>("/api/ref/layouts")
  });

  const hangars = hangarsQ.data ?? [];
  const layoutsByHangar = useMemo(() => {
    const map: Record<string, Layout[]> = {};
    for (const l of layoutsAllQ.data ?? []) {
      if (!map[l.hangarId]) map[l.hangarId] = [];
      map[l.hangarId].push(l);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }
    return map;
  }, [layoutsAllQ.data]);

  const layoutIdPerHangar = useMemo(() => {
    const cur: Record<string, string> = {};
    for (const h of hangars) {
      const list = layoutsByHangar[h.id];
      const preferred = layoutIdByHangarId[h.id];
      if (preferred && list?.some((l) => l.id === preferred)) {
        cur[h.id] = preferred;
      } else if (list?.length) {
        cur[h.id] = list[0].id;
      }
    }
    return cur;
  }, [hangars, layoutsByHangar, layoutIdByHangarId]);

  const layoutDetailsQueries = useQueries({
    queries: hangars.map((h) => ({
      queryKey: ["layout", layoutIdPerHangar[h.id]],
      queryFn: () => apiGet<LayoutDetail>(`/api/ref/layouts/${layoutIdPerHangar[h.id]}`),
      enabled: !!layoutIdPerHangar[h.id]
    }))
  });
  const reservationsQueries = useQueries({
    queries: hangars.map((h) => ({
      queryKey: ["reservations", layoutIdPerHangar[h.id], from, to],
      queryFn: () =>
        apiGet<Reservation[]>(
          `/api/reservations?layoutId=${encodeURIComponent(layoutIdPerHangar[h.id]!)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        ),
      enabled: !!layoutIdPerHangar[h.id]
    }))
  });

  const eventsQ = useQuery({
    queryKey: ["events", from, to],
    queryFn: () => apiGet<EventRow[]>(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: true
  });

  const eventsWithoutPlace = useMemo(() => {
    const list = eventsQ.data ?? [];
    return list.filter((e) => !e.layoutId || !e.reservation);
  }, [eventsQ.data]);

  const utilizationByLayout = useMemo(() => {
    const result: Record<
      string,
      { standPct: Map<string, number>; hangarPct: number; reservations: Reservation[] }
    > = {};
    hangars.forEach((h, i) => {
      const layoutId = layoutIdPerHangar[h.id];
      if (!layoutId) return;
      const reservations = reservationsQueries[i]?.data ?? [];
      const detail = layoutDetailsQueries[i]?.data;
      const stands = detail?.stands ?? [];
      const standPct = new Map<string, number>();
      let totalOccupied = 0;
      for (const s of stands) {
        const resOnStand = reservations.filter((r) => r.standId === s.id);
        let occupied = 0;
        for (const r of resOnStand) {
          occupied += overlapMinutes(
            dayjs(r.startAt).valueOf(),
            dayjs(r.endAt).valueOf(),
            periodStartMs,
            periodEndMs
          );
        }
        const pct = periodMinutes > 0 ? Math.min(100, (occupied / periodMinutes) * 100) : 0;
        standPct.set(s.id, pct);
        totalOccupied += occupied;
      }
      const hangarPct =
        stands.length && periodMinutes > 0
          ? Math.min(100, (totalOccupied / (stands.length * periodMinutes)) * 100)
          : 0;
      result[layoutId] = { standPct, hangarPct, reservations };
    });
    return result;
  }, [
    hangars,
    layoutIdPerHangar,
    layoutDetailsQueries,
    reservationsQueries,
    periodStartMs,
    periodEndMs,
    periodMinutes
  ]);

  const reserveM = useMutation({
    mutationFn: (payload: { eventId: string; standId: string; layoutId: string }) =>
      apiPut(`/api/reservations/by-event/${payload.eventId}`, {
        standId: payload.standId,
        layoutId: payload.layoutId
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["reservations"] });
      await qc.invalidateQueries({ queryKey: ["events", from, to] });
    }
  });

  const handleApplyDraft = async () => {
    const entries = Array.from(draft.entries());
    for (const [eventId, { layoutId, standId }] of entries) {
      await reserveM.mutateAsync({ eventId, layoutId, standId });
    }
    setDraft(new Map());
    setSelectedEventId(null);
  };

  const handleCancelDraft = () => {
    setDraft(new Map());
    setSelectedEventId(null);
  };

  const handleStandClick = (layoutId: string, standId: string, _hangarId: string) => {
    if (mode !== "planning") return;
    if (!selectedEventId) return;
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(selectedEventId, { layoutId, standId });
      return next;
    });
  };

  const draftCount = draft.size;
  const hasDraft = draftCount > 0;

  function renderPlanCard(hangar: Hangar, layoutId: string, compact: boolean) {
    const idx = hangars.findIndex((x) => x.id === hangar.id);
    const detail = layoutDetailsQueries[idx]?.data;
    const reservations = (reservationsQueries[idx]?.data ?? []) as Reservation[];
    const util = utilizationByLayout[layoutId];
    const stands = detail?.stands ?? [];
    const width = detail?.widthMeters ?? 60;
    const height = detail?.heightMeters ?? 40;
    const hangarPct = util?.hangarPct ?? 0;
    const occupancyByStand = (() => {
      const map = new Map<string, Reservation[]>();
      for (const r of reservations) {
        const arr = map.get(r.standId) ?? [];
        arr.push(r);
        map.set(r.standId, arr);
      }
      return map;
    })();

    return (
      <div key={hangar.id} className="card" style={{ display: "grid", gap: 8 }}>
        <div className="row" style={{ alignItems: "center" }}>
          <strong>{hangar.name}</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            Загрузка: {hangarPct.toFixed(0)}%
          </span>
          <span style={{ flex: "1 1 auto" }} />
          {layoutsByHangar[hangar.id]?.length > 1 ? (
            <select
              value={layoutId}
              onChange={(e) => setLayoutIdByHangarId((prev) => ({ ...prev, [hangar.id]: e.target.value }))}
              style={{ width: 160, fontSize: 12 }}
            >
              {(layoutsByHangar[hangar.id] ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div
          style={{
            background: "#0f172a",
            borderRadius: 8,
            overflow: "hidden",
            maxHeight: compact ? 220 : 400
          }}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: "100%", height: compact ? 200 : 380, display: "block" }}
          >
            <rect x="0" y="0" width={width} height={height} fill="#0f172a" />
            <rect x="0.5" y="0.5" width={width - 1} height={height - 1} fill="transparent" stroke="rgba(148,163,184,0.35)" strokeWidth="0.12" />
            {!compact &&
              Array.from({ length: Math.ceil(width / 5) + 1 }, (_, i) => i * 5).map((mx) => (
                <line key={`v${mx}`} x1={mx} y1={0} x2={mx} y2={height} stroke="rgba(148,163,184,0.1)" strokeWidth="0.06" />
              ))}
            {!compact &&
              Array.from({ length: Math.ceil(height / 5) + 1 }, (_, i) => i * 5).map((my) => (
                <line key={`h${my}`} x1={0} y1={my} x2={width} y2={my} stroke="rgba(148,163,184,0.1)" strokeWidth="0.06" />
              ))}
            {(detail as LayoutDetail | undefined)?.obstacles?.map((ob, obIdx) =>
              ob.type === "rect" ? (
                <rect
                  key={obIdx}
                  x={ob.x}
                  y={ob.y}
                  width={ob.w}
                  height={ob.h}
                  fill="rgba(71,85,105,0.5)"
                  stroke="rgba(148,163,184,0.3)"
                  strokeWidth="0.08"
                />
              ) : null
            )}
            {stands.map((s) => {
              const rs = occupancyByStand.get(s.id) ?? [];
              const pct = util?.standPct.get(s.id) ?? 0;
              const fill = fillColorByUtilization(pct);
              const isProposed = mode === "planning" && Array.from(draft.entries()).some(([, v]) => v.layoutId === layoutId && v.standId === s.id);
              const title = rs.length
                ? rs
                    .map(
                      (r) =>
                        `${s.code}: ${eventAircraftLabel(r.event)} • ${dayjs(r.startAt).format("DD.MM")}–${dayjs(r.endAt).format("DD.MM")}`
                    )
                    .join("\n") + (pct > 0 ? `\nЗагрузка: ${pct.toFixed(0)}%` : "")
                : `${s.code}: ${pct.toFixed(0)}%`;

              return (
                <g
                  key={s.id}
                  transform={`rotate(${s.rotate} ${s.x + s.w / 2} ${s.y + s.h / 2})`}
                  style={{ cursor: mode === "planning" && selectedEventId ? "pointer" : "default" }}
                  onClick={() => handleStandClick(layoutId, s.id, hangar.id)}
                >
                  <title>{title}</title>
                  <rect
                    x={s.x + 0.08}
                    y={s.y + 0.08}
                    width={s.w - 0.16}
                    height={s.h - 0.16}
                    rx="0.35"
                    fill={fill}
                    stroke={isProposed ? "rgba(59,130,246,0.95)" : "rgba(226,232,240,0.6)"}
                    strokeWidth={isProposed ? 0.2 : 0.1}
                    strokeDasharray={isProposed ? "0.4 0.3" : undefined}
                  />
                  <text
                    x={s.x + s.w / 2}
                    y={s.y + s.h / 2}
                    fill="white"
                    fontSize={compact ? 1.8 : 2.2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ userSelect: "none", fontWeight: 600 }}
                  >
                    {s.code}
                  </text>
                  {!compact && pct > 0 ? (
                    <text
                      x={s.x + s.w / 2}
                      y={s.y + s.h / 2 + 1.4}
                      fill="rgba(226,232,240,0.9)"
                      fontSize="1.2"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {pct.toFixed(0)}%
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  }

  if (expandedHangarId) {
    const hangar = hangars.find((h) => h.id === expandedHangarId);
    const layoutId = hangar ? layoutIdPerHangar[hangar.id] : null;
    if (!hangar || !layoutId) {
      setExpandedHangarId(null);
      return null;
    }
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="row">
          <button className="btn" onClick={() => setExpandedHangarId(null)}>
            Назад к обзору
          </button>
        </div>
        {renderPlanCard(hangar, layoutId, false)}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="row">
          <strong>Ангар (схема расстановки)</strong>
          <span className="muted">Все ангары, загрузка по периоду.</span>
        </div>
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <label className="row">
            <span className="muted">с</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: 140 }} />
          </label>
          <label className="row">
            <span className="muted">по</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: 140 }} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">Режим</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as "as_is" | "planning")} style={{ width: 160 }}>
              <option value="as_is">Как есть</option>
              <option value="planning">Планирование</option>
            </select>
          </label>
          {mode === "planning" && hasDraft ? (
            <>
              <button className="btn btnPrimary" onClick={() => handleApplyDraft()} disabled={reserveM.isPending}>
                Применить ({draftCount})
              </button>
              <button className="btn" onClick={handleCancelDraft} disabled={reserveM.isPending}>
                Отменить
              </button>
            </>
          ) : null}
        </div>
      </div>

      {mode === "planning" ? (
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <strong>Планирование</strong>
          <p className="muted" style={{ margin: 0 }}>
            Выберите событие и нажмите на место на схеме — назначить или перенести. События без места: {eventsWithoutPlace.length}.
          </p>
          <select
            value={selectedEventId ?? ""}
            onChange={(e) => setSelectedEventId(e.target.value || null)}
            style={{ maxWidth: 560 }}
          >
            <option value="">— выбрать событие —</option>
            {(eventsQ.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {eventAircraftLabel(e)} • {e.title} • {dayjs(e.startAt).format("DD.MM HH:mm")}–{dayjs(e.endAt).format("DD.MM HH:mm")}
                {!e.layoutId || !e.reservation ? " (без места)" : ""}
              </option>
            ))}
          </select>
          {selectedEventId ? (
            <span className="muted">
              Выбрано: {eventsQ.data?.find((e) => e.id === selectedEventId) && eventAircraftLabel(eventsQ.data.find((e) => e.id === selectedEventId)!)} •{" "}
              {eventsQ.data?.find((e) => e.id === selectedEventId)?.title}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12
        }}
      >
        {hangars.map((h) => {
          const layoutId = layoutIdPerHangar[h.id];
          if (!layoutId) return null;
          return (
            <div key={h.id} onClick={() => setExpandedHangarId(h.id)} style={{ cursor: "pointer" }}>
              {renderPlanCard(h, layoutId, true)}
            </div>
          );
        })}
      </div>
      {hangars.length === 0 && !hangarsQ.isLoading ? (
        <div className="muted">Нет ангаров. Добавьте в справочниках.</div>
      ) : null}
    </div>
  );
}
