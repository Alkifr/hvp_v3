import { useEffect, useRef, useState, type ReactNode } from "react";

import { formatAircraftAge } from "../../lib/aircraftAge";
import { SwitchToggle } from "../components/SwitchToggle";

type RefOption = { id: string; label: string };

export function RecordCard(props: {
  titleId: string;
  kicker: string;
  title: string;
  subtitle: string;
  active: boolean;
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  dirty: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  wide?: boolean;
  roomy?: boolean;
  docked?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const requestClose = () => {
    if (props.saving) return;
    if (props.canEdit && props.dirty && !window.confirm("Закрыть карточку без сохранения?")) return;
    props.onClose();
  };

  useEffect(() => {
    props.onDirtyChange?.(props.dirty);
  }, [props.dirty, props.onDirtyChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const windowClass = `modalWindow operatorCard${props.docked ? " refDetailCard" : ""}${props.roomy ? " schemeCard" : props.wide && !props.docked ? " fleetCard" : ""}`;
  const card = (
      <div
        className={windowClass}
        role={props.docked ? "region" : "dialog"}
        aria-modal={props.docked ? undefined : true}
        aria-labelledby={props.titleId}
      >
        <header className="modalHeader operatorCardHeader">
          <div className="operatorCardHeading">
            <div className="operatorCardKicker">{props.kicker}</div>
            <div className="operatorCardTitleRow">
              <h2 className="operatorCardTitle" id={props.titleId}>
                {props.title}
              </h2>
              <span className={props.active ? "refStatus refStatusActive" : "refStatus refStatusInactive"}>
                {props.active ? "Активен" : "Неактивен"}
              </span>
            </div>
            <div className="operatorCardSubtitle muted">{props.subtitle}</div>
          </div>
          <button type="button" className="modalClose" onClick={requestClose} aria-label="Закрыть карточку">
            ×
          </button>
        </header>
        <form
          className="modalBody operatorCardBody"
          onSubmit={(e) => {
            e.preventDefault();
            if (!props.dirty || !props.canEdit || props.saving) return;
            props.onSave();
          }}
        >
          {props.children}
          {props.showTech && props.record ? (
            <details className="refTechDetails operatorCardTechDetails">
              <summary>Технические</summary>
              <div className="refTechBody">
                <div className="refTechId" title="ID записи">
                  <span className="muted">id:</span> <code>{props.record.id}</code>
                </div>
                <pre className="refTechJson">{JSON.stringify(props.record, null, 2)}</pre>
              </div>
            </details>
          ) : null}
          {props.error ? <div className="errorMsg">{props.error}</div> : null}
        </form>
        <footer className="modalFooter operatorCardFooter">
          <div className="operatorCardFooterStart">
            {props.canEdit && props.onDelete ? (
              <button type="button" className="btn btnDanger" disabled={props.deleting || props.saving} onClick={props.onDelete}>
                {props.deleting ? "Удаление…" : "Удалить"}
              </button>
            ) : null}
            {props.aside}
          </div>
          <div className="operatorCardFooterActions">
            <button type="button" className="btn" onClick={requestClose} disabled={props.saving}>
              {props.canEdit ? "Отмена" : "Закрыть"}
            </button>
            {props.canEdit ? (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={!props.dirty || props.saving || props.deleting}
                onClick={props.onSave}
              >
                {props.saving ? "Сохранение…" : "Сохранить"}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
  );

  if (props.docked) return card;
  return (
    <div
      className="modalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      {card}
    </div>
  );
}

export function ClickRow(props: { editing: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <tr
      className={`refRowClickable${props.editing ? " refRowEditing" : ""}`}
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpen();
        }
      }}
    >
      {props.children}
    </tr>
  );
}

export function StatusCell(props: { active: boolean }) {
  return (
    <td>
      {props.active ? (
        <span className="refStatus refStatusActive">Активен</span>
      ) : (
        <span className="refStatus refStatusInactive">Неактивен</span>
      )}
    </td>
  );
}

export type AircraftTypeRow = {
  id: string;
  name?: string | null;
  icaoType?: string | null;
  manufacturer?: string | null;
  bodyType?: string | null;
  isActive?: boolean;
};

export function AircraftTypesTable(props: {
  rows: AircraftTypeRow[];
  editingId: string;
  onOpen: (row: AircraftTypeRow) => void;
}) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          <th>Тип ВС</th>
          <th>ICAO</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.length === 0 ? (
          <tr>
            <td colSpan={3}>
              <div className="muted">Ничего не найдено. Измените запрос или очистите поиск.</div>
            </td>
          </tr>
        ) : (
          props.rows.map((row) => (
            <ClickRow key={row.id} editing={props.editingId === row.id} onOpen={() => props.onOpen(row)}>
              <td>
                <strong>{row.name || "—"}</strong>
              </td>
              <td>{row.icaoType ? <span className="refCodeChip">{row.icaoType}</span> : <span className="muted">—</span>}</td>
              <StatusCell active={row.isActive !== false} />
            </ClickRow>
          ))
        )}
      </tbody>
    </table>
  );
}

