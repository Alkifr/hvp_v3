import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import { apiDelete, apiPatch, apiPost } from "../../lib/api";
import { fromInputMskOptional, MSK_OFFSET_MINUTES, startOfMskDayIso, toInputMsk } from "../../lib/localDate";
import { buildHangarDay, chipBox, type ChipBox, type DayEvent } from "../../lib/towPlanGeometry";
import { TowWeekMatrix } from "./TowWeekMatrix";

dayjs.extend(utc);

export type PlanPlacement = DayEvent["placements"][number];
export type PlanTow = DayEvent["tows"][number] & {
  direction: string;
  occupancyEndAt: string;
  startChangeReason: string;
};
export type PlanPending = DayEvent["pending"][number];

export type PlanBoardRow = {
  eventId: string;
  title: string;
  tailNumber: string;
  startAt: string;
  endAt: string;
  hangars: DayEvent["hangars"];
  placements: DayEvent["placements"];
  tows: PlanTow[];
  pending: DayEvent["pending"];
  locked: boolean;
  aircraftType: string;
  operator: string;
  hangarNumber: string;
  actionLabel: string;
  edgeNote: string;
  minutes: number | null;
};

type PlanMode = "week" | "scale" | "day";

type EdgeResult = {
  created: Array<{ id: string }>;
  skipped: Array<{ label: string; reason: string }>;
  kept: number;
};

function mskToday(): string {
  return dayjs().utcOffset(MSK_OFFSET_MINUTES).format("YYYY-MM-DD");
}

