import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet, apiPost, apiPut } from "../../lib/api";
import { useActiveSandbox } from "../components/SandboxSwitcher";

type BodyType = "NARROW_BODY" | "WIDE_BODY" | null;
type ViewMode = "range" | "moment";

type Hangar = { id: string; name: string; code: string };
type Layout = {
  id: string;
  name: string;
  code: string;
  hangarId: string;
  capacitySummary?: string;
};
type SummaryEvent = {
  id: string;
  title: string;
  status: string;
  aircraftLabel: string;
  bodyType: BodyType;
  eventTypeName: string | null;
  startAt: string;
  endAt: string;
  reservation?: { layoutId: string; standId: string } | null;
};
type SummaryStand = {
  id: string;
  code: string;
  name: string;
  bodyType: BodyType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  utilizationPct: number;
  occupiedAt: SummaryEvent | null;
  reservations: SummaryEvent[];
};
type SummaryHangar = {
  hangar: Hangar;
  layout: {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    widthMeters?: number | null;
    heightMeters?: number | null;
    obstacles?: Array<{ type: string; x: number; y: number; w: number; h: number }> | null;
    capacityByBodyType: { narrow: number; wide: number; any: number };
  };
  utilizationPct: number;
  occupiedAtCount: number;
  freeAtCount: number | null;
  eventCount: number;
  standCount: number;
  stands: SummaryStand[];
};
type SummaryResponse = {
  ok: boolean;
  summary: { events: number; unplaced: number; incompatible: number };
  hangars: SummaryHangar[];
  unplaced: SummaryEvent[];
  incompatible: Array<{ event: SummaryEvent; suitableStandCount: number }>;
};
type AutoFitResponse = {
  ok: boolean;
  placements: Array<{
    event: SummaryEvent;
    hangarId: string;
    hangarName: string;
    layoutId: string;
    layoutName: string;
    standId: string;
    standCode: string;
  }>;
  unplaced: Array<{ event: SummaryEvent; reason: string }>;
  summary: { candidates: number; placed: number; unplaced: number };
};

function bodyTypeLabel(v: BodyType) {
  if (v === "NARROW_BODY") return "узкий";
  if (v === "WIDE_BODY") return "широкий";
  return "любой";
}

function occupancyColor(pct: number) {
  if (pct <= 0) return "rgba(34, 197, 94, 0.55)";
  if (pct < 35) return "rgba(34, 197, 94, 0.75)";
  if (pct < 65) return "rgba(234, 179, 8, 0.8)";
  if (pct < 90) return "rgba(249, 115, 22, 0.82)";
  return "rgba(239, 68, 68, 0.85)";
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return dayjs(aStart).valueOf() < dayjs(bEnd).valueOf() && dayjs(aEnd).valueOf() > dayjs(bStart).valueOf();
}

function standAccepts(stand: SummaryStand, event: SummaryEvent) {
  return !stand.bodyType || !event.bodyType || stand.bodyType === event.bodyType;
}

function formatEventPeriod(e: SummaryEvent) {
  return `${dayjs(e.startAt).format("DD.MM HH:mm")} – ${dayjs(e.endAt).format("DD.MM HH:mm")}`;
}