export function AircraftTypeCardModal(props: {
  mode: "create" | "edit";
  icaoType: string;
  name: string;
  manufacturer: string;
  bodyType: string;
  isActive: boolean;
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  onChange: (patch: { icaoType?: string; name?: string; manufacturer?: string; bodyType?: string; isActive?: boolean }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const initial = useRef({
    icaoType: props.icaoType,
    name: props.name,
    manufacturer: props.manufacturer,
    bodyType: props.bodyType,
    isActive: props.isActive
  });
  const [attempted, setAttempted] = useState(false);
  const icao = props.icaoType.trim();
  const nameError = !props.name.trim() ? "Укажите название" : props.name.trim().length > 200 ? "Не длиннее 200 символов" : "";
  const icaoError = icao && (icao.length < 2 || icao.length > 25) ? "От 2 до 25 символов" : "";
  const manufacturerError = props.manufacturer.trim().length > 200 ? "Не длиннее 200 символов" : "";
  const valid = !nameError && !icaoError && !manufacturerError;
  const dirty =
    props.icaoType !== initial.current.icaoType ||
    props.name !== initial.current.name ||
    props.manufacturer !== initial.current.manufacturer ||
    props.bodyType !== initial.current.bodyType ||
    props.isActive !== initial.current.isActive;

  const submit = () => {
    setAttempted(true);
    if (!valid) return;
    props.onSave();
  };

  return (
    <RecordCard
      titleId="aircraftTypeCardTitle"
      kicker="Справочники · Типы ВС"
      title={props.mode === "create" ? "Новый тип ВС" : props.name.trim() || "Тип ВС"}
      subtitle={props.mode === "create" ? "Новая карточка записи" : `ICAO ${icao || "—"}`}
      active={props.isActive}
      canEdit={props.canEdit}
      saving={props.saving}
      deleting={props.deleting}
      dirty={dirty}
      error={props.error}
      record={props.record}
      showTech={props.showTech}
      onClose={props.onClose}
      onSave={submit}
      onDelete={props.mode === "edit" ? props.onDelete : undefined}
    >
      <label className="refLabel">
        <span>Название</span>
        <input
          className={`refInput${attempted && nameError ? " refInputInvalid" : ""}`}
          value={props.name}
          maxLength={200}
          autoFocus
          autoComplete="off"
          placeholder="Например, Airbus A320"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(nameError)}
          onChange={(e) => props.onChange({ name: e.target.value })}
        />
        {attempted && nameError ? <span className="operatorCardFieldError">{nameError}</span> : null}
      </label>
      <label className="refLabel">
        <span>ICAO</span>
        <input
          className={`refInput${attempted && icaoError ? " refInputInvalid" : ""}`}
          value={props.icaoType}
          maxLength={25}
          autoComplete="off"
          spellCheck={false}
          placeholder="Например, A320"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(icaoError)}
          onChange={(e) => props.onChange({ icaoType: e.target.value })}
        />
        {attempted && icaoError ? <span className="operatorCardFieldError">{icaoError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Производитель</span>
        <input
          className={`refInput${attempted && manufacturerError ? " refInputInvalid" : ""}`}
          value={props.manufacturer}
          maxLength={200}
          autoComplete="off"
          placeholder="Например, Airbus"
          disabled={!props.canEdit}
          onChange={(e) => props.onChange({ manufacturer: e.target.value })}
        />
        {attempted && manufacturerError ? <span className="operatorCardFieldError">{manufacturerError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Тип фюзеляжа</span>
        <select
          className="refInput"
          value={props.bodyType}
          disabled={!props.canEdit}
          onChange={(e) => props.onChange({ bodyType: e.target.value })}
        >
          <option value="">— не задан —</option>
          <option value="NARROW_BODY">Узкий (A320, B737…)</option>
          <option value="WIDE_BODY">Широкий (A330, B777…)</option>
        </select>
      </label>
      <SwitchToggle
        checked={props.isActive}
        onChange={(next) => props.onChange({ isActive: next })}
        disabled={!props.canEdit}
        label="Активен"
        hint="Активные типы ВС показываются в начале списка справочника."
      />
    </RecordCard>
  );
}

export type AircraftRow = {
  id: string;
  tailNumber?: string | null;
  serialNumber?: string | null;
  isActive?: boolean;
  typeId?: string | null;
  operator?: { name?: string | null } | null;
  type?: { id?: string | null; name?: string | null; icaoType?: string | null } | null;
};

export function AircraftLibrary(props: {
  types: Array<{ id: string; name?: string | null; icaoType?: string | null }>;
  rows: AircraftRow[];
  typeId: string;
  selectedId: string;
  canAdd: boolean;
  detail: ReactNode;
  onSelectType: (id: string) => void;
  onOpen: (row: AircraftRow) => void;
  onAdd: () => void;
}) {
  const [typeQuery, setTypeQuery] = useState("");
  const [tailQuery, setTailQuery] = useState("");
  const query = typeQuery.trim().toLowerCase();
  const tail = tailQuery.trim().toLowerCase();
  const types = props.types.filter((type) => {
    if (!query) return true;
    return `${type.name ?? ""} ${type.icaoType ?? ""}`.toLowerCase().includes(query);
  });
  const rows = props.rows.filter((row) => {
    if (props.typeId && (row.typeId ?? row.type?.id) !== props.typeId) return false;
    if (!tail) return true;
    return `${row.tailNumber ?? ""} ${row.serialNumber ?? ""} ${row.operator?.name ?? ""} ${row.type?.name ?? ""} ${row.type?.icaoType ?? ""}`
      .toLowerCase()
      .includes(tail);
  });

  return (
    <div className="refAircraftAdmin">
      <div className="refAircraftStack">
        <section className="card refPickCard">
          <div className="refPickHead">
            <strong>Тип ВС</strong>
            <span className="muted">{types.length}</span>
          </div>
          <div className="refPickSearch">
            <input value={typeQuery} placeholder="Поиск типа" onChange={(e) => setTypeQuery(e.target.value)} />
          </div>
          <div className="refPickScroll">
            <button type="button" className={`refPickRow${props.typeId ? "" : " refPickRowActive"}`} onClick={() => props.onSelectType("")}>
              <span>Все типы</span>
              <span className="muted">без фильтра</span>
            </button>
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                className={`refPickRow${props.typeId === type.id ? " refPickRowActive" : ""}`}
                onClick={() => props.onSelectType(type.id)}
              >
                <span>{type.name || "—"}</span>
                <span className="muted">{type.icaoType && type.icaoType !== type.name ? type.icaoType : ""}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card refPickCard">
          <div className="refPickHead">
            <strong>Борта</strong>
            <span className="refPickHeadActions">
              <span className="muted">{rows.length}</span>
              {props.canAdd ? (
                <button type="button" className="btn btnPrimary" onClick={props.onAdd}>
                  + Добавить
                </button>
              ) : null}
            </span>
          </div>
          <div className="refPickSearch">
            <input value={tailQuery} placeholder="Поиск борта" onChange={(e) => setTailQuery(e.target.value)} />
          </div>
          <div className="refPickScroll refPickScrollTall">
            {rows.length === 0 ? (
              <div className="refPickEmpty muted">{tail ? "Ничего не найдено." : "Нет бортов для выбранного типа."}</div>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`refPickRow${props.selectedId === row.id ? " refPickRowActive" : ""}`}
                  onClick={() => props.onOpen(row)}
                >
                  <span className="refCodeChip">{row.tailNumber || "—"}</span>
                  <span>{row.operator?.name || "—"}</span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
      <div className="refAircraftDetail">{props.detail}</div>
    </div>
  );
}

export function AircraftTable(props: { rows: AircraftRow[]; editingId: string; onOpen: (row: AircraftRow) => void }) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          <th>Борт</th>
          <th>Оператор</th>
          <th>Тип ВС</th>
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
          props.rows.map((row) => {
            return (
              <ClickRow key={row.id} editing={props.editingId === row.id} onOpen={() => props.onOpen(row)}>
                <td>
                  <span className="refCodeChip">{row.tailNumber || "—"}</span>
                </td>
                <td>{row.operator?.name || <span className="muted">—</span>}</td>
                <td>{row.type?.name || "—"}</td>
                <StatusCell active={row.isActive !== false} />
              </ClickRow>
            );
          })
        )}
      </tbody>
    </table>
  );
}

export function AircraftCardModal(props: {
  mode: "create" | "edit";
  tailNumber: string;
  operatorId: string;
  typeId: string;
  serialNumber: string;
  manufactureDate: string;
  isActive: boolean;
  operators: RefOption[];
  types: RefOption[];
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  docked?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onChange: (patch: {
    tailNumber?: string;
    operatorId?: string;
    typeId?: string;
    serialNumber?: string;
    manufactureDate?: string;
    isActive?: boolean;
  }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const initial = useRef({
    tailNumber: props.tailNumber,
    operatorId: props.operatorId,
    typeId: props.typeId,
    serialNumber: props.serialNumber,
    manufactureDate: props.manufactureDate,
    isActive: props.isActive
  });
  const [attempted, setAttempted] = useState(false);
  const tail = props.tailNumber.trim();
  const tailError = !tail ? "Укажите бортовой номер" : tail.length < 2 || tail.length > 32 ? "От 2 до 32 символов" : "";
  const operatorError = !props.operatorId ? "Выберите оператора" : "";
  const typeError = !props.typeId ? "Выберите тип ВС" : "";
  const serialError = props.serialNumber.trim().length > 64 ? "Не длиннее 64 символов" : "";
  const valid = !tailError && !operatorError && !typeError && !serialError;
  const dirty =
    props.tailNumber !== initial.current.tailNumber ||
    props.operatorId !== initial.current.operatorId ||
    props.typeId !== initial.current.typeId ||
    props.serialNumber !== initial.current.serialNumber ||
    props.manufactureDate !== initial.current.manufactureDate ||
    props.isActive !== initial.current.isActive;
  const age = formatAircraftAge(props.manufactureDate);

  const submit = () => {
    setAttempted(true);
    if (!valid) return;
    props.onSave();
  };

  return (
    <RecordCard
      titleId="aircraftCardTitle"
      kicker="Справочники · Бортовые номера"
      title={props.mode === "create" ? "Новый борт" : tail || "Борт"}
      subtitle={props.mode === "create" ? "Новая карточка записи" : "Карточка борта"}
      active={props.isActive}
      canEdit={props.canEdit}
      saving={props.saving}
      deleting={props.deleting}
      dirty={dirty}
      error={props.error}
      record={props.record}
      showTech={props.showTech}
      wide
      docked={props.docked}
      onDirtyChange={props.onDirtyChange}
      onClose={props.onClose}
      onSave={submit}
      onDelete={props.mode === "edit" ? props.onDelete : undefined}
    >
      <label className="refLabel">
        <span>Бортовой номер</span>
        <input
          className={`refInput${attempted && tailError ? " refInputInvalid" : ""}`}
          value={props.tailNumber}
          maxLength={32}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Например, RA-12345"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(tailError)}
          onChange={(e) => props.onChange({ tailNumber: e.target.value })}
        />
        {attempted && tailError ? <span className="operatorCardFieldError">{tailError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Оператор</span>
        <select
          className={`refInput${attempted && operatorError ? " refInputInvalid" : ""}`}
          value={props.operatorId}
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(operatorError)}
          onChange={(e) => props.onChange({ operatorId: e.target.value })}
        >
          <option value="">— выберите —</option>
          {props.operators.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {attempted && operatorError ? <span className="operatorCardFieldError">{operatorError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Тип ВС</span>
        <select
          className={`refInput${attempted && typeError ? " refInputInvalid" : ""}`}
          value={props.typeId}
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(typeError)}
          onChange={(e) => props.onChange({ typeId: e.target.value })}
        >
          <option value="">— выберите —</option>
          {props.types.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {attempted && typeError ? <span className="operatorCardFieldError">{typeError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Зав. №</span>
        <input
          className={`refInput${attempted && serialError ? " refInputInvalid" : ""}`}
          value={props.serialNumber}
          maxLength={64}
          autoComplete="off"
          disabled={!props.canEdit}
          onChange={(e) => props.onChange({ serialNumber: e.target.value })}
        />
        {attempted && serialError ? <span className="operatorCardFieldError">{serialError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Дата производства ВС</span>
        <input
          className="refInput"
          type="date"
          value={props.manufactureDate}
          disabled={!props.canEdit}
          onChange={(e) => props.onChange({ manufactureDate: e.target.value })}
        />
      </label>
      <label className="refLabel">
        <span>Возраст ВС</span>
        <div className="operatorCardReadonly">{age ?? <span className="muted">Укажите дату производства</span>}</div>
      </label>
      <SwitchToggle
        checked={props.isActive}
        onChange={(next) => props.onChange({ isActive: next })}
        disabled={!props.canEdit}
        label="Активен"
        hint="Активные борта показываются в начале списка справочника."
      />
    </RecordCard>
  );
}

export type PaletteRow = {
  id: string;
  color?: string | null;
  isActive?: boolean;
  operator?: { name?: string | null } | null;
  aircraftType?: { name?: string | null } | null;
};

function paletteColor(raw: string) {
  const match = raw.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : "";
}

export function PaletteTable(props: { rows: PaletteRow[]; editingId: string; onOpen: (row: PaletteRow) => void }) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          <th>Оператор</th>
          <th>Тип ВС</th>
          <th>Цвет</th>
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
                <strong>{row.operator?.name || "—"}</strong>
              </td>
              <td>{row.aircraftType?.name || "—"}</td>
              <td>
                <span className="refCellTitle">
                  {row.color ? <span className="refRowSwatch" style={{ background: String(row.color) }} /> : null}
                  <span>{row.color || "—"}</span>
                </span>
              </td>
              <StatusCell active={row.isActive !== false} />
            </ClickRow>
          ))
        )}
      </tbody>
    </table>
  );
}

export function PaletteCardModal(props: {
  mode: "create" | "edit";
  operatorId: string;
  typeId: string;
  color: string;
  isActive: boolean;
  operators: RefOption[];
  types: RefOption[];
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  onChange: (patch: { operatorId?: string; typeId?: string; color?: string; isActive?: boolean }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const initial = useRef({
    operatorId: props.operatorId,
    typeId: props.typeId,
    color: props.color,
    isActive: props.isActive
  });
  const [attempted, setAttempted] = useState(false);
  const operatorLabel = props.operators.find((item) => item.id === props.operatorId)?.label ?? "";
  const typeLabel = props.types.find((item) => item.id === props.typeId)?.label ?? "";
  const color = paletteColor(props.color);
  const operatorError = !props.operatorId ? "Выберите оператора" : "";
  const typeError = !props.typeId ? "Выберите тип ВС" : "";
  const colorError = !color ? "Укажите цвет в формате #RRGGBB" : "";
  const valid = !operatorError && !typeError && !colorError;
  const dirty =
    props.operatorId !== initial.current.operatorId ||
    props.typeId !== initial.current.typeId ||
    props.color !== initial.current.color ||
    props.isActive !== initial.current.isActive;

  const submit = () => {
    setAttempted(true);
    if (!valid) return;
    props.onSave();
  };

  return (
    <RecordCard
      titleId="paletteCardTitle"
      kicker="Справочники · Палитра ВС"
      title={props.mode === "create" ? "Новая палитра" : `${operatorLabel || "Оператор"} × ${typeLabel || "Тип ВС"}`}
      subtitle={props.mode === "create" ? "Новая карточка записи" : color || "Карточка палитры"}
      active={props.isActive}
      canEdit={props.canEdit}
      saving={props.saving}
      deleting={props.deleting}
      dirty={dirty}
      error={props.error}
      record={props.record}
      showTech={props.showTech}
      onClose={props.onClose}
      onSave={submit}
      onDelete={props.mode === "edit" ? props.onDelete : undefined}
    >
      <label className="refLabel">
        <span>Оператор</span>
        <select
          className={`refInput${attempted && operatorError ? " refInputInvalid" : ""}`}
          value={props.operatorId}
          disabled={!props.canEdit}
          autoFocus
          aria-invalid={attempted && Boolean(operatorError)}
          onChange={(e) => props.onChange({ operatorId: e.target.value })}
        >
          <option value="">— выберите —</option>
          {props.operators.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {attempted && operatorError ? <span className="operatorCardFieldError">{operatorError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Тип ВС</span>
        <select
          className={`refInput${attempted && typeError ? " refInputInvalid" : ""}`}
          value={props.typeId}
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(typeError)}
          onChange={(e) => props.onChange({ typeId: e.target.value })}
        >
          <option value="">— выберите —</option>
          {props.types.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {attempted && typeError ? <span className="operatorCardFieldError">{typeError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Цвет</span>
        <div className="operatorCardColor">
          <div className="operatorCardSwatchPick">
            <input
              type="color"
              value={color || "#cccccc"}
              disabled={!props.canEdit}
              aria-label="Выбор цвета"
              onChange={(e) => props.onChange({ color: e.target.value })}
            />
            <span className="operatorCardSwatch" style={{ background: color || "#cccccc" }} />
          </div>
          <input
            className={`refInput${attempted && colorError ? " refInputInvalid" : ""}`}
            value={props.color}
            maxLength={7}
            autoComplete="off"
            spellCheck={false}
            placeholder="#RRGGBB"
            disabled={!props.canEdit}
            aria-invalid={attempted && Boolean(colorError)}
            onChange={(e) => props.onChange({ color: e.target.value })}
          />
        </div>
        {attempted && colorError ? <span className="operatorCardFieldError">{colorError}</span> : null}
      </label>
      <SwitchToggle
        checked={props.isActive}
        onChange={(next) => props.onChange({ isActive: next })}
        disabled={!props.canEdit}
        label="Активен"
        hint="Активные правила палитры используются при окраске ВС на Гантте."
      />
    </RecordCard>
  );
}

export type HangarRow = {
  id: string;
  code?: string | null;
  name?: string | null;
  station?: string | null;
  isPhysical?: boolean;
  isActive?: boolean;
};

export function HangarsTable(props: { rows: HangarRow[]; editingId: string; onOpen: (row: HangarRow) => void }) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          <th>Ангар</th>
          <th>Код</th>
          <th>Станция</th>
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
              <td>{row.station || <span className="muted">—</span>}</td>
              <td>
                <span className={row.isActive === false ? "refStatus refStatusInactive" : "refStatus refStatusActive"}>
                  {row.isActive === false ? "Неактивен" : "Активен"}
                </span>
                {row.isPhysical === false ? (
                  <span className="gpChip gpChipInfo" style={{ marginLeft: 6 }}>
                    внешний MRO
                  </span>
                ) : null}
              </td>
            </ClickRow>
          ))
        )}
      </tbody>
    </table>
  );
}

export function HangarCardModal(props: {
  mode: "create" | "edit";
  code: string;
  name: string;
  station: string;
  isPhysical: boolean;
  isActive: boolean;
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  onChange: (patch: { code?: string; name?: string; station?: string; isPhysical?: boolean; isActive?: boolean }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const initial = useRef({
    code: props.code,
    name: props.name,
    station: props.station,
    isPhysical: props.isPhysical,
    isActive: props.isActive
  });
  const [attempted, setAttempted] = useState(false);
  const code = props.code.trim();
  const name = props.name.trim();
  const station = props.station.trim();
  const codeError = !code ? "Укажите код" : code.length > 32 ? "Не длиннее 32 символов" : "";
  const nameError = !name ? "Укажите название" : name.length > 200 ? "Не длиннее 200 символов" : "";
  const stationError = station.length > 32 ? "Не длиннее 32 символов" : "";
  const valid = !codeError && !nameError && !stationError;
  const dirty =
    props.code !== initial.current.code ||
    props.name !== initial.current.name ||
    props.station !== initial.current.station ||
    props.isPhysical !== initial.current.isPhysical ||
    props.isActive !== initial.current.isActive;

  const submit = () => {
    setAttempted(true);
    if (!valid) return;
    props.onSave();
  };

  return (
    <RecordCard
      titleId="hangarCardTitle"
      kicker="Справочники · Ангары"
      title={props.mode === "create" ? "Новый ангар" : name || "Ангар"}
      subtitle={props.mode === "create" ? "Новая карточка записи" : code || "Карточка ангара"}
      active={props.isActive}
      canEdit={props.canEdit}
      saving={props.saving}
      deleting={props.deleting}
      dirty={dirty}
      error={props.error}
      record={props.record}
      showTech={props.showTech}
      onClose={props.onClose}
      onSave={submit}
      onDelete={props.mode === "edit" ? props.onDelete : undefined}
    >
      <label className="refLabel">
        <span>Название</span>
        <input
          className={`refInput${attempted && nameError ? " refInputInvalid" : ""}`}
          value={props.name}
          maxLength={200}
          autoFocus
          autoComplete="off"
          placeholder="Например, Ангар 1"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(nameError)}
          onChange={(e) => props.onChange({ name: e.target.value })}
        />
        {attempted && nameError ? <span className="operatorCardFieldError">{nameError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Код</span>
        <input
          className={`refInput${attempted && codeError ? " refInputInvalid" : ""}`}
          value={props.code}
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          placeholder="Например, H1"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(codeError)}
          onChange={(e) => props.onChange({ code: e.target.value })}
        />
        {attempted && codeError ? <span className="operatorCardFieldError">{codeError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Станция</span>
        <input
          className={`refInput${attempted && stationError ? " refInputInvalid" : ""}`}
          value={props.station}
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          placeholder="SVO / REN"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(stationError)}
          onChange={(e) => props.onChange({ station: e.target.value.toUpperCase() })}
        />
        {attempted && stationError ? <span className="operatorCardFieldError">{stationError}</span> : null}
      </label>
      <SwitchToggle
        checked={props.isPhysical}
        onChange={(next) => props.onChange({ isPhysical: next })}
        disabled={!props.canEdit}
        label="Физический ангар площадки"
        hint="Выключите для внешнего MRO или стороннего контура."
      />
      <SwitchToggle
        checked={props.isActive}
        onChange={(next) => props.onChange({ isActive: next })}
        disabled={!props.canEdit}
        label="Активен"
        hint="Активные ангары показываются в начале списка справочника."
      />
    </RecordCard>
  );
}