function shiftDate(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return ymd;
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function dayBounds(ymd: string): { startMs: number; endMs: number } | null {
  const startIso = startOfMskDayIso(ymd);
  if (!startIso) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

function clock(iso: string): string {
  const value = toInputMsk(iso);
  return value ? value.replace("T", " ").slice(5) : "";
}

function roleName(role: string): string {
  if (role.endsWith("in")) return "Закатка";
  if (role.endsWith("out")) return "Выкатка";
  return "Буксировка";
}

function chipStyle(box: ChipBox): CSSProperties {
  const width = `${Math.max(box.widthPct, 0.8)}%`;
  if (box.anchor === "end") {
    const right = Math.max(0, 100 - box.leftPct - box.widthPct);
    return { right: `${right}%`, width };
  }
  return { left: `${box.leftPct}%`, width };
}

function edgeResultText(res: EdgeResult): string {
  const created = res.created?.length ?? 0;
  const skipped = (res.skipped ?? []).map((item) => `${item.label}: ${item.reason}`).filter(Boolean);
  if (created > 0 && skipped.length) return `Добавлено интервалов: ${created}. ${skipped.join("; ")}`;
  if (created > 0) return `Добавлено интервалов: ${created}.`;
  if (skipped.length) return skipped.join("; ");
  return res.kept > 0 ? "Края уже были заняты." : "Новых интервалов нет.";
}

export function TowPlanBoard({
  rows,
  canWrite,
  canGantt,
  rangeFrom,
  rangeTo,
  onOpenEvent
}: {
  rows: PlanBoardRow[];
  canWrite: boolean;
  canGantt: boolean;
  rangeFrom: string;
  rangeTo: string;
  onOpenEvent: (eventId: string) => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<PlanMode>("week");
  const [day, setDay] = useState(() => {
    const today = mskToday();
    if (today >= rangeFrom && today <= rangeTo) return today;
    return rangeFrom;
  });
  const [selectedTowId, setSelectedTowId] = useState("");
  const [notices, setNotices] = useState<Record<string, string>>({});

  useEffect(() => {
    setDay((current) => {
      if (current < rangeFrom) return rangeFrom;
      if (current > rangeTo) return rangeTo;
      return current;
    });
  }, [rangeFrom, rangeTo]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["tows-board"] });
    await qc.invalidateQueries({ queryKey: ["tows-report"] });
    await qc.invalidateQueries({ queryKey: ["events"] });
  };

  const edgeM = useMutation({
    mutationFn: (input: { eventId: string; role?: string }) =>
      apiPost<EdgeResult>(`/api/events/${input.eventId}/tows/edges`, {
        changeReason: "Буксировка",
        ...(input.role ? { role: input.role } : {})
      }),
    onSuccess: async (res, input) => {
      setNotices((prev) => ({ ...prev, [input.eventId]: edgeResultText(res) }));
      await refresh();
    },
    onError: (error, input) => {
      setNotices((prev) => ({ ...prev, [input.eventId]: String((error as Error).message ?? error) }));
    }
  });

  const selected = useMemo(() => {
    for (const row of rows) {
      const tow = row.tows.find((item) => item.id === selectedTowId);
      if (tow) return { row, tow };
    }
    return null;
  }, [rows, selectedTowId]);

  const bounds = dayBounds(day);
  const dayGroups = useMemo(
    () => (bounds ? buildHangarDay(rows, bounds.startMs, bounds.endMs) : []),
    [rows, bounds]
  );

  return (
    <section className="card towsTableCard">
      <div className="towPlanHead">
        <div className="sandboxesTabs" role="tablist" aria-label="Вид плана буксировок">
          <button type="button" role="tab" aria-selected={mode === "week"} className={mode === "week" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setMode("week")}>
            Неделя
          </button>
          <button type="button" role="tab" aria-selected={mode === "scale"} className={mode === "scale" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setMode("scale")}>
            Шкала события
          </button>
          <button type="button" role="tab" aria-selected={mode === "day"} className={mode === "day" ? "sandboxesTab active" : "sandboxesTab"} onClick={() => setMode("day")}>
            Сутки ангара
          </button>
        </div>
        {mode === "week" ? null : (
          <div className="towPlanLegend">
            <span className="towChip towChipSample towChipFilled">назначено</span>
            <span className="towChip towChipSample towChipPending">свободный край</span>
            {mode === "day" ? <span className="towChip towChipSample towChipConflict">пересечение</span> : null}
          </div>
        )}
      </div>

      {mode === "week" ? (
        <TowWeekMatrix rows={rows} canWrite={canWrite} canGantt={canGantt} rangeFrom={rangeFrom} rangeTo={rangeTo} onOpenEvent={onOpenEvent} />
      ) : null}

      {mode === "week" ? null : (
      <>
      {mode === "day" ? (
        <div className="towDayNav">
          <button className="btn" type="button" disabled={day <= rangeFrom} onClick={() => setDay((value) => shiftDate(value, -1))}>
            Предыдущие сутки
          </button>
          <label className="tgField">
            <span className="tgFieldLabel">сутки, МСК</span>
            <input type="date" min={rangeFrom} max={rangeTo} value={day} onChange={(event) => setDay(event.target.value)} />
          </label>
          <button className="btn" type="button" disabled={day >= rangeTo} onClick={() => setDay((value) => shiftDate(value, 1))}>
            Следующие сутки
          </button>
        </div>
      ) : null}

      {mode === "scale" ? (
        rows.length === 0 ? (
          <div className="muted">На Гантте нет бортов в выбранном периоде.</div>
        ) : (
          <div className="towScaleList">
            {rows.map((row) => (
              <ScaleRow
                key={row.eventId}
                row={row}
                canWrite={canWrite}
                canGantt={canGantt}
                busy={edgeM.isPending}
                notice={notices[row.eventId] ?? ""}
                selectedTow={selected?.row.eventId === row.eventId ? selected.tow : null}
                onSelectTow={setSelectedTowId}
                onSaved={async () => {
                  setSelectedTowId("");
                  await refresh();
                }}
                onOpenEvent={onOpenEvent}
                onCreateRole={(role) => edgeM.mutate({ eventId: row.eventId, role })}
                onCreateAll={() => edgeM.mutate({ eventId: row.eventId })}
              />
            ))}
          </div>
        )
      ) : dayGroups.length === 0 ? (
        <div className="muted">В эти сутки нет бортов выбранного периода.</div>
      ) : (
        <div className="towDayList">
          {dayGroups.map((group) => (
            <section key={group.hangarId} className="towDayGroup">
              <h2 className="towDayHangar">{group.hangarLabel}</h2>
              <DayAxis />
              {group.rows.map((lane) => (
                <div className="towDayRow" key={`${group.hangarId}:${lane.eventId}`}>
                  <div className="towScaleMeta">
                    <b>{lane.tailNumber}</b>
                    {lane.title ? <span className="muted">{lane.title}</span> : null}
                    {canGantt ? (
                      <button className="linkBtn" type="button" onClick={() => onOpenEvent(lane.eventId)}>
                        К событию
                      </button>
                    ) : null}
                  </div>
                  <div className="towScaleTrack towDayTrack">
                    <DayGrid />
                    {bounds
                      ? lane.chips.map((chip) => {
                          const box = chipBox(chip.startMs, chip.endMs, bounds.startMs, bounds.endMs);
                          if (!box) return null;
                          const pending = chip.kind === "pending";
                          return (
                            <button
                              key={chip.key}
                              type="button"
                              className={`towChip${pending ? " towChipPending" : " towChipFilled"}${chip.conflict ? " towChipConflict" : ""}`}
                              style={chipStyle(box)}
                              title={chip.title}
                              disabled={!canWrite || lane.locked || (pending && edgeM.isPending)}
                              onClick={() => {
                                if (pending) edgeM.mutate({ eventId: lane.eventId, role: chip.role });
                                else if (chip.towId) setSelectedTowId(chip.towId);
                              }}
                            >
                              {chip.label}
                            </button>
                          );
                        })
                      : null}
                  </div>
                  {selected?.row.eventId === lane.eventId && canWrite && !lane.locked ? (
                    <TowEditor
                      key={selected.tow.id}
                      eventId={lane.eventId}
                      tow={selected.tow}
                      onClose={() => setSelectedTowId("")}
                      onSaved={async () => {
                        setSelectedTowId("");
                        await refresh();
                      }}
                    />
                  ) : null}
                </div>
              ))}
              {noticesFor(group.rows.map((lane) => lane.eventId), notices)}
            </section>
          ))}
        </div>
      )}
      </>
      )}
    </section>
  );
}

function noticesFor(eventIds: string[], notices: Record<string, string>) {
  const lines = eventIds.map((id) => notices[id]).filter(Boolean);
  if (!lines.length) return null;
  return <div className="muted">{lines.join(" ")}</div>;
}

function DayAxis() {
  return (
    <div className="towDayAxis" aria-hidden="true">
      <span />
      <div className="towDayAxisScale">
        {[0, 6, 12, 18].map((hour) => (
          <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
            {String(hour).padStart(2, "0")}:00
          </span>
        ))}
      </div>
    </div>
  );
}

function DayGrid() {
  return (
    <>
      {[6, 12, 18].map((hour) => (
        <span key={hour} className="towDayGridLine" style={{ left: `${(hour / 24) * 100}%` }} />
      ))}
    </>
  );
}

function ScaleRow({
  row,
  canWrite,
  canGantt,
  busy,
  notice,
  selectedTow,
  onSelectTow,
  onSaved,
  onOpenEvent,
  onCreateRole,
  onCreateAll
}: {
  row: PlanBoardRow;
  canWrite: boolean;
  canGantt: boolean;
  busy: boolean;
  notice: string;
  selectedTow: PlanTow | null;
  onSelectTow: (id: string) => void;
  onSaved: () => Promise<void>;
  onOpenEvent: (eventId: string) => void;
  onCreateRole: (role: string) => void;
  onCreateAll: () => void;
}) {
  const rangeStart = Date.parse(row.startAt);
  const rangeEnd = Date.parse(row.endAt);
  const placements = row.placements.length
    ? row.placements
    : [{ id: "event", origin: "MANUAL" as const, startAt: row.startAt, endAt: row.endAt, hangarId: "", hangarLabel: row.hangarNumber, standCode: "" }];

  return (
    <article className="towScaleRow">
      <div className="towScaleMeta">
        <b>{row.tailNumber || "Борт не задан"}</b>
        <span className="muted">
          {[row.aircraftType, row.operator, row.hangarNumber].filter(Boolean).join(" · ") || "—"}
        </span>
        <span className="muted">{row.title}</span>
        {canWrite && row.actionLabel && !row.locked ? (
          <button className="btn towsEdgeBtn" type="button" disabled={busy} onClick={onCreateAll}>
            {row.actionLabel}
          </button>
        ) : null}
        {row.locked ? <span className="muted">Завершено</span> : null}
        {row.edgeNote ? <span className="muted">{row.edgeNote}</span> : null}
        {notice ? <span className="muted">{notice}</span> : null}
        {canGantt ? (
          <button className="linkBtn" type="button" onClick={() => onOpenEvent(row.eventId)}>
            К событию
          </button>
        ) : null}
      </div>
      <div className="towScaleTrack">
        {placements.map((placement) => {
          const box = chipBox(Date.parse(placement.startAt), Date.parse(placement.endAt), rangeStart, rangeEnd);
          if (!box) return null;
          const gap = placement.origin === "AUTO_GAP";
          const label = gap ? "разрыв" : placement.standCode || placement.hangarLabel || "этап";
          return (
            <div key={placement.id} className={`towPlacement${gap ? " towPlacementGap" : ""}`} style={chipStyle(box)} title={label}>
              {label}
            </div>
          );
        })}
        {row.tows.map((tow) => {
          const box = chipBox(Date.parse(tow.startAt), Date.parse(tow.endAt), rangeStart, rangeEnd);
          if (!box || !tow.id) return null;
          const label = tow.directionLabel || "Буксировка";
          return (
            <button
              key={tow.id}
              type="button"
              className={`towChip towChipFilled${selectedTow?.id === tow.id ? " towChipSelected" : ""}`}
              style={chipStyle(box)}
              title={`${label} ${tow.fromLabel} → ${tow.toLabel}, ${clock(tow.startAt)}–${clock(tow.endAt)}`}
              disabled={!canWrite || row.locked}
              onClick={() => onSelectTow(tow.id)}
            >
              {label}
            </button>
          );
        })}
        {row.pending.map((pending) => {
          const box = chipBox(Date.parse(pending.startAt), Date.parse(pending.endAt), rangeStart, rangeEnd);
          if (!box) return null;
          const label = roleName(pending.role);
          return (
            <button
              key={`${pending.role}:${pending.placementId}`}
              type="button"
              className="towChip towChipPending"
              style={chipStyle(box)}
              title={`${label} ${pending.fromLabel} → ${pending.toLabel}, ${row.minutes ?? ""} мин`}
              disabled={!canWrite || row.locked || busy}
              onClick={() => onCreateRole(pending.role)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="towScaleTimes">
        <span>{clock(row.startAt)}</span>
        <span>{clock(row.endAt)}</span>
      </div>
      {selectedTow && canWrite && !row.locked ? (
        <TowEditor key={selectedTow.id} eventId={row.eventId} tow={selectedTow} onClose={() => onSelectTow("")} onSaved={onSaved} />
      ) : null}
    </article>
  );
}

function TowEditor({
  eventId,
  tow,
  onClose,
  onSaved
}: {
  eventId: string;
  tow: PlanTow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [fromStand, setFromStand] = useState(tow.fromLabel);
  const [toStand, setToStand] = useState(tow.toLabel);
  const [startLocal, setStartLocal] = useState(toInputMsk(tow.startAt));
  const [endLocal, setEndLocal] = useState(toInputMsk(tow.endAt));
  const [occupancyLocal, setOccupancyLocal] = useState(tow.occupancyEndAt ? toInputMsk(tow.occupancyEndAt) : "");
  const [reason, setReason] = useState(tow.startChangeReason);
  const [error, setError] = useState("");

  const saveM = useMutation({
    mutationFn: async () => {
      const startChanged = startLocal !== toInputMsk(tow.startAt);
      const endChanged = endLocal !== toInputMsk(tow.endAt);
      const occupancyChanged = occupancyLocal !== (tow.occupancyEndAt ? toInputMsk(tow.occupancyEndAt) : "");
      if (startChanged && !reason.trim()) throw new Error("Укажите причину изменения времени начала буксировки");
      const startIso = fromInputMskOptional(startLocal);
      const endIso = fromInputMskOptional(endLocal);
      if ((startChanged && !startIso) || (endChanged && !endIso)) throw new Error("Укажите время буксировки");
      const occupancyIso = fromInputMskOptional(occupancyLocal);
      return apiPatch(`/api/tows/${tow.id}`, {
        fromLabel: fromStand.trim() || null,
        toLabel: toStand.trim() || null,
        startAt: startChanged && startIso ? startIso : undefined,
        endAt: endChanged && endIso ? endIso : undefined,
        occupancyEndAt: occupancyChanged ? occupancyIso : undefined,
        startChangeReason: reason.trim() || null,
        changeReason: reason.trim() || "Буксировка"
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(String((err as Error).message ?? err))
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      const query = new URLSearchParams();
      query.set("changeReason", reason.trim() || "Буксировка");
      return apiDelete(`/api/events/${eventId}/tows/${tow.id}?${query.toString()}`);
    },
    onSuccess: onSaved,
    onError: (err) => setError(String((err as Error).message ?? err))
  });

  return (
    <form
      className="towEditor"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        saveM.mutate();
      }}
    >
      <div className="towEditorTitle">Правка буксировки</div>
      <label className="tgField">
        <span className="tgFieldLabel">Откуда</span>
        <input value={fromStand} onChange={(event) => setFromStand(event.target.value)} />
      </label>
      <label className="tgField">
        <span className="tgFieldLabel">Куда</span>
        <input value={toStand} onChange={(event) => setToStand(event.target.value)} />
      </label>
      <label className="tgField">
        <span className="tgFieldLabel">Начало, МСК</span>
        <input type="datetime-local" value={startLocal} onChange={(event) => setStartLocal(event.target.value)} />
      </label>
      <label className="tgField">
        <span className="tgFieldLabel">Конец движения</span>
        <input type="datetime-local" value={endLocal} onChange={(event) => setEndLocal(event.target.value)} />
      </label>
      <label className="tgField">
        <span className="tgFieldLabel">Конец занятия МС</span>
        <input type="datetime-local" value={occupancyLocal} onChange={(event) => setOccupancyLocal(event.target.value)} />
      </label>
      <label className="tgField">
        <span className="tgFieldLabel">Причина сдвига начала</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="towEditorActions">
        <button className="btn btnPrimary" type="submit" disabled={saveM.isPending}>
          Сохранить
        </button>
        <button
          className="btn"
          type="button"
          disabled={deleteM.isPending}
          onClick={() => {
            if (window.confirm("Удалить эту буксировку?")) deleteM.mutate();
          }}
        >
          Удалить
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
    </form>
  );
}
