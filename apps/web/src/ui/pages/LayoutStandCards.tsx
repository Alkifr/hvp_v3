import { useRef, useState, type ReactNode } from "react";

import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { SwitchToggle } from "../components/SwitchToggle";
import { ClickRow, RecordCard, StatusCell } from "./FleetRefCards";

type RefOption = { id: string; label: string };

export type LayoutRow = {
  id: string;
  code?: string | null;
  name?: string | null;
  hangar?: { name?: string | null } | null;
  standsSummary?: string | null;
  aircraftTypeNames?: string[] | null;
  isActive?: boolean;
};

export type StandRow = {
  id: string;
  code?: string | null;
  name?: string | null;
  isActive?: boolean;
  layout?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
    hangar?: { id?: string | null; name?: string | null } | null;
  } | null;
  allowedAircraftTypes?: Array<{ aircraftType?: { name?: string | null; icaoType?: string | null } | null } | null>;
};

function standTypeLabel(row: StandRow) {
  const names = (row.allowedAircraftTypes ?? [])
    .map((link) => link?.aircraftType?.name)
    .filter((name): name is string => Boolean(name));
  return names.length ? names.join(", ") : "Любой ВС";
}

function standSearchText(row: StandRow) {
  const types = (row.allowedAircraftTypes ?? []).flatMap((link) => [link?.aircraftType?.name, link?.aircraftType?.icaoType]);
  return [row.code, row.name, row.layout?.name, row.layout?.code, row.layout?.hangar?.name, ...types]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function standSecondary(row: StandRow, hangarId: string, layoutId: string) {
  if (layoutId) return standTypeLabel(row);
  if (hangarId) return row.layout?.name || "—";
  const hangar = row.layout?.hangar?.name;
  const layout = row.layout?.name;
  if (hangar && layout) return `${hangar} · ${layout}`;
  return layout || hangar || "—";
}

export function LayoutsLibrary(props: {
  hangars: Array<{ id: string; code?: string | null; name?: string | null }>;
  rows: LayoutRow[];
  hangarId: string;
  selectedId: string;
  canAdd: boolean;
  detail: ReactNode;
  onSelectHangar: (id: string) => void;
  onOpen: (row: LayoutRow) => void;
  onAdd: () => void;
}) {
  const [hangarQuery, setHangarQuery] = useState("");
  const [layoutQuery, setLayoutQuery] = useState("");
  const hangarText = hangarQuery.trim().toLowerCase();
  const layoutText = layoutQuery.trim().toLowerCase();
  const hangars = props.hangars.filter((hangar) => {
    if (!hangarText) return true;
    return `${hangar.name ?? ""} ${hangar.code ?? ""}`.toLowerCase().includes(hangarText);
  });
  const rows = props.rows.filter((row) => {
    if (!layoutText) return true;
    const types = Array.isArray(row.aircraftTypeNames) ? row.aircraftTypeNames.join(" ") : "";
    return `${row.name ?? ""} ${row.code ?? ""} ${row.hangar?.name ?? ""} ${row.standsSummary ?? ""} ${types}`.toLowerCase().includes(layoutText);
  });

  return (
    <div className="refAircraftAdmin">
      <div className="refAircraftStack">
        <section className="card refPickCard">
          <div className="refPickHead">
            <strong>Ангар</strong>
            <span className="muted">{hangars.length}</span>
          </div>
          <div className="refPickSearch">
            <input value={hangarQuery} placeholder="Поиск ангара" onChange={(e) => setHangarQuery(e.target.value)} />
          </div>
          <div className="refPickScroll refPickScrollShort">
            <button type="button" className={`refPickRow${props.hangarId ? "" : " refPickRowActive"}`} onClick={() => props.onSelectHangar("")}>
              <span>Все ангары</span>
              <span className="muted">без фильтра</span>
            </button>
            {hangars.map((hangar) => (
              <button
                key={hangar.id}
                type="button"
                className={`refPickRow${props.hangarId === hangar.id ? " refPickRowActive" : ""}`}
                onClick={() => props.onSelectHangar(hangar.id)}
              >
                <span>{hangar.name || "—"}</span>
                <span className="muted">{hangar.code && hangar.code !== hangar.name ? hangar.code : ""}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card refPickCard">
          <div className="refPickHead">
            <strong>Варианты</strong>
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
            <input value={layoutQuery} placeholder="Поиск варианта" onChange={(e) => setLayoutQuery(e.target.value)} />
          </div>
          <div className="refPickScroll refPickScrollTall">
            {rows.length === 0 ? (
              <div className="refPickEmpty muted">
                {layoutText ? "Ничего не найдено." : props.hangarId ? "Нет вариантов для выбранного ангара." : "Нет вариантов."}
              </div>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`refPickRow${props.selectedId === row.id ? " refPickRowActive" : ""}`}
                  onClick={() => props.onOpen(row)}
                >
                  <span>{row.name || "—"}</span>
                  <span className="muted">{props.hangarId ? row.code || "" : row.hangar?.name || row.code || ""}</span>
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

export function LayoutsTable(props: { rows: LayoutRow[]; editingId: string; onOpen: (row: LayoutRow) => void }) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          <th>Вариант</th>
          <th>Код</th>
          <th>Ангар</th>
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
                <div className="refCellTitle">
                  <strong>{row.name || "—"}</strong>
                </div>
                {row.standsSummary ? <div className="muted refCellHint">{row.standsSummary}</div> : null}
              </td>
              <td>{row.code ? <span className="refCodeChip">{row.code}</span> : <span className="muted">—</span>}</td>
              <td>{row.hangar?.name || <span className="muted">—</span>}</td>
              <StatusCell active={row.isActive !== false} />
            </ClickRow>
          ))
        )}
      </tbody>
    </table>
  );
}

export function StandsLibrary(props: {
  hangars: Array<{ id: string; code?: string | null; name?: string | null }>;
  layouts: Array<{ id: string; code?: string | null; name?: string | null; hangar?: { name?: string | null } | null }>;
  rows: StandRow[];
  hangarId: string;
  layoutId: string;
  selectedId: string;
  canAdd: boolean;
  detail: ReactNode;
  onSelectHangar: (id: string) => void;
  onSelectLayout: (id: string) => void;
  onOpen: (row: StandRow) => void;
  onAdd: () => void;
}) {
  const [hangarQuery, setHangarQuery] = useState("");
  const [layoutQuery, setLayoutQuery] = useState("");
  const [standQuery, setStandQuery] = useState("");
  const hangarText = hangarQuery.trim().toLowerCase();
  const layoutText = layoutQuery.trim().toLowerCase();
  const standText = standQuery.trim().toLowerCase();
  const hangars = props.hangars.filter((hangar) => {
    if (!hangarText) return true;
    return `${hangar.name ?? ""} ${hangar.code ?? ""}`.toLowerCase().includes(hangarText);
  });
  const layouts = props.layouts.filter((layout) => {
    if (!layoutText) return true;
    return `${layout.name ?? ""} ${layout.code ?? ""} ${layout.hangar?.name ?? ""}`.toLowerCase().includes(layoutText);
  });
  const rows = props.rows.filter((row) => !standText || standSearchText(row).includes(standText));
  const emptyStands = standText
    ? "Ничего не найдено."
    : props.layoutId
      ? "Нет мест для выбранного варианта."
      : props.hangarId
        ? "Нет мест для выбранного ангара."
        : "Нет мест.";

  return (
    <div className="refAircraftAdmin">
      <div className="refAircraftStack">
        <section className="card refPickCard">
          <div className="refPickHead">
            <strong>Ангар</strong>
            <span className="muted">{hangars.length}</span>
          </div>
          <div className="refPickSearch">
            <input value={hangarQuery} placeholder="Поиск ангара" onChange={(e) => setHangarQuery(e.target.value)} />
          </div>
          <div className="refPickScroll refPickScrollShort">
            <button type="button" className={`refPickRow${props.hangarId ? "" : " refPickRowActive"}`} onClick={() => props.onSelectHangar("")}>
              <span>Все ангары</span>
              <span className="muted">без фильтра</span>
            </button>
            {hangars.map((hangar) => (
              <button
                key={hangar.id}
                type="button"
                className={`refPickRow${props.hangarId === hangar.id ? " refPickRowActive" : ""}`}
                onClick={() => props.onSelectHangar(hangar.id)}
              >
                <span>{hangar.name || "—"}</span>
                <span className="muted">{hangar.code && hangar.code !== hangar.name ? hangar.code : ""}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card refPickCard">
          <div className="refPickHead">
            <strong>Вариант</strong>
            <span className="muted">{layouts.length}</span>
          </div>
          <div className="refPickSearch">
            <input value={layoutQuery} placeholder="Поиск варианта" onChange={(e) => setLayoutQuery(e.target.value)} />
          </div>
          <div className="refPickScroll refPickScrollShort">
            <button type="button" className={`refPickRow${props.layoutId ? "" : " refPickRowActive"}`} onClick={() => props.onSelectLayout("")}>
              <span>Все варианты</span>
              <span className="muted">без фильтра</span>
            </button>
            {layouts.length === 0 ? (
              <div className="refPickEmpty muted">{layoutText ? "Ничего не найдено." : "Нет вариантов."}</div>
            ) : (
              layouts.map((layout) => (
                <button
                  key={layout.id}
                  type="button"
                  className={`refPickRow${props.layoutId === layout.id ? " refPickRowActive" : ""}`}
                  onClick={() => props.onSelectLayout(layout.id)}
                >
                  <span>{layout.name || "—"}</span>
                  <span className="muted">
                    {props.hangarId
                      ? layout.code && layout.code !== layout.name
                        ? layout.code
                        : ""
                      : layout.hangar?.name || ""}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
        <section className="card refPickCard">
          <div className="refPickHead">
            <strong>Места</strong>
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
            <input value={standQuery} placeholder="Поиск места" onChange={(e) => setStandQuery(e.target.value)} />
          </div>
          <div className="refPickScroll refPickScrollTall">
            {rows.length === 0 ? (
              <div className="refPickEmpty muted">{emptyStands}</div>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`refPickRow${props.selectedId === row.id ? " refPickRowActive" : ""}`}
                  onClick={() => props.onOpen(row)}
                >
                  <span className="refCodeChip">{row.code || "—"}</span>
                  <span>{standSecondary(row, props.hangarId, props.layoutId)}</span>
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

export function StandsTable(props: { rows: StandRow[]; editingId: string; onOpen: (row: StandRow) => void }) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          <th>Код</th>
          <th>Ангар</th>
          <th>Вариант</th>
          <th>Типы ВС</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.length === 0 ? (
          <tr>
            <td colSpan={5}>
              <div className="muted">Ничего не найдено. Измените запрос или очистите поиск.</div>
            </td>
          </tr>
        ) : (
          props.rows.map((row) => (
            <ClickRow key={row.id} editing={props.editingId === row.id} onOpen={() => props.onOpen(row)}>
              <td>{row.code ? <span className="refCodeChip">{row.code}</span> : <span className="muted">—</span>}</td>
              <td>{row.layout?.hangar?.name || <span className="muted">—</span>}</td>
              <td>{row.layout?.name || <span className="muted">—</span>}</td>
              <td>{standTypeLabel(row)}</td>
              <StatusCell active={row.isActive !== false} />
            </ClickRow>
          ))
        )}
      </tbody>
    </table>
  );
}

function SchemeButton(props: { onClick: () => void }) {
  return (
    <button type="button" className="btn" onClick={props.onClick}>
      Показать на схеме
    </button>
  );
}

export function LayoutCardModal(props: {
  mode: "create" | "edit";
  hangarId: string;
  code: string;
  name: string;
  description: string;
  width: number;
  height: number;
  isActive: boolean;
  hangars: RefOption[];
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  docked?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onChange: (patch: {
    hangarId?: string;
    code?: string;
    name?: string;
    description?: string;
    width?: number;
    height?: number;
    isActive?: boolean;
  }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onShowScheme?: () => void;
}) {
  const initial = useRef({
    hangarId: props.hangarId,
    code: props.code,
    name: props.name,
    description: props.description,
    width: props.width,
    height: props.height,
    isActive: props.isActive
  });
  const [attempted, setAttempted] = useState(false);
  const code = props.code.trim();
  const name = props.name.trim();
  const hangarError = props.mode === "create" && !props.hangarId ? "Выберите ангар" : "";
  const codeError = !code ? "Укажите код" : code.length > 32 ? "Не длиннее 32 символов" : "";
  const nameError = !name ? "Укажите название" : name.length > 200 ? "Не длиннее 200 символов" : "";
  const descriptionError = props.description.trim().length > 500 ? "Не длиннее 500 символов" : "";
  const widthError = props.width < 0 ? "Ширина должна быть больше нуля" : "";
  const heightError = props.height < 0 ? "Высота должна быть больше нуля" : "";
  const valid = !hangarError && !codeError && !nameError && !descriptionError && !widthError && !heightError;
  const dirty =
    props.hangarId !== initial.current.hangarId ||
    props.code !== initial.current.code ||
    props.name !== initial.current.name ||
    props.description !== initial.current.description ||
    props.width !== initial.current.width ||
    props.height !== initial.current.height ||
    props.isActive !== initial.current.isActive;
  const hangarLabel = props.hangars.find((item) => item.id === props.hangarId)?.label ?? "";

  const submit = () => {
    setAttempted(true);
    if (!valid) return;
    props.onSave();
  };

  const showScheme = () => {
    if (!props.onShowScheme) return;
    if (props.canEdit && dirty && !window.confirm("Закрыть карточку без сохранения?")) return;
    props.onShowScheme();
  };

  return (
    <RecordCard
      titleId="layoutCardTitle"
      kicker="Справочники · Варианты расстановки"
      title={props.mode === "create" ? "Новый вариант" : name || "Вариант"}
      subtitle={props.mode === "create" ? "Новая карточка записи" : `${hangarLabel || "Ангар"} · ${code || "—"}`}
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
      aside={props.mode === "edit" && props.onShowScheme ? <SchemeButton onClick={showScheme} /> : null}
    >
      <label className="refLabel">
        <span>Ангар</span>
        <select
          className={`refInput${attempted && hangarError ? " refInputInvalid" : ""}`}
          value={props.hangarId}
          disabled={!props.canEdit || props.mode === "edit"}
          autoFocus={props.mode === "create"}
          aria-invalid={attempted && Boolean(hangarError)}
          onChange={(e) => props.onChange({ hangarId: e.target.value })}
        >
          <option value="">— выберите —</option>
          {props.hangars.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {attempted && hangarError ? <span className="operatorCardFieldError">{hangarError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Название</span>
        <input
          className={`refInput${attempted && nameError ? " refInputInvalid" : ""}`}
          value={props.name}
          maxLength={200}
          autoFocus={props.mode === "edit"}
          autoComplete="off"
          placeholder="Например, Базовая"
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
          placeholder="Например, BASE"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(codeError)}
          onChange={(e) => props.onChange({ code: e.target.value })}
        />
        {attempted && codeError ? <span className="operatorCardFieldError">{codeError}</span> : null}
      </label>
      <div className="operatorCardMetrics">
        <label className="refLabel">
          <span>Ширина, м</span>
          <input
            className={`refInput${attempted && widthError ? " refInputInvalid" : ""}`}
            type="number"
            min={0}
            step={1}
            value={props.width > 0 ? String(props.width) : ""}
            disabled={!props.canEdit}
            onChange={(e) => props.onChange({ width: e.target.value === "" ? 0 : Number(e.target.value) })}
          />
          {attempted && widthError ? <span className="operatorCardFieldError">{widthError}</span> : null}
        </label>
        <label className="refLabel">
          <span>Высота, м</span>
          <input
            className={`refInput${attempted && heightError ? " refInputInvalid" : ""}`}
            type="number"
            min={0}
            step={1}
            value={props.height > 0 ? String(props.height) : ""}
            disabled={!props.canEdit}
            onChange={(e) => props.onChange({ height: e.target.value === "" ? 0 : Number(e.target.value) })}
          />
          {attempted && heightError ? <span className="operatorCardFieldError">{heightError}</span> : null}
        </label>
      </div>
      <label className="refLabel">
        <span>Описание</span>
        <textarea
          className={`refInput refMemo${attempted && descriptionError ? " refInputInvalid" : ""}`}
          value={props.description}
          maxLength={500}
          rows={8}
          disabled={!props.canEdit}
          onChange={(e) => props.onChange({ description: e.target.value })}
        />
        {attempted && descriptionError ? <span className="operatorCardFieldError">{descriptionError}</span> : null}
      </label>
      <SwitchToggle
        checked={props.isActive}
        onChange={(next) => props.onChange({ isActive: next })}
        disabled={!props.canEdit}
        label="Активен"
        hint="Активные варианты показываются в начале списка справочника."
      />
    </RecordCard>
  );
}

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, index) => id === right[index]);
}

export function StandCardModal(props: {
  mode: "create" | "edit";
  layoutId: string;
  code: string;
  name: string;
  aircraftTypeIds: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  isActive: boolean;
  layouts: RefOption[];
  aircraftTypes: RefOption[];
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  docked?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onChange: (patch: {
    layoutId?: string;
    code?: string;
    name?: string;
    aircraftTypeIds?: string[];
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    rotate?: number;
    isActive?: boolean;
  }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onShowScheme?: () => void;
}) {
  const initial = useRef({
    layoutId: props.layoutId,
    code: props.code,
    name: props.name,
    aircraftTypeIds: props.aircraftTypeIds,
    x: props.x,
    y: props.y,
    w: props.w,
    h: props.h,
    rotate: props.rotate,
    isActive: props.isActive
  });
  const [attempted, setAttempted] = useState(false);
  const code = props.code.trim();
  const name = props.name.trim();
  const layoutError = props.mode === "create" && !props.layoutId ? "Выберите вариант" : "";
  const codeError = !code ? "Укажите код" : code.length > 32 ? "Не длиннее 32 символов" : "";
  const nameError = !name ? "Укажите название" : name.length > 200 ? "Не длиннее 200 символов" : "";
  const wError = !(props.w > 0) ? "Ширина должна быть больше нуля" : "";
  const hError = !(props.h > 0) ? "Высота должна быть больше нуля" : "";
  const valid = !layoutError && !codeError && !nameError && !wError && !hError;
  const dirty =
    props.layoutId !== initial.current.layoutId ||
    props.code !== initial.current.code ||
    props.name !== initial.current.name ||
    !sameIds(props.aircraftTypeIds, initial.current.aircraftTypeIds) ||
    props.x !== initial.current.x ||
    props.y !== initial.current.y ||
    props.w !== initial.current.w ||
    props.h !== initial.current.h ||
    props.rotate !== initial.current.rotate ||
    props.isActive !== initial.current.isActive;

  const submit = () => {
    setAttempted(true);
    if (!valid) return;
    props.onSave();
  };

  const showScheme = () => {
    if (!props.onShowScheme) return;
    if (props.canEdit && dirty && !window.confirm("Закрыть карточку без сохранения?")) return;
    props.onShowScheme();
  };

  const metric = (
    label: string,
    value: number,
    onValue: (next: number) => void,
    error = "",
    emptyWhenZero = false
  ) => (
    <label className="refLabel">
      <span>{label}</span>
      <input
        className={`refInput${attempted && error ? " refInputInvalid" : ""}`}
        type="number"
        step={0.5}
        value={emptyWhenZero && value === 0 ? "" : String(value)}
        disabled={!props.canEdit}
        onChange={(e) => onValue(e.target.value === "" ? 0 : Number(e.target.value))}
      />
      {attempted && error ? <span className="operatorCardFieldError">{error}</span> : null}
    </label>
  );

  return (
    <RecordCard
      titleId="standCardTitle"
      kicker="Справочники · Места стоянки"
      title={props.mode === "create" ? "Новое место" : code || "Место"}
      subtitle={props.mode === "create" ? "Новая карточка записи" : name || "Карточка места"}
      active={props.isActive}
      canEdit={props.canEdit}
      saving={props.saving}
      deleting={props.deleting}
      dirty={dirty}
      error={props.error}
      record={props.record}
      showTech={props.showTech}
      roomy
      docked={props.docked}
      onDirtyChange={props.onDirtyChange}
      onClose={props.onClose}
      onSave={submit}
      onDelete={props.mode === "edit" ? props.onDelete : undefined}
      aside={props.mode === "edit" && props.onShowScheme ? <SchemeButton onClick={showScheme} /> : null}
    >
      <label className="refLabel">
        <span>Вариант</span>
        <select
          className={`refInput${attempted && layoutError ? " refInputInvalid" : ""}`}
          value={props.layoutId}
          disabled={!props.canEdit || props.mode === "edit"}
          autoFocus={props.mode === "create"}
          aria-invalid={attempted && Boolean(layoutError)}
          onChange={(e) => props.onChange({ layoutId: e.target.value })}
        >
          <option value="">— выберите —</option>
          {props.layouts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {attempted && layoutError ? <span className="operatorCardFieldError">{layoutError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Код</span>
        <input
          className={`refInput${attempted && codeError ? " refInputInvalid" : ""}`}
          value={props.code}
          maxLength={32}
          autoFocus={props.mode === "edit"}
          autoComplete="off"
          spellCheck={false}
          placeholder="Например, MC-1"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(codeError)}
          onChange={(e) => props.onChange({ code: e.target.value })}
        />
        {attempted && codeError ? <span className="operatorCardFieldError">{codeError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Название</span>
        <input
          className={`refInput${attempted && nameError ? " refInputInvalid" : ""}`}
          value={props.name}
          maxLength={200}
          autoComplete="off"
          placeholder="Например, Место 1"
          disabled={!props.canEdit}
          aria-invalid={attempted && Boolean(nameError)}
          onChange={(e) => props.onChange({ name: e.target.value })}
        />
        {attempted && nameError ? <span className="operatorCardFieldError">{nameError}</span> : null}
      </label>
      <label className="refLabel">
        <span>Типы ВС</span>
        <MultiSelectDropdown
          options={props.aircraftTypes}
          value={props.aircraftTypeIds}
          onChange={(ids) => props.onChange({ aircraftTypeIds: ids })}
          placeholder="любой ВС"
          width={560}
          maxHeight={280}
          searchable
          selectedLabelMode="labels"
          disabled={!props.canEdit}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          Если типы не выбраны, место доступно для любого ВС.
        </span>
      </label>
      <div className="operatorCardMetrics">
        {metric("X, м", props.x, (next) => props.onChange({ x: next }))}
        {metric("Y, м", props.y, (next) => props.onChange({ y: next }))}
        {metric("Поворот, °", props.rotate, (next) => props.onChange({ rotate: next }), "", false)}
        {metric("Ширина, м", props.w, (next) => props.onChange({ w: next }), wError, true)}
        {metric("Высота, м", props.h, (next) => props.onChange({ h: next }), hError, true)}
      </div>
      <SwitchToggle
        checked={props.isActive}
        onChange={(next) => props.onChange({ isActive: next })}
        disabled={!props.canEdit}
        label="Активен"
        hint="Активные места показываются в начале списка справочника."
      />
    </RecordCard>
  );
}
