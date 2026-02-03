import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet, apiPut } from "../../lib/api";

type Hangar = { id: string; name: string; code: string };
type Layout = { id: string; name: string; code: string; hangarId: string; widthMeters?: number | null; heightMeters?: number | null };
type Stand = { id: string; code: string; name: string; x: number; y: number; w: number; h: number; rotate: number };

type Reservation = {
  id: string;
  standId: string;
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
  aircraft: { tailNumber: string };
  eventType: { name: string; color?: string | null };
  layoutId?: string | null;
};

function intersects(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

export function HangarView() {
  const qc = useQueryClient();
  const [hangarId, setHangarId] = useState<string | null>(null);
  const [layoutId, setLayoutId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState(() => dayjs().add(14, "day").format("YYYY-MM-DD"));

  const from = useMemo(() => dayjs(fromDate).startOf("day").toISOString(), [fromDate]);
  const to = useMemo(() => dayjs(toDate).endOf("day").toISOString(), [toDate]);

  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Hangar[]>("/api/ref/hangars")
  });

  const layoutsQ = useQuery({
    queryKey: ["ref", "layouts", hangarId],
    queryFn: () => apiGet<Layout[]>(`/api/ref/layouts?hangarId=${encodeURIComponent(hangarId ?? "")}`),
    enabled: !!hangarId
  });

  const layoutDetailQ = useQuery({
    queryKey: ["layout", layoutId],
    queryFn: () => apiGet<{ id: string; widthMeters?: number | null; heightMeters?: number | null; stands: Stand[] }>(`/api/ref/layouts/${layoutId}`),
    enabled: !!layoutId
  });

  const eventsQ = useQuery({
    queryKey: ["events", from, to],
    queryFn: () => apiGet<EventRow[]>(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: !!layoutId
  });

  const reservationsQ = useQuery({
    queryKey: ["reservations", layoutId, from, to],
    queryFn: () => apiGet<Reservation[]>(`/api/reservations?layoutId=${encodeURIComponent(layoutId!)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: !!layoutId
  });

  const reserveM = useMutation({
    mutationFn: (payload: { eventId: string; standId: string; layoutId: string }) =>
      apiPut(`/api/reservations/by-event/${payload.eventId}`, { standId: payload.standId, layoutId: payload.layoutId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["reservations", layoutId, from, to] });
      await qc.invalidateQueries({ queryKey: ["events", from, to] });
    }
  });

  // авто‑выбор первого ангара/варианта
  useEffect(() => {
    if (!hangarId && (hangarsQ.data?.length ?? 0) > 0) {
      setHangarId(hangarsQ.data![0]!.id);
    }
  }, [hangarId, hangarsQ.data]);

  useEffect(() => {
    if (!layoutId && (layoutsQ.data?.length ?? 0) > 0) {
      setLayoutId(layoutsQ.data![0]!.id);
    }
  }, [layoutId, layoutsQ.data]);

  const stands = layoutDetailQ.data?.stands ?? [];
  const width = layoutDetailQ.data?.widthMeters ?? 60;
  const height = layoutDetailQ.data?.heightMeters ?? 40;

  const selectedEvent = useMemo(() => (eventsQ.data ?? []).find((e) => e.id === selectedEventId) ?? null, [eventsQ.data, selectedEventId]);

  const occupancyByStand = useMemo(() => {
    const res = reservationsQ.data ?? [];
    const map = new Map<string, Reservation[]>();
    for (const r of res) {
      const arr = map.get(r.standId) ?? [];
      arr.push(r);
      map.set(r.standId, arr);
    }
    return map;
  }, [reservationsQ.data]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="row">
          <strong>Ангар (схема расстановки)</strong>
          <span className="muted">Клик по месту — назначить выбранное событие.</span>
        </div>
        <div className="row">
          <label className="row">
            <span className="muted">Ангар</span>
            <select value={hangarId ?? ""} onChange={(e) => { setHangarId(e.target.value); setLayoutId(null); }}>
              {(hangarsQ.data ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <span className="muted">Вариант</span>
            <select value={layoutId ?? ""} onChange={(e) => setLayoutId(e.target.value)} disabled={!hangarId}>
              {(layoutsQ.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <span className="muted">c</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: 160 }} />
          </label>
          <label className="row">
            <span className="muted">по</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: 160 }} />
          </label>
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div className="row">
          <strong>Выбор события</strong>
          <span className="muted">Выберите событие в диапазоне и назначьте на место на схеме.</span>
        </div>
        <div className="row">
          <select
            value={selectedEventId ?? ""}
            onChange={(e) => setSelectedEventId(e.target.value || null)}
            style={{ minWidth: 520 }}
          >
            <option value="">— не выбрано —</option>
            {(eventsQ.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.aircraft.tailNumber} • {e.title} • {dayjs(e.startAt).format("DD.MM HH:mm")}–{dayjs(e.endAt).format(
                  "DD.MM HH:mm"
                )}
              </option>
            ))}
          </select>
          {selectedEvent ? (
            <span className="muted">
              {selectedEvent.eventType.name} • {dayjs(selectedEvent.startAt).format("DD.MM.YYYY HH:mm")} –{" "}
              {dayjs(selectedEvent.endAt).format("DD.MM.YYYY HH:mm")}
            </span>
          ) : null}
          {reserveM.error ? <span className="error">{String((reserveM.error as any).message || reserveM.error)}</span> : null}
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <strong>Схема</strong>
          <span className="muted">
            Места: {stands.length} • Резервы: {(reservationsQ.data ?? []).length}
          </span>
          <span style={{ flex: "1 1 auto" }} />
          {(layoutId && (reservationsQ.isFetching || eventsQ.isFetching)) ? <span className="muted">обновление…</span> : null}
        </div>

        {!layoutId ? (
          <div className="muted">Выберите ангар и вариант.</div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: "100%", maxHeight: 520, background: "#0b1220", borderRadius: 12 }}
          >
            <rect x="0" y="0" width={width} height={height} fill="#0b1220" />
            <rect x="0.5" y="0.5" width={width - 1} height={height - 1} fill="transparent" stroke="rgba(148,163,184,0.35)" />

            {stands.map((s) => {
              const rs = occupancyByStand.get(s.id) ?? [];
              // считаем занятость в выбранном диапазоне (в реальном UI будет "на выбранный день/момент")
              const fromMs = dayjs(from).valueOf();
              const toMs = dayjs(to).valueOf();
              const busy = rs.some((r) => intersects(dayjs(r.startAt).valueOf(), dayjs(r.endAt).valueOf(), fromMs, toMs));
              const fill = busy ? "rgba(249,115,22,0.75)" : "rgba(34,197,94,0.55)";

              const title = busy
                ? rs
                    .map(
                      (r) =>
                        `${s.code}: ${r.event.aircraft.tailNumber} • ${r.event.title} • ${dayjs(r.startAt).format("DD.MM")}–${dayjs(r.endAt).format("DD.MM")}`
                    )
                    .join("\n")
                : `${s.code}: свободно`;

              return (
                <g
                  key={s.id}
                  transform={`rotate(${s.rotate} ${s.x + s.w / 2} ${s.y + s.h / 2})`}
                  style={{ cursor: selectedEventId ? "pointer" : "default" }}
                  onClick={() => {
                    if (!selectedEventId) return;
                    reserveM.mutate({ eventId: selectedEventId, standId: s.id, layoutId: layoutId! });
                  }}
                >
                  <title>{title}</title>
                  <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="1.2" fill={fill} stroke="rgba(226,232,240,0.55)" />
                  <text
                    x={s.x + s.w / 2}
                    y={s.y + s.h / 2}
                    fill="white"
                    fontSize="2.6"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ userSelect: "none" }}
                  >
                    {s.code}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

