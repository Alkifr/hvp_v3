import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiPatch, apiPost } from "../../lib/api";
import { fromInputMskOptional, startOfMskDayIso, toInputMsk } from "../../lib/localDate";
import { buildWeekEdges, mondayOfMskDay, mskDayAndMinute, weekEdgeSpan, type DayEvent, type WeekEdge } from "../../lib/towPlanGeometry";

const SCALES = [60, 30, 15, 5] as const;
const STEP_PX: Record<(typeof SCALES)[number], number> = { 60: 36, 30: 28, 15: 22, 5: 18 };
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return ymd;
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function ruDay(ymd: string): string {
  const month = Number(ymd.slice(5, 7));
  return `${Number(ymd.slice(8, 10))} ${MONTH[month - 1] ?? ""}`;
}

function registryStamp(iso: string): string {
  const local = toInputMsk(iso);
  if (!local) return "—";
  const [date, time] = local.split("T");
  if (!date || !time) return "—";
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year} ${time}`;
}

function shiftInput(local: string, deltaMin: number): string {
  const iso = fromInputMskOptional(local);
  if (!iso) return local;
  return toInputMsk(new Date(Date.parse(iso) + deltaMin * 60_000).toISOString());
}

function who(edge: WeekEdge): string {
  return edge.tailNumber || edge.title || "Борт не задан";
}

function roleName(side: WeekEdge["side"]): string {
  return side === "start" ? "закатка" : "выкатка";
}

export function TowWeekMatrix({
  rows,
  canWrite,
  canGantt,
  rangeFrom,
  rangeTo,
  onOpenEvent
}: {
  rows: Array<DayEvent & { minutes?: number | null }>;
  canWrite: boolean;
  canGantt: boolean;
  rangeFrom: string;
  rangeTo: string;
  onOpenEvent: (eventId: string) => void;
}) {
  const qc = useQueryClient();
  const boardRef = useRef<HTMLDivElement>(null);
  const [stepMin, setStepMin] = useState<(typeof SCALES)[number]>(60);
  const [weekMonday, setWeekMonday] = useState(() => initialMonday(rangeFrom, rangeTo));
  const [selectedKey, setSelectedKey] = useState("");

  useEffect(() => {
    setWeekMonday((current) => clampMonday(current, rangeFrom, rangeTo));
  }, [rangeFrom, rangeTo]);

  const weekStartMs = Date.parse(startOfMskDayIso(weekMonday) ?? "");
  const edges = useMemo(() => {
    if (!Number.isFinite(weekStartMs)) return [];
    const periodStart = Date.parse(startOfMskDayIso(rangeFrom) ?? "");
    const periodEnd = Date.parse(startOfMskDayIso(shiftYmd(rangeTo, 1)) ?? "");
    return buildWeekEdges(rows, weekStartMs).filter((edge) => {
      const at = Date.parse(edge.at);
      return Number.isFinite(periodStart) && Number.isFinite(periodEnd) ? at >= periodStart && at < periodEnd : true;
    });
  }, [rows, weekStartMs, rangeFrom, rangeTo]);
  const laid = useMemo(() => layoutEdges(edges, stepMin), [edges, stepMin]);
  const selected = edges.find((edge) => edge.key === selectedKey) ?? null;
  const days = Array.from({ length: 7 }, (_, index) => shiftYmd(weekMonday, index));

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["tows-board"] });
    await qc.invalidateQueries({ queryKey: ["tows-report"] });
    await qc.invalidateQueries({ queryKey: ["events"] });
  };

  const changeScale = (next: (typeof SCALES)[number]) => {
    const board = boardRef.current;
    const height = dayHeight(stepMin);
    const minute = board && height ? (board.scrollTop / height) * 1440 : 0;
    setStepMin(next);
    requestAnimationFrame(() => {
      const node = boardRef.current;
      if (node) node.scrollTop = (minute / 1440) * dayHeight(next);
    });
  };

  return (
    <div className="towWeek">
      <div className="towWeekBar">
        <div className="towDayNav">
          <button className="btn" type="button" disabled={weekMonday <= mondayOfMskDay(rangeFrom)!} onClick={() => setWeekMonday((value) => clampMonday(shiftYmd(value, -7), rangeFrom, rangeTo))}>
            Предыдущая неделя
          </button>
          <label className="tgField">
            <span className="tgFieldLabel">неделя с, МСК</span>
            <input
              type="date"
              min={mondayOfMskDay(rangeFrom) ?? rangeFrom}
              max={rangeTo}
              value={weekMonday}
              onChange={(event) => setWeekMonday(clampMonday(mondayOfMskDay(event.target.value) ?? weekMonday, rangeFrom, rangeTo))}
            />
          </label>
          <button className="btn" type="button" disabled={shiftYmd(weekMonday, 6) >= rangeTo} onClick={() => setWeekMonday((value) => clampMonday(shiftYmd(value, 7), rangeFrom, rangeTo))}>
            Следующая неделя
          </button>
        </div>
        <div className="sandboxesTabs" role="tablist" aria-label="Шаг шкалы">
          {SCALES.map((step) => (
            <button key={step} type="button" role="tab" aria-selected={stepMin === step} className={stepMin === step ? "sandboxesTab active" : "sandboxesTab"} onClick={() => changeScale(step)}>
              {step} мин
            </button>
          ))}
        </div>
        <div className="towPlanLegend">
          <span className="towWeekSwatch towWeekSwatchOn">буксировка есть</span>
          <span className="towWeekSwatch towWeekSwatchOff">буксировки нет</span>
        </div>
      </div>
      <p className="muted towWeekSummary">
        {ruDay(days[0]!)} – {ruDay(days[6]!)}. {edges.length} {plural(edges.length, "край", "края", "краёв")}: {edges.filter((edge) => edge.towId).length} с буксировкой, {edges.filter((edge) => !edge.towId).length} без. Красная плашка назначает буксировку, зелёная открывает правку.
      </p>
      <div className="towWeekLayout">
        <div>
          <div className="towWeekBoard" ref={boardRef}>
            {edges.length === 0 ? (
              <div className="muted">В эту неделю нет начала или конца этапа.</div>
            ) : (
              <div className="towWeekGrid">
                <div className="towWeekHead" />
                {days.map((day, index) => (
                  <div className="towWeekHead" key={day}>
                    <b>{DOW[index]}</b>
                    <span>{ruDay(day)}</span>
                  </div>
                ))}
                <div className="towWeekCol towWeekAxis" style={{ height: dayHeight(stepMin) }}>
                  <WeekTicks stepMin={stepMin} labeled />
                </div>
                {days.map((day) => (
                  <div className="towWeekCol" key={day} style={{ height: dayHeight(stepMin) }}>
                    <WeekTicks stepMin={stepMin} labeled={false} />
                    {laid
                      .filter((edge) => edge.day === day)
                      .map((edge) => (
                        <button
                          key={edge.key}
                          type="button"
                          className={`towWeekBlock${edge.towId ? " towWeekBlockOn" : " towWeekBlockOff"}${edge.long ? " towWeekBlockLong" : ""}${edge.key === selectedKey ? " towWeekBlockSelected" : ""}`}
                          style={blockStyle(edge, stepMin)}
                          disabled={edge.locked}
                          title={edge.locked ? "Событие завершено" : edge.towId ? "Изменить буксировку" : "Назначить буксировку"}
                          onClick={() => setSelectedKey(edge.key)}
                        >
                          <b>{edge.tailNumber ? edge.tailNumber.replace(/^RA-/, "") : edge.title.slice(0, 18)}</b>
                          <span>
                            {edge.towId ? `${clock(edge.towStart)}–${clock(edge.towEnd)}` : clock(edge.at)} {edge.side === "start" ? "зак" : "вык"}
                          </span>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="towWeekRegistry">
            <div className="towEditorTitle">Реестр краёв</div>
            <table className="towWeekTable">
              <thead>
                <tr>
                  <th>Край</th>
                  <th>Борт</th>
                  <th>Ангар</th>
                  <th>Начало буксировки</th>
                  <th>Окончание буксировки</th>
                </tr>
              </thead>
              <tbody>
                {laid.map((edge) => (
                  <tr key={edge.key} className={edge.key === selectedKey ? "towWeekRowSelected" : undefined} onClick={() => setSelectedKey(edge.key)}>
                    <td>
                      <span className={edge.towId ? "towWeekDotOn" : "towWeekDotOff"} />
                      {roleName(edge.side)}, {DOW[days.indexOf(edge.day)] ?? ""} {clock(edge.at)}
                    </td>
                    <td>{who(edge)}</td>
                    <td>
                      {edge.hangarLabel} {edge.standCode}
                    </td>
                    <td>{edge.towStart ? registryStamp(edge.towStart) : "—"}</td>
                    <td>{edge.towEnd ? registryStamp(edge.towEnd) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <WeekEditor
          key={selected ? `${selected.key}:${selected.towId}` : "none"}
          edge={selected}
          normMinutes={rows.find((row) => row.eventId === selected?.eventId)?.minutes ?? null}
          canWrite={canWrite && !selected?.locked}
          canGantt={canGantt}
          onOpenEvent={onOpenEvent}
          onClose={() => setSelectedKey("")}
          onSaved={refresh}
        />
      </div>
    </div>
  );
}

function WeekTicks({ stepMin, labeled }: { stepMin: number; labeled: boolean }) {
  const px = STEP_PX[stepMin as (typeof SCALES)[number]] ?? 18;
  const marks = [];
  for (let minute = 0; minute < 1440; minute += stepMin) {
    marks.push(
      <div key={minute} className={minute % 60 === 0 ? "towWeekTick" : "towWeekMinor"} style={{ top: (minute / stepMin) * px }}>
        {labeled ? <span>{`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`}</span> : null}
      </div>
    );
  }
  return <>{marks}</>;
}

function WeekEditor({
  edge,
  normMinutes,
  canWrite,
  canGantt,
  onOpenEvent,
  onClose,
  onSaved
}: {
  edge: WeekEdge | null;
  normMinutes: number | null;
  canWrite: boolean;
  canGantt: boolean;
  onOpenEvent: (eventId: string) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const norm = normMinutes && normMinutes > 0 ? normMinutes : 30;
  const edgeLocal = edge ? toInputMsk(edge.at) : "";
  const draft = edge
    ? edge.towId
      ? { from: edge.fromLabel, to: edge.toLabel, start: toInputMsk(edge.towStart), end: toInputMsk(edge.towEnd) }
      : edge.side === "start"
        ? { from: "МС", to: edge.standCode, start: edgeLocal, end: shiftInput(edgeLocal, norm) }
        : { from: edge.standCode, to: "МС", start: shiftInput(edgeLocal, -norm), end: edgeLocal }
    : { from: "", to: "", start: "", end: "" };
  const [fromStand, setFromStand] = useState(draft.from);
  const [toStand, setToStand] = useState(draft.to);
  const [startLocal, setStartLocal] = useState(draft.start);
  const [endLocal, setEndLocal] = useState(draft.end);
  const [occupancyLocal, setOccupancyLocal] = useState(edge?.occupancyEndAt ? toInputMsk(edge.occupancyEndAt) : "");
  const [reason, setReason] = useState(edge?.startChangeReason ?? "");
  const [error, setError] = useState("");

  const saveM = useMutation({
    mutationFn: async () => {
      if (!edge) return;
      const startIso = fromInputMskOptional(startLocal);
      const endIso = fromInputMskOptional(endLocal);
      if (!startIso || !endIso) throw new Error("Укажите начало и окончание буксировки");
      if (Date.parse(endIso) <= Date.parse(startIso)) throw new Error("Окончание должно быть позже начала");
      if (edge.towId) {
        const startChanged = startLocal !== toInputMsk(edge.towStart);
        const endChanged = endLocal !== toInputMsk(edge.towEnd);
        const occupancyChanged = occupancyLocal !== (edge.occupancyEndAt ? toInputMsk(edge.occupancyEndAt) : "");
        if (startChanged && !reason.trim()) throw new Error("Укажите причину изменения времени начала буксировки");
        return apiPatch(`/api/tows/${edge.towId}`, {
          fromLabel: fromStand.trim() || null,
          toLabel: toStand.trim() || null,
          startAt: startChanged ? startIso : undefined,
          endAt: endChanged ? endIso : undefined,
          occupancyEndAt: occupancyChanged ? fromInputMskOptional(occupancyLocal) : undefined,
          startChangeReason: reason.trim() || null,
          changeReason: reason.trim() || "Буксировка"
        });
      }
      return apiPost(`/api/events/${edge.eventId}/tows`, {
        startAt: startIso,
        endAt: endIso,
        placementId: edge.placementId,
        fromLabel: fromStand.trim() || null,
        toLabel: toStand.trim() || null,
        changeReason: "Буксировка"
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(String((err as Error).message ?? err))
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      if (!edge?.towId) return;
      const query = new URLSearchParams();
      query.set("changeReason", reason.trim() || "Буксировка");
      return apiDelete(`/api/events/${edge.eventId}/tows/${edge.towId}?${query.toString()}`);
    },
    onSuccess: onSaved,
    onError: (err) => setError(String((err as Error).message ?? err))
  });

  if (!edge) {
    return (
      <aside className="towWeekEditor">
        <div className="towEditorTitle">Буксировка</div>
        <p className="muted">Нажмите красную плашку, чтобы назначить буксировку, или зелёную, чтобы изменить начало и окончание.</p>
      </aside>
    );
  }

  return (
    <aside className="towWeekEditor">
      <form
        className="towEditor"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          saveM.mutate();
        }}
      >
        <div className="towEditorTitle">{edge.towId ? "Правка буксировки" : "Назначение буксировки"}</div>
        <p className="muted">
          {who(edge)} · {roleName(edge.side)} {ruDay(edge.day)} в {clock(edge.at)}
          <br />
          {edge.hangarLabel} · {edge.standCode || "место не задано"}
        </p>
        {edge.long ? <div className="muted">Интервал в базе длиннее двух часов. Здесь можно поставить короткое начало и окончание.</div> : null}
        <label className="tgField">
          <span className="tgFieldLabel">Откуда</span>
          <input value={fromStand} onChange={(event) => setFromStand(event.target.value)} disabled={!canWrite} />
        </label>
        <label className="tgField">
          <span className="tgFieldLabel">Куда</span>
          <input value={toStand} onChange={(event) => setToStand(event.target.value)} disabled={!canWrite} />
        </label>
        <label className="tgField">
          <span className="tgFieldLabel">Начало, МСК</span>
          <input type="datetime-local" value={startLocal} onChange={(event) => setStartLocal(event.target.value)} disabled={!canWrite} />
        </label>
        <label className="tgField">
          <span className="tgFieldLabel">Окончание, МСК</span>
          <input type="datetime-local" value={endLocal} onChange={(event) => setEndLocal(event.target.value)} disabled={!canWrite} />
        </label>
        {edge.towId ? (
          <>
            <label className="tgField">
              <span className="tgFieldLabel">Конец занятия МС</span>
              <input type="datetime-local" value={occupancyLocal} onChange={(event) => setOccupancyLocal(event.target.value)} disabled={!canWrite} />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Причина сдвига начала</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} disabled={!canWrite} />
            </label>
          </>
        ) : null}
        <div className="towEditorActions">
          <button className="btn btnPrimary" type="submit" disabled={!canWrite || saveM.isPending}>
            {edge.towId ? "Сохранить" : "Назначить"}
          </button>
          {edge.towId ? (
            <button
              className="btn"
              type="button"
              disabled={!canWrite || deleteM.isPending}
              onClick={() => {
                if (window.confirm("Удалить эту буксировку?")) deleteM.mutate();
              }}
            >
              Удалить
            </button>
          ) : null}
          <button className="btn" type="button" onClick={onClose}>
            Закрыть
          </button>
          {canGantt ? (
            <button className="btn" type="button" onClick={() => onOpenEvent(edge.eventId)}>
              К событию
            </button>
          ) : null}
        </div>
        {error ? <div className="error">{error}</div> : null}
        {edge.locked ? <div className="muted">Событие завершено, буксировку менять нельзя.</div> : null}
      </form>
    </aside>
  );
}

function clock(iso: string): string {
  return toInputMsk(iso).slice(11, 16);
}

function dayHeight(stepMin: number): number {
  const px = STEP_PX[stepMin as (typeof SCALES)[number]] ?? 18;
  return (1440 / stepMin) * px;
}

function blockStyle(edge: WeekEdge & { lane: number; lanes: number }, stepMin: number) {
  const span = weekEdgeSpan(edge, stepMin);
  const px = (STEP_PX[stepMin as (typeof SCALES)[number]] ?? 18) / stepMin;
  let top = span.start * px;
  let height = span.minutes * px;
  if (height < 16) height = 16;
  if (top + height > dayHeight(stepMin)) height = Math.max(16, dayHeight(stepMin) - top);
  const width = 100 / edge.lanes;
  return {
    top,
    height,
    left: `calc(${edge.lane * width}% + 2px)`,
    width: `calc(${width}% - 4px)`
  };
}

function layoutEdges(edges: WeekEdge[], stepMin: number) {
  const byDay = new Map<string, WeekEdge[]>();
  for (const edge of edges) {
    const list = byDay.get(edge.day) ?? [];
    list.push(edge);
    byDay.set(edge.day, list);
  }
  const out: Array<WeekEdge & { lane: number; lanes: number }> = [];
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => weekEdgeSpan(a, stepMin).start - weekEdgeSpan(b, stepMin).start);
    const ends: number[] = [];
    const lanes: number[] = [];
    sorted.forEach((edge) => {
      const span = weekEdgeSpan(edge, stepMin);
      const finish = Math.min(1440, span.start + span.minutes);
      let lane = ends.findIndex((end) => end <= span.start);
      if (lane < 0) {
        lane = ends.length;
        ends.push(finish);
      } else {
        ends[lane] = finish;
      }
      lanes.push(lane);
    });
    sorted.forEach((edge, index) => out.push({ ...edge, lane: lanes[index] ?? 0, lanes: Math.max(ends.length, 1) }));
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.minute - b.minute || who(a).localeCompare(who(b), "ru"));
}

function initialMonday(rangeFrom: string, rangeTo: string): string {
  const today = mskDayAndMinute(Date.now())?.day ?? rangeFrom;
  const inside = today >= rangeFrom && today <= rangeTo ? today : rangeFrom;
  return clampMonday(mondayOfMskDay(inside) ?? inside, rangeFrom, rangeTo);
}

function clampMonday(monday: string, rangeFrom: string, rangeTo: string): string {
  const first = mondayOfMskDay(rangeFrom) ?? rangeFrom;
  const last = mondayOfMskDay(rangeTo) ?? rangeTo;
  if (monday < first) return first;
  if (monday > last) return last;
  return monday;
}

function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