function ImportLayoutsPanel(props: { onDone: () => void }) {
  const [raw, setRaw] = useState("");
  const importM = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; hangars: number; layouts: number; stands: number }>("/api/ref/layouts/import", JSON.parse(raw)),
    onSuccess: () => {
      setRaw("");
      props.onDone();
    }
  });

  const sample = `{
  "hangars": [
    {
      "code": "SVO-1",
      "name": "Шереметьево Ангар 1",
      "layouts": [
        {
          "code": "BASE",
          "name": "Базовая схема",
          "widthMeters": 80,
          "heightMeters": 50,
          "obstacles": [{ "type": "rect", "x": 38, "y": 0, "w": 4, "h": 50 }],
          "stands": [
            { "code": "S1", "name": "Место 1", "bodyType": "NARROW_BODY", "x": 5, "y": 8, "w": 20, "h": 12 },
            { "code": "S2", "name": "Место 2", "bodyType": "WIDE_BODY", "x": 48, "y": 8, "w": 26, "h": 16 }
          ]
        }
      ]
    }
  ]
}`;

  return (
    <details className="hangarImport">
      <summary>Импорт реальных схем JSON</summary>
      <div className="hangarImportBody">
        <p className="muted">
          Демо-данные можно заменить пачкой: ангары обновляются по `code`, схемы по `hangar + code`, места по `layout + code`.
        </p>
        <textarea
          className="refInput"
          rows={8}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={sample}
        />
        <div className="row">
          <button className="btn btnPrimary" type="button" disabled={!raw.trim() || importM.isPending} onClick={() => importM.mutate()}>
            {importM.isPending ? "Импорт…" : "Импортировать схемы"}
          </button>
          <button className="btn" type="button" onClick={() => setRaw(sample)}>
            Вставить пример
          </button>
          {importM.isSuccess ? <span className="muted">Импорт завершён.</span> : null}
        </div>
        {importM.error ? <div className="errorMsg">{String((importM.error as any)?.message ?? importM.error)}</div> : null}
      </div>
    </details>
  );
}

