import { useRef, useState } from "react";

import { SwitchToggle } from "../components/SwitchToggle";
import { ClickRow, RecordCard } from "./FleetRefCards";

export type TowNormRow = {
  id: string;
  code: string;
  name: string;
  minutes: number;
  isActive: boolean;
};

export function TowNormsTable(props: { rows: TowNormRow[]; editingId: string; onOpen: (row: TowNormRow) => void }) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          <th>Норматив</th>
          <th>Код</th>
          <th>Минуты</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.length === 0 ? (
          <tr>
            <td colSpan={4}>
              <div className="muted">Ничего не найдено. Измените запрос или очистите поиск.</div>
            </td>
          </tr>
        ) : (
          props.rows.map((row) => (
            <ClickRow key={row.id} editing={props.editingId === row.id} onOpen={() => props.onOpen(row)}>
              <td>
                <strong>{row.name || "—"}</strong>
              </td>
              <td>{row.code ? <span className="refCodeChip">{row.code}</span> : <span className="muted">—</span>}</td>
              <td>{row.minutes}</td>
              <td>
                <span className={row.isActive === false ? "refStatus refStatusInactive" : "refStatus refStatusActive"}>
                  {row.isActive === false ? "Неактивен" : "Активен"}
                </span>
              </td>
            </ClickRow>
          ))
        )}
      </tbody>
    </table>
  );
}

export function TowNormCardModal(props: {
  code: string;
  name: string;
  minutes: number;
  isActive: boolean;
  canEdit: boolean;
  saving: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  onChange: (patch: { name?: string; minutes?: number; isActive?: boolean }) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const initial = useRef({ name: props.name, minutes: props.minutes, isActive: props.isActive });
  const [attempted, setAttempted] = useState(false);
  const name = props.name.trim();
  const nameError = !name ? "Укажите название" : name.length > 200 ? "Не длиннее 200 символов" : "";
  const minutesError =
    !Number.isInteger(props.minutes) || props.minutes < 1 || props.minutes > 1440 ? "Укажите целое число от 1 до 1440" : "";
  const valid = !nameError && !minutesError;
  const dirty =
    props.name !== initial.current.name ||
    props.minutes !== initial.current.minutes ||
    props.isActive !== initial.current.isActive;

  const submit = () => {
    setAttempted(true);
    if (!valid) return;
    props.onSave();
  };

  return (
    <RecordCard
      titleId="towNormCardTitle"
      kicker="Справочники · Нормативы буксировки"
      title={name || "Норматив буксировки"}
      subtitle={props.code || "Карточка норматива"}
      active={props.isActive}
      canEdit={props.canEdit}
      saving={props.saving}
      deleting={false}
      dirty={dirty}
      error={props.error}
      record={props.record}
      showTech={props.showTech}
      onClose={props.onClose}
      onSave={submit}
    >
      <label className="refLabel">
        <span>Название</span>
        <input
          className={`refInput${attempted && nameError ? " refInputInvalid" : ""}`}
          value={props.name}
          maxLength={200}
          autoFocus
          autoComplete="off"
          placeholder="Например, Буксировка в начале и в конце события"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(nameError)}
          onChange={(e) => props.onChange({ name: e.target.value })}
        />
        {attempted && nameError ? <span className="operatorCardFieldError">{nameError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Код</span>
        <input className="refInput" value={props.code} autoComplete="off" spellCheck={false} disabled />
      </label>
      <label className="refLabel">
        <span>Минуты</span>
        <input
          className={`refInput${attempted && minutesError ? " refInputInvalid" : ""}`}
          type="number"
          min={1}
          max={1440}
          value={Number.isFinite(props.minutes) ? props.minutes : ""}
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(minutesError)}
          onChange={(e) => props.onChange({ minutes: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
        />
        {attempted && minutesError ? <span className="operatorCardFieldError">{minutesError}</span> : null}
      </label>
      <SwitchToggle
        checked={props.isActive}
        onChange={(next) => props.onChange({ isActive: next })}
        disabled={!props.canEdit}
        label="Активен"
        hint="Активный норматив используется при создании буксировок."
      />
    </RecordCard>
  );
}
