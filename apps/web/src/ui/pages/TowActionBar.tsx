import { useMemo, useState } from "react";

import { apiPost } from "../../lib/api";
import { fromInputMskOptional } from "../../lib/localDate";
import { SingleSelectDropdown } from "../components/SingleSelectDropdown";
import type { TowPlanRow } from "./TowPlanGrid";

export function TowActionBar({
  canWrite,
  dirty,
  selected,
  canDelete,
  canSkip,
  skipClears,
  pending,
  onCreate,
  onSave,
  onUndo,
  onDelete,
  onSkip
}: {
  canWrite: boolean;
  dirty: number;
  selected: number;
  canDelete: boolean;
  canSkip: boolean;
  skipClears: boolean;
  pending: boolean;
  onCreate: () => void;
  onSave: () => void;
  onUndo: () => void;
  onDelete: () => void;
  onSkip: () => void;
}) {
  if (!canWrite) return null;
  return (
    <div className="towGridActionBar">
      <button className="btn btnPrimary" type="button" disabled={pending} onClick={onCreate}>
        Создать буксировку
      </button>
      <button className="btn" type="button" disabled={pending || !canSkip} onClick={onSkip}>
        {skipClears ? "Вернуть в реестр" : "Не требуется"}
      </button>
      <button className="btn btnDanger" type="button" disabled={pending || !canDelete} onClick={onDelete}>
        Удалить
      </button>
      <button className="btn btnPrimary" type="button" disabled={pending || dirty === 0} onClick={onSave}>
        Сохранить
      </button>
      <button className="btn" type="button" disabled={pending || dirty === 0} onClick={onUndo}>
        Отменить
      </button>
      {selected > 0 ? <span className="muted">Выбрано: {selected}</span> : null}
    </div>
  );
}

export function TowCreateDialog({
  events,
  onClose,
  onCreated
}: {
  events: TowPlanRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const options = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; label: string; description: string }> = [];
    for (const row of events) {
      if (!row.eventId || seen.has(row.eventId)) continue;
      seen.add(row.eventId);
      const title = row.eventTitle || row.eventType || "Событие";
      list.push({
        id: row.eventId,
        label: `${row.tailNumber || "Без борта"} · ${title}`,
        description: [row.aircraftType, row.operator, row.hangarNumber ? `ангар ${row.hangarNumber}` : "", row.skipped ? "не требуется" : ""]
          .filter(Boolean)
          .join(" · ")
      });
    }
    return list.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [events]);
  const [eventId, setEventId] = useState("");
  const [fromStand, setFromStand] = useState("");
  const [toStand, setToStand] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const event = events.find((row) => row.eventId === eventId);
  const stands = event?.standOptions?.length ? event.standOptions : ["МС"];

  const choose = (id: string) => {
    setEventId(id);
    setFromStand("");
    setToStand("");
    setError("");
  };

  const submit = async () => {
    if (!event) {
      setError("Выберите событие");
      return;
    }
    if (!fromStand.trim() || !toStand.trim() || !startLocal || !endLocal) {
      setError("Заполните откуда, куда, начало и окончание");
      return;
    }
    const startIso = fromInputMskOptional(startLocal);
    const endIso = fromInputMskOptional(endLocal);
    if (!startIso || !endIso) {
      setError("Укажите начало и окончание буксировки");
      return;
    }
    setPending(true);
    setError("");
    try {
      await apiPost(`/api/events/${event.eventId}/tows`, {
        startAt: startIso,
        endAt: endIso,
        placementId: event.placementId || null,
        fromLabel: fromStand.trim(),
        toLabel: toStand.trim(),
        changeReason: "Буксировка"
      });
      if (event.skipped) await apiPost("/api/tows/skip", { eventIds: [event.eventId], skipped: false });
      onCreated();
      onClose();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <div className="modalWindow" role="dialog" aria-label="Создать буксировку" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitle">Создать буксировку</div>
          <button className="modalClose" type="button" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modalBody">
          <label className="tgField">
            <span className="tgFieldLabel">Событие</span>
            <SingleSelectDropdown
              options={options}
              value={eventId}
              onChange={choose}
              placeholder="Найти событие периода"
              searchable
              searchPlaceholder="Борт, название, тип"
              width={480}
            />
          </label>
          <div className="towCreateFields">
            <label className="tgField">
              <span className="tgFieldLabel">Откуда</span>
              <select className="towCreateInput" value={fromStand} disabled={!event} onChange={(event) => setFromStand(event.target.value)}>
                <option value="">—</option>
                {stands.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Куда</span>
              <select className="towCreateInput" value={toStand} disabled={!event} onChange={(event) => setToStand(event.target.value)}>
                <option value="">—</option>
                {stands.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Начало</span>
              <input className="towCreateInput" type="datetime-local" value={startLocal} disabled={!event} onChange={(event) => setStartLocal(event.target.value)} />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Окончание</span>
              <input className="towCreateInput" type="datetime-local" value={endLocal} disabled={!event} onChange={(event) => setEndLocal(event.target.value)} />
            </label>
          </div>
          {error ? <div className="error">{error}</div> : null}
        </div>
        <div className="modalFooter">
          <button className="btn" type="button" disabled={pending} onClick={onClose}>
            Закрыть
          </button>
          <button className="btn btnPrimary" type="button" disabled={pending || options.length === 0} onClick={() => void submit()}>
            {pending ? "Создание…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}