export function HangarView() {
  const qc = useQueryClient();
  const { active: activeSandbox } = useActiveSandbox();
  const [viewMode, setViewMode] = useState<ViewMode>("range");
  const [fromDate, setFromDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState(() => dayjs().add(14, "day").format("YYYY-MM-DD"));
  const [minuteOffset, setMinuteOffset] = useState(12 * 60);
  const [expandedHangarId, setExpandedHangarId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [layoutIdByHangarId, setLayoutIdByHangarId] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Map<string, { layoutId: string; standId: string }>>(new Map());
  const [fitResult, setFitResult] = useState<AutoFitResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const from = useMemo(() => dayjs(fromDate).startOf("day"), [fromDate]);
  const to = useMemo(() => dayjs(toDate).endOf("day"), [toDate]);
  const totalMinutes = Math.max(0, to.diff(from, "minute"));
  const effectiveMinuteOffset = Math.min(minuteOffset, totalMinutes);
  const at = useMemo(() => from.add(effectiveMinuteOffset, "minute"), [from, effectiveMinuteOffset]);

  const hangarsQ = useQuery({ queryKey: ["ref", "hangars"], queryFn: () => apiGet<Hangar[]>("/api/ref/hangars") });
  const layoutsAllQ = useQuery({ queryKey: ["ref", "layouts", "all"], queryFn: () => apiGet<Layout[]>("/api/ref/layouts") });

  const hangars = hangarsQ.data ?? [];
  const layoutsByHangar = useMemo(() => {
    const map: Record<string, Layout[]> = {};
    for (const layout of layoutsAllQ.data ?? []) {
      if (!map[layout.hangarId]) map[layout.hangarId] = [];
      map[layout.hangarId]!.push(layout);
    }
    for (const key of Object.keys(map)) map[key]!.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return map;
  }, [layoutsAllQ.data]);

  const layoutIdPerHangar = useMemo(() => {
    const out: Record<string, string> = {};
    for (const h of hangars) {
      const list = layoutsByHangar[h.id] ?? [];
      const preferred = layoutIdByHangarId[h.id];
      out[h.id] = preferred && list.some((l) => l.id === preferred) ? preferred : list[0]?.id ?? "";
    }
    return out;
  }, [hangars, layoutsByHangar, layoutIdByHangarId]);

  const selectedLayoutIds = useMemo(() => Object.values(layoutIdPerHangar).filter(Boolean), [layoutIdPerHangar]);
  const summaryQ = useQuery({
    queryKey: ["hangar-planning", "summary", from.toISOString(), to.toISOString(), selectedLayoutIds.join(",")],
    enabled: selectedLayoutIds.length > 0,
    queryFn: () => {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        layoutIds: selectedLayoutIds.join(",")
      });
      return apiGet<SummaryResponse>(`/api/hangar-planning/summary?${params.toString()}`);
    },
    placeholderData: (prev) => prev
  });

  const summary = useMemo<SummaryResponse | undefined>(() => {
    const data = summaryQ.data;
    if (!data) return data;
    if (viewMode !== "moment") return data;

    const atMs = at.valueOf();
    return {
      ...data,
      hangars: data.hangars.map((h) => {
        let occupiedAtCount = 0;
        const stands = h.stands.map((s) => {
          const occupiedAt =
            s.reservations.find((r) => dayjs(r.startAt).valueOf() <= atMs && dayjs(r.endAt).valueOf() > atMs) ?? null;
          if (occupiedAt) occupiedAtCount += 1;
          return { ...s, occupiedAt };
        });
        return {
          ...h,
          occupiedAtCount,
          freeAtCount: Math.max(0, h.standCount - occupiedAtCount),
          stands
        };
      })
    };
  }, [summaryQ.data, viewMode, at]);
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    const all = [...(summary?.unplaced ?? []), ...(summary?.hangars ?? []).flatMap((h) => h.stands.flatMap((s) => s.reservations))];
    return all.find((e) => e.id === selectedEventId) ?? null;
  }, [summary, selectedEventId]);

  const reserveM = useMutation({
    mutationFn: async (payload: { eventId: string; layoutId: string; standId: string }) =>
      apiPut(`/api/reservations/by-event/${payload.eventId}`, {
        layoutId: payload.layoutId,
        standId: payload.standId,
        changeReason: activeSandbox ? "Сценарное размещение в песочнице" : "Сценарное размещение ангара"
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["hangar-planning"] });
      await qc.invalidateQueries({ queryKey: ["events"] });
      await qc.invalidateQueries({ queryKey: ["reservations"] });
    }
  });

  const autoFitM = useMutation({
    mutationFn: () =>
      apiPost<AutoFitResponse>("/api/hangar-planning/auto-fit", {
        from: from.toISOString(),
        to: to.toISOString(),
        layouts: hangars
          .map((h) => ({ hangarId: h.id, layoutId: layoutIdPerHangar[h.id] }))
          .filter((x) => x.layoutId)
      }),
    onSuccess: (res) => {
      setFitResult(res);
      const next = new Map(draft);
      for (const p of res.placements) next.set(p.event.id, { layoutId: p.layoutId, standId: p.standId });
      setDraft(next);
      setNotice(`Автоподбор: размещено ${res.summary.placed} из ${res.summary.candidates}.`);
    }
  });

  const applyDraft = async () => {
    const entries = Array.from(draft.entries());
    for (const [eventId, placement] of entries) {
      await reserveM.mutateAsync({ eventId, ...placement });
    }
    setDraft(new Map());
    setSelectedEventId(null);
    setFitResult(null);
    setNotice(`Применено размещений: ${entries.length}.`);
  };

  const placeOnStand = (hangar: SummaryHangar, stand: SummaryStand) => {
    if (!selectedEvent) return;
    setNotice(null);
    if (!standAccepts(stand, selectedEvent)) {
      setNotice(`Место ${stand.code} рассчитано на ${bodyTypeLabel(stand.bodyType)}, событие требует ${bodyTypeLabel(selectedEvent.bodyType)}.`);
      return;
    }
    const conflict = stand.reservations.find((r) => r.id !== selectedEvent.id && overlaps(r.startAt, r.endAt, selectedEvent.startAt, selectedEvent.endAt));
    if (conflict) {
      setNotice(`Место ${stand.code} занято: ${conflict.aircraftLabel} • ${conflict.title} (${formatEventPeriod(conflict)}).`);
      return;
    }
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(selectedEvent.id, { layoutId: hangar.layout.id, standId: stand.id });
      return next;
    });
  };

  const renderScheme = (hangar: SummaryHangar, compact: boolean) => {
    const width = hangar.layout.widthMeters ?? 80;
    const height = hangar.layout.heightMeters ?? 50;
    return (
      <svg className="hangarSchemeSvg" viewBox={`0 0 ${width} ${height}`}>
        <rect x="0" y="0" width={width} height={height} fill="#0f172a" />
        <rect x="0.5" y="0.5" width={width - 1} height={height - 1} fill="transparent" stroke="rgba(148,163,184,0.35)" strokeWidth="0.12" />
        {hangar.layout.obstacles?.map((ob, idx) =>
          ob.type === "rect" ? (
            <rect key={idx} x={ob.x} y={ob.y} width={ob.w} height={ob.h} fill="rgba(71,85,105,0.65)" stroke="rgba(226,232,240,0.3)" strokeWidth="0.08" />
          ) : null
        )}
        {hangar.stands.map((stand) => {
          const isDraft = Array.from(draft.values()).some((v) => v.layoutId === hangar.layout.id && v.standId === stand.id);
          const isBadType = Boolean(selectedEvent && !standAccepts(stand, selectedEvent));
          const occupied = viewMode === "moment" ? Boolean(stand.occupiedAt) : stand.utilizationPct > 0;
          const fill = isBadType ? "rgba(100,116,139,0.65)" : viewMode === "moment" ? (occupied ? "rgba(239,68,68,0.82)" : "rgba(34,197,94,0.72)") : occupancyColor(stand.utilizationPct);
          const title = viewMode === "moment" && stand.occupiedAt
            ? `${stand.code}: ${stand.occupiedAt.aircraftLabel} • ${stand.occupiedAt.title}`
            : `${stand.code}: ${viewMode === "moment" ? "свободно" : `${stand.utilizationPct.toFixed(0)}%`}`;
          return (
            <g key={stand.id} transform={`rotate(${stand.rotate ?? 0} ${stand.x + stand.w / 2} ${stand.y + stand.h / 2})`} onClick={() => placeOnStand(hangar, stand)} style={{ cursor: selectedEvent ? "pointer" : "default" }}>
              <title>{title}</title>
              <rect
                x={stand.x + 0.08}
                y={stand.y + 0.08}
                width={stand.w - 0.16}
                height={stand.h - 0.16}
                rx="0.35"
                fill={fill}
                stroke={isDraft ? "#60a5fa" : "rgba(226,232,240,0.68)"}
                strokeWidth={isDraft ? 0.32 : 0.1}
                strokeDasharray={isDraft ? "0.45 0.25" : undefined}
              />
              <text x={stand.x + stand.w / 2} y={stand.y + stand.h / 2} fill="white" fontSize={compact ? 1.7 : 2.2} textAnchor="middle" dominantBaseline="middle" style={{ userSelect: "none", fontWeight: 700 }}>
                {stand.code}
              </text>
              {!compact ? (
                <text x={stand.x + stand.w / 2} y={stand.y + stand.h / 2 + 1.5} fill="rgba(226,232,240,0.92)" fontSize="1.15" textAnchor="middle" dominantBaseline="middle">
                  {viewMode === "moment" ? (stand.occupiedAt?.aircraftLabel ?? "free") : `${stand.utilizationPct.toFixed(0)}%`}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    );
  };

  const renderHangarCard = (hangar: SummaryHangar, expanded: boolean) => {
    const layouts = layoutsByHangar[hangar.hangar.id] ?? [];
    const cap = hangar.layout.capacityByBodyType;
    return (
      <section key={hangar.hangar.id} className={expanded ? "hangarPlanCard hangarPlanCardExpanded" : "hangarPlanCard"}>
        <header className="hangarPlanCardHead">
          <div>
            <div className="hangarPlanTitle">{hangar.hangar.name}</div>
            <div className="muted small">
              {hangar.hangar.code} · {hangar.layout.name} · мест: {hangar.standCount}
            </div>
          </div>
          <div className="hangarLoadBadge">{hangar.utilizationPct.toFixed(0)}%</div>
        </header>
        <select
          className="refInput"
          value={hangar.layout.id}
          onChange={(e) => {
            setLayoutIdByHangarId((prev) => ({ ...prev, [hangar.hangar.id]: e.target.value }));
            setDraft(new Map());
            setFitResult(null);
          }}
        >
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}{l.capacitySummary ? ` · ${l.capacitySummary}` : ""}
            </option>
          ))}
        </select>
        <div className="hangarMetrics">
          <span>Событий: <b>{hangar.eventCount}</b></span>
          <span>{viewMode === "moment" ? <>Свободно сейчас: <b>{hangar.freeAtCount ?? "—"}</b></> : <>Мест: <b>{hangar.standCount}</b></>}</span>
          <span>Узк./шир./люб.: <b>{cap.narrow}/{cap.wide}/{cap.any}</b></span>
        </div>
        <div className="hangarSchemeWrap">{renderScheme(hangar, !expanded)}</div>
      </section>
    );
  };

  const expanded = expandedHangarId ? summary?.hangars.find((h) => h.hangar.id === expandedHangarId) ?? null : null;
  const draftCount = draft.size;

  return (
    <div className="hangarPlanPage">
      <section className="hangarHero">
        <div>
          <div className="massEyebrow">Сценарное планирование</div>
          <h1>Ангары и схемы расстановки</h1>
          <p>
            Выберите схемы для ангаров, оцените загрузку за период или в конкретный момент и подготовьте размещение
            событий. {activeSandbox ? <>Активна песочница <b>{activeSandbox.name}</b>.</> : <>Рабочий контур.</>}
          </p>
        </div>
        <div className="hangarHeroStats">
          <span>Событий: <b>{summary?.summary.events ?? 0}</b></span>
          <span>Без выбранной схемы/места: <b>{summary?.summary.unplaced ?? 0}</b></span>
          <span>Не подходят по типу: <b>{summary?.summary.incompatible ?? 0}</b></span>
        </div>
      </section>

      <section className="hangarControls">
        <label className="refLabel">
          <span>Режим</span>
          <select className="refInput" value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)}>
            <option value="range">Диапазон</option>
            <option value="moment">Момент времени</option>
          </select>
        </label>
        <label className="refLabel">
          <span>С</span>
          <input className="refInput" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="refLabel">
          <span>По</span>
          <input className="refInput" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <div className="hangarPresetRow">
          {[
            ["сутки", 1],
            ["неделя", 7],
            ["месяц", 30],
            ["квартал", 90],
            ["год", 365]
          ].map(([label, days]) => (
            <button
              key={String(label)}
              className="btn btnSmall"
              type="button"
              onClick={() => {
                const start = dayjs();
                setFromDate(start.format("YYYY-MM-DD"));
                setToDate(start.add(Number(days) - 1, "day").format("YYYY-MM-DD"));
                setMinuteOffset(12 * 60);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn" type="button" onClick={() => autoFitM.mutate()} disabled={!summary || autoFitM.isPending}>
          {autoFitM.isPending ? "Подбор…" : "Подобрать схемы"}
        </button>
        <button className="btn btnPrimary" type="button" onClick={applyDraft} disabled={draftCount === 0 || reserveM.isPending}>
          Применить draft ({draftCount})
        </button>
        <button className="btn" type="button" onClick={() => { setDraft(new Map()); setFitResult(null); }} disabled={draftCount === 0}>
          Очистить draft
        </button>
      </section>

      {viewMode === "moment" ? (
        <section className="hangarSliderCard">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{at.format("DD.MM.YYYY HH:mm")}</strong>
            <span className="muted">Шаг 30 минут: прибывают и выбывают самолёты на схеме</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, totalMinutes)}
            step={30}
            value={effectiveMinuteOffset}
            onChange={(e) => setMinuteOffset(Number(e.target.value))}
          />
        </section>
      ) : null}

      <ImportLayoutsPanel onDone={() => { void qc.invalidateQueries({ queryKey: ["ref"] }); void qc.invalidateQueries({ queryKey: ["hangar-planning"] }); }} />

      {notice ? <div className="contextNotice">{notice}</div> : null}
      {summaryQ.error ? <div className="errorMsg">{String((summaryQ.error as any)?.message ?? summaryQ.error)}</div> : null}
      {autoFitM.error ? <div className="errorMsg">{String((autoFitM.error as any)?.message ?? autoFitM.error)}</div> : null}

      <div className="hangarWorkspace">
        <aside className="hangarSidePanel">
          <h3>События для размещения</h3>
          <div className="muted small">Выберите событие, затем место на схеме.</div>
          <div className="hangarEventList">
            {(summary?.unplaced ?? []).length === 0 ? <div className="muted">Нет неразмещённых событий.</div> : null}
            {(summary?.unplaced ?? []).map((event) => (
              <button
                key={event.id}
                className={selectedEventId === event.id ? "hangarEventItem active" : "hangarEventItem"}
                type="button"
                onClick={() => setSelectedEventId(event.id)}
              >
                <b>{event.aircraftLabel}</b>
                <span>{event.title}</span>
                <small>{formatEventPeriod(event)} · {bodyTypeLabel(event.bodyType)}</small>
              </button>
            ))}
          </div>

          {fitResult ? (
            <div className="hangarFitBox">
              <div className="hangarFitHead">
                <b>Предложенные размещения</b>
                <span>{fitResult.summary.placed}/{fitResult.summary.candidates}</span>
              </div>
              {fitResult.placements.length === 0 ? (
                <div className="muted small">Подходящих свободных мест не найдено.</div>
              ) : (
                <div className="hangarFitList">
                  {fitResult.placements.map((p) => (
                    <button
                      key={p.event.id}
                      className="hangarFitItem"
                      type="button"
                      onClick={() => {
                        setSelectedEventId(p.event.id);
                        setExpandedHangarId(p.hangarId);
                      }}
                      title="Открыть ангар с предложенным местом"
                    >
                      <span>
                        <b>{p.event.aircraftLabel}</b> · {p.event.title}
                      </span>
                      <small>
                        {p.hangarName} · {p.layoutName} · место {p.standCode}
                      </small>
                      <small>{formatEventPeriod(p.event)} · {bodyTypeLabel(p.event.bodyType)}</small>
                    </button>
                  ))}
                </div>
              )}
              {fitResult.unplaced.length > 0 ? (
                <details className="hangarFitUnplaced">
                  <summary>Не размещено: {fitResult.unplaced.length}</summary>
                  <div className="hangarFitList">
                    {fitResult.unplaced.map((x) => (
                      <div key={x.event.id} className="hangarFitMiss">
                        <b>{x.event.aircraftLabel} · {x.event.title}</b>
                        <small>{x.reason}</small>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </aside>

        <main className="hangarMainPanel">
          {expanded ? (
            <>
              <button className="btn" type="button" onClick={() => setExpandedHangarId(null)}>Назад к карточкам</button>
              {renderHangarCard(expanded, true)}
            </>
          ) : (
            <div className="hangarCardsGrid">
              {(summary?.hangars ?? []).map((h) => (
                <div key={h.hangar.id} onDoubleClick={() => setExpandedHangarId(h.hangar.id)}>
                  {renderHangarCard(h, false)}
                </div>
              ))}
            </div>
          )}

          {!summaryQ.isLoading && (summary?.hangars ?? []).length === 0 ? (
            <div className="sandboxesEmpty">Нет активных схем. Добавьте или импортируйте реальные варианты расстановок.</div>
          ) : null}
          {summaryQ.isLoading ? <div className="muted">Загрузка аналитики ангаров…</div> : null}
        </main>
      </div>
    </div>
  );
}
