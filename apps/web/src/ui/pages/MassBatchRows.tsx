import { memo, useMemo } from "react";

import type { MassPlanBatchRow, MassScheduleMode } from "../../lib/massPlanBatch";
import { LINE_BASE_LABEL, lineBaseAfterWorkshopChange, parseLineBase, type LineBase } from "../../lib/lineBase";

type Operator = { id: string; name: string };
type AircraftType = { id: string; name: string; icaoType?: string | null };
type EventType = { id: string; name: string };
type Workshop = { id: string; code: string; name: string; defaultLineBase?: LineBase | null; isActive?: boolean };

type Catalogs = {
  operators: Operator[];
  aircraftTypes: AircraftType[];
  eventTypes: EventType[];
  workshops: Workshop[];
};

type RowProps = {
  index: number;
  row: MassPlanBatchRow;
  catalogs: Catalogs;
  onUpdate: (id: string, patch: Partial<MassPlanBatchRow>) => void;
  onRemove: (id: string) => void;
};

const BatchRowCard = memo(function BatchRowCard(props: RowProps) {
  const { index, row, catalogs, onUpdate, onRemove } = props;
  const { operators, aircraftTypes, eventTypes, workshops } = catalogs;
  const unresolved = row.unresolved;

  return (
    <div className="massBatchRowCard">
      <div className="massBatchRowGrid">
        <div className="massBatchRowIndex">{index + 1}</div>
        <label className={row.operatorId ? "massField" : "massField massFieldInvalid"} title={unresolved?.operator ? `Не найден оператор «${unresolved.operator}»` : undefined}>
          <span className="muted">Оператор</span>
          <select
            value={row.operatorId}
            aria-invalid={!row.operatorId}
            onChange={(e) => onUpdate(row.id, { operatorId: e.target.value })}
            required
          >
            <option value="">{unresolved?.operator ? `не найден: ${unresolved.operator}` : "—"}</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <label className={row.aircraftTypeId ? "massField" : "massField massFieldInvalid"} title={unresolved?.aircraftType ? `Не найден тип ВС «${unresolved.aircraftType}»` : undefined}>
          <span className="muted">Тип ВС</span>
          <select
            value={row.aircraftTypeId}
            aria-invalid={!row.aircraftTypeId}
            onChange={(e) => onUpdate(row.id, { aircraftTypeId: e.target.value })}
            required
          >
            <option value="">{unresolved?.aircraftType ? `не найден: ${unresolved.aircraftType}` : "—"}</option>
            {aircraftTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.icaoType ? ` (${t.icaoType})` : ""}</option>
            ))}
          </select>
        </label>
        <label className={row.eventTypeId ? "massField" : "massField massFieldInvalid"} title={unresolved?.eventType ? `Не найден вид события «${unresolved.eventType}»` : undefined}>
          <span className="muted">Вид события</span>
          <select
            value={row.eventTypeId}
            aria-invalid={!row.eventTypeId}
            onChange={(e) => onUpdate(row.id, { eventTypeId: e.target.value })}
            required
          >
            <option value="">{unresolved?.eventType ? `не найден: ${unresolved.eventType}` : "—"}</option>
            {eventTypes.map((et) => (
              <option key={et.id} value={et.id}>{et.name}</option>
            ))}
          </select>
        </label>
        <label className="massField">
          <span className="muted">Ответственный цех</span>
          <select
            value={row.workshopId}
            onChange={(e) =>
              onUpdate(row.id, {
                workshopId: e.target.value,
                lineBase: lineBaseAfterWorkshopChange(e.target.value, workshops, row.lineBase)
              })
            }
          >
            <option value="">—</option>
            {workshops
              .filter((w) => w.isActive !== false || w.id === row.workshopId)
              .map((w) => (
                <option key={w.id} value={w.id}>{w.code ? `${w.code} • ${w.name}` : w.name}</option>
              ))}
          </select>
        </label>
        <label className="massField">
          <span className="muted">L/B</span>
          <select
            value={row.lineBase}
            onChange={(e) => onUpdate(row.id, { lineBase: parseLineBase(e.target.value) ?? "" })}
          >
            <option value="">—</option>
            <option value="LINE">{LINE_BASE_LABEL.LINE}</option>
            <option value="BASE">{LINE_BASE_LABEL.BASE}</option>
          </select>
        </label>
        <label className="massField">
          <span className="muted">TAT, ч</span>
          <input type="number" min={1} max={8760} value={row.tatHours} onChange={(e) => onUpdate(row.id, { tatHours: Number(e.target.value) || 1 })} />
        </label>
        <label className="massField">
          <span className="muted">Кол-во</span>
          <input type="number" min={1} max={200} value={row.count} onChange={(e) => onUpdate(row.id, { count: Number(e.target.value) || 1 })} />
        </label>
        <label className="massField" title="scheduleMode: компактно, последовательно или фиксированный шаг">
          <span className="muted">Режим</span>
          <select
            value={row.scheduleMode}
            onChange={(e) => onUpdate(row.id, { scheduleMode: e.target.value as MassScheduleMode })}
          >
            <option value="compact">Компактно</option>
            <option value="sequential">Последовательно</option>
            <option value="fixedCadence">Фикс. шаг</option>
          </select>
        </label>
        <label className="massField" title="spacingHours: пауза между событиями, ч. Используется в режиме «Последовательно».">
          <span className="muted">Пауза, ч</span>
          <input
            type="number"
            min={0}
            max={8760}
            value={row.spacingHours}
            onChange={(e) => onUpdate(row.id, { spacingHours: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label
          className={row.scheduleMode === "fixedCadence" && !(row.cadenceHours > 0) ? "massField massFieldInvalid" : "massField"}
          title="cadenceHours: шаг запуска, ч. Обязателен в режиме «Фиксированный шаг»."
        >
          <span className="muted">Шаг, ч</span>
          <input
            type="number"
            min={0}
            max={8760}
            aria-invalid={row.scheduleMode === "fixedCadence" && !(row.cadenceHours > 0)}
            value={row.cadenceHours}
            onChange={(e) => onUpdate(row.id, { cadenceHours: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label className={row.startFrom ? "massField" : "massField massFieldInvalid"}>
          <span className="muted">Начало периода</span>
          <input type="date" aria-invalid={!row.startFrom} value={row.startFrom} onChange={(e) => onUpdate(row.id, { startFrom: e.target.value })} />
        </label>
        <label className={row.endTo ? "massField" : "massField massFieldInvalid"}>
          <span className="muted">Крайний старт</span>
          <input type="date" aria-invalid={!row.endTo} value={row.endTo} onChange={(e) => onUpdate(row.id, { endTo: e.target.value })} />
        </label>
        <label className="massField">
          <span className="muted">Шаблон названия</span>
          <input value={row.titleTemplate} onChange={(e) => onUpdate(row.id, { titleTemplate: e.target.value })} placeholder="% = номер" />
        </label>
        <button
          type="button"
          className="btn btnGhost massBatchDeleteButton"
          onClick={() => onRemove(row.id)}
          title="Удалить строку"
          aria-label="Удалить строку"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7h14" />
            <path d="M10 11v6M14 11v6" />
            <path d="M8 7l1-3h6l1 3" />
            <path d="M7 7l1 13h8l1-13" />
          </svg>
        </button>
      </div>
    </div>
  );
});

export const MassBatchRows = memo(function MassBatchRows(props: {
  rows: MassPlanBatchRow[];
  operators: Operator[];
  aircraftTypes: AircraftType[];
  eventTypes: EventType[];
  workshops: Workshop[];
  onUpdate: (id: string, patch: Partial<MassPlanBatchRow>) => void;
  onRemove: (id: string) => void;
}) {
  const catalogs = useMemo<Catalogs>(
    () => ({
      operators: props.operators,
      aircraftTypes: props.aircraftTypes,
      eventTypes: props.eventTypes,
      workshops: props.workshops
    }),
    [props.operators, props.aircraftTypes, props.eventTypes, props.workshops]
  );

  return (
    <div className="massBatchRows">
      <div className="massBatchHead" aria-hidden="true">
        <div className="massBatchRowGrid">
          <span>#</span>
          <span>Оператор</span>
          <span>Тип ВС</span>
          <span>Событие</span>
          <span>Цех</span>
          <span>L/B</span>
          <span>TAT</span>
          <span>Кол-во</span>
          <span title="scheduleMode">Режим</span>
          <span title="spacingHours — пауза между событиями, ч">Пауза</span>
          <span title="cadenceHours — шаг запуска, ч">Шаг</span>
          <span>Начало</span>
          <span>Крайний старт</span>
          <span>Название</span>
          <span />
        </div>
      </div>
      {props.rows.map((row, idx) => (
        <BatchRowCard
          key={row.id}
          index={idx}
          row={row}
          catalogs={catalogs}
          onUpdate={props.onUpdate}
          onRemove={props.onRemove}
        />
      ))}
    </div>
  );
});
