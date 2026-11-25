import { useMemo, useState, type ReactNode } from "react";

import { apiPost } from "../../lib/api";
import { fromInputMskOptional, nextTowEndLocal } from "../../lib/localDate";
import { SingleSelectDropdown } from "../components/SingleSelectDropdown";
import type { TowPlanRow } from "./TowPlanGrid";

function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function TowActionBar({
  canWrite,
  dirty,
  selected,
  canDuplicate,
  canDelete,
  canSkip,
  skipClears,
  pending,
  onCreate,
  onDuplicate,
  onSave,
  onUndo,
  onDelete,
  onSkip
}: {
  canWrite: boolean;
  dirty: number;
  selected: number;
  canDuplicate: boolean;
  canDelete: boolean;
  canSkip: boolean;
  skipClears: boolean;
  pending: boolean;
  onCreate: () => void;
  onDuplicate: () => void;
  onSave: () => void;
  onUndo: () => void;
  onDelete: () => void;
  onSkip: () => void;
}) {
  if (!canWrite) return null;
  const skipLabel = skipClears ? "Вернуть в реестр" : "Не требуется";
  return (
    <div className="towGridActionBar">
      <button className="btn btnPrimary towGridIconBtn" type="button" disabled={pending} onClick={onCreate} aria-label="Создать буксировку" title="Создать буксировку">
        <ActionIcon>
          <path d="M12 5v14M5 12h14" />
        </ActionIcon>
      </button>
      <button className="btn towGridIconBtn" type="button" disabled={pending || !canDuplicate} onClick={onDuplicate} aria-label="Дублировать" title="Дублировать">
        <ActionIcon>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M4 16V6a2 2 0 0 1 2-2h10" />
        </ActionIcon>
      </button>
      <button className="btn towGridIconBtn" type="button" disabled={pending || !canSkip} onClick={onSkip} aria-label={skipLabel} title={skipLabel}>
        <ActionIcon>
          {skipClears ? (
            <>
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
              <circle cx="12" cy="12" r="2.5" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="8" />
              <path d="M7 17 17 7" />
            </>
          )}
        </ActionIcon>
      </button>
      <button className="btn btnDanger towGridIconBtn" type="button" disabled={pending || !canDelete} onClick={onDelete} aria-label="Удалить" title="Удалить">
        <ActionIcon>
          <path d="M4 7h16" />
          <path d="M9 7V5h6v2" />
          <path d="M7 7l1 12h8l1-12" />
        </ActionIcon>
      </button>
      <button className="btn btnPrimary towGridIconBtn" type="button" disabled={pending || dirty === 0} onClick={onSave} aria-label="Сохранить" title="Сохранить">
        <ActionIcon>
          <path d="M5 12.5 10 17l9-10" />
        </ActionIcon>
      </button>
      <button className="btn towGridIconBtn" type="button" disabled={pending || dirty === 0} onClick={onUndo} aria-label="Отменить" title="Отменить">
        <ActionIcon>
          <path d="M8 7H4v4" />
          <path d="M4 11a8 8 0 1 0 2.2-5.5L4 8" />
        </ActionIcon>
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
  const [endEdited, setEndEdited] = useState(false);
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
              <input
                className="towCreateInput"
                type="datetime-local"
                value={startLocal}
                disabled={!event}
                onChange={(event) => {
                  const value = event.target.value;
                  setStartLocal(value);
                  if (!endEdited) setEndLocal(nextTowEndLocal(startLocal, endLocal, value));
                }}
              />
            </label>
            <label className="tgField">
              <span className="tgFieldLabel">Окончание</span>
              <input
                className="towCreateInput"
                type="datetime-local"
                value={endLocal}
                disabled={!event}
                onChange={(event) => {
                  setEndEdited(true);
                  setEndLocal(event.target.value);
                }}
              />
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
