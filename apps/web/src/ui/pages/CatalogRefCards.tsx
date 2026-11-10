import { useRef, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";

import { DraftNumberInput } from "../components/DraftNumberInput";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { SwitchToggle } from "../components/SwitchToggle";
import { ClickRow, RecordCard } from "./FleetRefCards";

export const REMAINING_REF_KINDS = [
  "event-types",
  "event-statuses",
  "placement-priorities",
  "optimization-profiles",
  "optimization-score-rules",
  "workshops",
  "skills",
  "persons",
  "shifts",
  "materials",
  "warehouses"
] as const;

export type RemainingRefKind = (typeof REMAINING_REF_KINDS)[number];

export function isRemainingRefKind(kind: string): kind is RemainingRefKind {
  return (REMAINING_REF_KINDS as readonly string[]).includes(kind);
}

type Option = { id: string; label: string; hangarId?: string };

export type RemainingRefValues = {
  code: string;
  name: string;
  isActive: boolean;
  color: string;
  sortOrder: number;
  allowsAutoInProgress: boolean;
  manualOnly: boolean;
  defaultLineBase: "" | "LINE" | "BASE";
  uom: string;
  personSkillIds: string[];
  startMin: number;
  endMin: number;
  description: string;
  isDefault: boolean;
  profileId: string;
  scoreCategory: string;
  scoreScope: string;
  scoreValue: number;
  scoreUnit: string;
  hangarId: string;
  layoutId: string;
  standId: string;
  priorityScore: number;
  priorityEventTypeIds: string[];
  priorityAircraftTypeIds: string[];
  sourceEventName: string;
  sourceAircraftTypeText: string;
  conditionText: string;
  comment: string;
  source: string;
};

const SCORE_CATEGORY: Record<string, string> = {
  REWARD: "Поощрение",
  PENALTY: "Штраф",
  LIMIT: "Ограничение"
};

const SCORE_SCOPE: Record<string, string> = {
  NEW_EVENT: "Новое событие",
  EXISTING_EVENT: "Существующее событие",
  PLACEMENT: "Размещение",
  LAYOUT: "Вариант",
  STAND: "Место",
  TOW: "Буксировка",
  PRIORITY: "Приоритет"
};

const SCORE_UNIT: Record<string, string> = {
  POINTS: "Баллы",
  POINTS_PER_HOUR: "Баллы/час",
  HOURS: "Часы",
  BOOLEAN: "Да/нет",
  MULTIPLIER: "Множитель"
};

function categoryLabel(v: unknown) {
  return SCORE_CATEGORY[String(v)] ?? "—";
}

function scopeLabel(v: unknown) {
  return SCORE_SCOPE[String(v)] ?? "—";
}

function unitLabel(v: unknown) {
  return SCORE_UNIT[String(v)] ?? String(v ?? "—");
}

function lineBaseLabel(v: unknown) {
  if (v === "LINE") return "L (Line)";
  if (v === "BASE") return "B (Base)";
  return "—";
}

function clock(mins: number) {
  const hh = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor(mins % 60)
    .toString()
    .padStart(2, "0");
  return `${hh}:${mm}`;
}

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, index) => id === right[index]);
}

function eventTypeLabel(row: { eventTypes?: Array<{ eventType?: { name?: string | null; code?: string | null } | null } | null> | null }) {
  const names = (row.eventTypes ?? []).map((link) => link?.eventType?.name || link?.eventType?.code).filter(Boolean);
  return names.length ? names.join(", ") : "Любой тип события";
}

function aircraftTypeLabel(row: { aircraftTypes?: Array<{ aircraftType?: { name?: string | null } | null }> }) {
  const names = (row.aircraftTypes ?? []).map((link) => link.aircraftType?.name).filter(Boolean);
  return names.length ? names.join(", ") : "Любой тип ВС";
}

function personSkills(row: { skills?: Array<{ skill?: { code?: string | null; name?: string | null } | null }> }) {
  return (row.skills ?? [])
    .map((link) => link.skill?.code || link.skill?.name)
    .filter(Boolean)
    .join(", ");
}

function EmptyRow(props: { cols: number }) {
  return (
    <tr>
      <td colSpan={props.cols}>
        <div className="muted">Ничего не найдено. Измените запрос или очистите поиск.</div>
      </td>
    </tr>
  );
}

function DataTable(props: { headers: string[]; rows: Array<{ id: string; editing: boolean; onOpen: () => void; cells: ReactNode[] }> }) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          {props.headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.length === 0 ? (
          <EmptyRow cols={props.headers.length} />
        ) : (
          props.rows.map((row) => (
            <ClickRow key={row.id} editing={row.editing} onOpen={row.onOpen}>
              {row.cells.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </ClickRow>
          ))
        )}
      </tbody>
    </table>
  );
}

function codeCell(code?: string | null) {
  return code ? <span className="refCodeChip">{code}</span> : <span className="muted">—</span>;
}

function activeMark(active: boolean) {
  return <span className={active ? "refStatus refStatusActive" : "refStatus refStatusInactive"}>{active ? "Активен" : "Неактивен"}</span>;
}

function colorCell(color?: string | null) {
  const value = String(color ?? "").trim();
  return (
    <span className="refCellTitle">
      {value ? <span className="refRowSwatch" style={{ background: value }} /> : null}
      <span>{value || "—"}</span>
    </span>
  );
}

export function RemainingRefTable(props: {
  kind: RemainingRefKind;
  rows: any[];
  editingId: string;
  onOpen: (row: any) => void;
}) {
  const open = (row: any) => ({
    id: String(row.id),
    editing: props.editingId === row.id,
    onOpen: () => props.onOpen(row)
  });

  if (props.kind === "event-types") {
    return (
      <DataTable
        headers={["Название", "Код", "Цвет", "Статус"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [
            <strong key="n">{row.name || "—"}</strong>,
            codeCell(row.code),
            colorCell(row.color),
            activeMark(row.isActive !== false)
          ]
        }))}
      />
    );
  }

  if (props.kind === "event-statuses") {
    return (
      <DataTable
        headers={["Название", "Код", "Цвет", "Порядок", "В форме"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [
            <strong key="n">{row.name || "—"}</strong>,
            codeCell(row.code),
            colorCell(row.color),
            row.sortOrder ?? "—",
            activeMark(row.selectable !== false && row.isActive !== false)
          ]
        }))}
      />
    );
  }

  if (props.kind === "placement-priorities") {
    return (
      <DataTable
        headers={["Ангар", "Вариант", "Место", "Балл", "События", "Типы ВС", "Статус"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [
            row.hangar?.name || <span className="muted">—</span>,
            row.layout?.name || <span className="muted">—</span>,
            codeCell(row.stand?.code),
            row.priorityScore ?? 0,
            eventTypeLabel(row),
            aircraftTypeLabel(row),
            activeMark(row.isActive !== false)
          ]
        }))}
      />
    );
  }

  if (props.kind === "optimization-profiles") {
    return (
      <DataTable
        headers={["Название", "Код", "Роль", "Статус"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [
            <strong key="n">{row.name || "—"}</strong>,
            codeCell(row.code),
            row.isDefault ? "по умолчанию" : "обычный",
            activeMark(row.isActive !== false)
          ]
        }))}
      />
    );
  }

  if (props.kind === "optimization-score-rules") {
    return (
      <DataTable
        headers={["Название", "Код", "Профиль", "Категория", "Область", "Значение", "Статус"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [
            <strong key="n">{row.name || "—"}</strong>,
            codeCell(row.code),
            row.profile?.name || <span className="muted">—</span>,
            categoryLabel(row.category),
            scopeLabel(row.scope),
            `${row.value ?? 0} · ${unitLabel(row.unit)}`,
            activeMark(row.isActive !== false)
          ]
        }))}
      />
    );
  }

  if (props.kind === "workshops") {
    return (
      <DataTable
        headers={["Код", "Название", "Контур", "Статус"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [
            codeCell(row.code),
            <strong key="n">{row.name || "—"}</strong>,
            lineBaseLabel(row.defaultLineBase),
            activeMark(row.isActive !== false)
          ]
        }))}
      />
    );
  }

  if (props.kind === "persons") {
    return (
      <DataTable
        headers={["Имя", "Код", "Квалификации", "Статус"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [
            <strong key="n">{row.name || "—"}</strong>,
            codeCell(row.code),
            personSkills(row) || <span className="muted">—</span>,
            activeMark(row.isActive !== false)
          ]
        }))}
      />
    );
  }

  if (props.kind === "shifts") {
    return (
      <DataTable
        headers={["Название", "Код", "Время", "Статус"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [
            <strong key="n">{row.name || "—"}</strong>,
            codeCell(row.code),
            row.startMin != null && row.endMin != null ? `${clock(Number(row.startMin))} – ${clock(Number(row.endMin))}` : "—",
            activeMark(row.isActive !== false)
          ]
        }))}
      />
    );
  }

  if (props.kind === "materials") {
    return (
      <DataTable
        headers={["Код", "Название", "Ед. изм.", "Статус"]}
        rows={props.rows.map((row) => ({
          ...open(row),
          cells: [codeCell(row.code), <strong key="n">{row.name || "—"}</strong>, row.uom || "—", activeMark(row.isActive !== false)]
        }))}
      />
    );
  }

  return (
    <DataTable
      headers={["Код", "Название", "Статус"]}
      rows={props.rows.map((row) => ({
        ...open(row),
        cells: [codeCell(row.code), <strong key="n">{row.name || "—"}</strong>, activeMark(row.isActive !== false)]
      }))}
    />
  );
}

function Field(props: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="refLabel">
      <span>{props.label}</span>
      {props.children}
      {props.error ? <span className="operatorCardFieldError">{props.error}</span> : null}
    </label>
  );
}

function TextField(props: {
  label: string;
  value: string;
  maxLength: number;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  spellCheck?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label} error={props.error}>
      <input
        className={`refInput${props.error ? " refInputInvalid" : ""}`}
        value={props.value}
        maxLength={props.maxLength}
        autoFocus={props.autoFocus}
        autoComplete="off"
        spellCheck={props.spellCheck ?? true}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-invalid={Boolean(props.error)}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

function ColorField(props: { label: string; value: string; error?: string; disabled?: boolean; allowEmpty?: boolean; onChange: (value: string) => void }) {
  const color = /^#[0-9a-fA-F]{6}$/i.test(props.value) ? props.value : "#cccccc";
  return (
    <Field label={props.label} error={props.error}>
      <div className="operatorCardColor">
        <div className="operatorCardSwatchPick">
          <input type="color" value={color} disabled={props.disabled} aria-label={props.label} onChange={(e) => props.onChange(e.target.value)} />
          <span className="operatorCardSwatch" style={{ background: /^#[0-9a-fA-F]{6}$/i.test(props.value) ? props.value : "transparent" }} />
        </div>
        <input
          className={`refInput${props.error ? " refInputInvalid" : ""}`}
          value={props.value}
          maxLength={7}
          autoComplete="off"
          spellCheck={false}
          placeholder="#RRGGBB"
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
        />
        {props.allowEmpty && props.value ? (
          <button type="button" className="btn" disabled={props.disabled} onClick={() => props.onChange("")}>
            Без полоски
          </button>
        ) : null}
      </div>
    </Field>
  );
}

function useSnapshot<T>(value: T) {
  return useRef(value);
}

function cardShell(props: {
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
  children: ReactNode;
}) {
  return (
    <RecordCard
      titleId={props.titleId}
      kicker={props.kicker}
      title={props.title}
      subtitle={props.subtitle}
      active={props.active}
      canEdit={props.canEdit}
      saving={props.saving}
      deleting={props.deleting}
      dirty={props.dirty}
      error={props.error}
      record={props.record}
      showTech={props.showTech}
      wide={props.wide}
      roomy={props.roomy}
      docked={props.docked}
      onDirtyChange={props.onDirtyChange}
      onClose={props.onClose}
      onSave={props.onSave}
      onDelete={props.onDelete}
    >
      {props.children}
    </RecordCard>
  );
}

export function RemainingRefCard(props: {
  kind: RemainingRefKind;
  mode: "create" | "edit";
  values: RemainingRefValues;
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  record?: { id?: string; isSystem?: boolean } | null;
  showTech?: boolean;
  skills: Option[];
  eventTypes: Option[];
  aircraftTypes: Option[];
  hangars: Option[];
  layouts: Option[];
  stands: Option[];
  profiles: Option[];
  docked?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onChange: (patch: Partial<RemainingRefValues>) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const v = props.values;
  const initial = useSnapshot(v);
  const [attempted, setAttempted] = useState(false);
  const show = (message: string) => (attempted ? message : "");
  const text = (value: string, empty: string, max: number, min = 1) => {
    const trimmed = value.trim();
    if (!trimmed) return empty;
    if (trimmed.length < min) return `Не короче ${min} символов`;
    if (trimmed.length > max) return `Не длиннее ${max} символов`;
    return "";
  };

  const baseDirty =
    v.code !== initial.current.code ||
    v.name !== initial.current.name ||
    v.isActive !== initial.current.isActive;

  const submit = (valid: boolean) => {
    setAttempted(true);
    if (!valid) return;
    props.onSave();
  };

  const activeSwitch = (label = "Активен", hint = "Активные записи показываются в начале списка справочника.", disabled = false) => (
    <SwitchToggle checked={v.isActive} onChange={(next) => props.onChange({ isActive: next })} disabled={!props.canEdit || disabled} label={label} hint={hint} />
  );

  const shell = (body: Omit<Parameters<typeof cardShell>[0], "docked" | "onDirtyChange">) =>
    cardShell({ ...body, docked: props.docked, onDirtyChange: props.onDirtyChange });

  if (props.kind === "skills" || props.kind === "warehouses") {
    const codeMax = 32;
    const codeMin = props.kind === "skills" ? 2 : 1;
    const codeError = text(v.code, "Укажите код", codeMax, codeMin);
    const nameError = text(v.name, "Укажите название", 200);
    const dirty = baseDirty;
    const title = props.mode === "create" ? (props.kind === "skills" ? "Новая квалификация" : "Новый склад") : v.name.trim() || "Запись";
    return shell({
      titleId: "namedRefCardTitle",
      kicker: props.kind === "skills" ? "Справочники · Квалификации" : "Справочники · Склады",
      title,
      subtitle: props.mode === "create" ? "Новая карточка записи" : v.code.trim() || "Карточка записи",
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      onClose: props.onClose,
      onSave: () => submit(!codeError && !nameError),
      onDelete: props.mode === "edit" ? props.onDelete : undefined,
      children: (
        <>
          <TextField label="Код" value={v.code} maxLength={codeMax} error={show(codeError)} disabled={!props.canEdit} autoFocus placeholder={props.kind === "skills" ? "Например, ME" : "Например, MAIN"} spellCheck={false} onChange={(code) => props.onChange({ code })} />
          <TextField label="Название" value={v.name} maxLength={200} error={show(nameError)} disabled={!props.canEdit} onChange={(name) => props.onChange({ name })} />
          {activeSwitch()}
        </>
      )
    });
  }

  if (props.kind === "workshops") {
    const codeError = text(v.code, "Укажите код", 32);
    const nameError = text(v.name, "Укажите название", 200);
    const dirty = baseDirty || v.defaultLineBase !== initial.current.defaultLineBase;
    return shell({
      titleId: "workshopCardTitle",
      kicker: "Справочники · Цеха",
      title: props.mode === "create" ? "Новый цех" : v.name.trim() || "Цех",
      subtitle: props.mode === "create" ? "Новая карточка записи" : v.code.trim() || "Карточка цеха",
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      onClose: props.onClose,
      onSave: () => submit(!codeError && !nameError),
      onDelete: props.mode === "edit" ? props.onDelete : undefined,
      children: (
        <>
          <TextField label="Код" value={v.code} maxLength={32} error={show(codeError)} disabled={!props.canEdit} autoFocus spellCheck={false} onChange={(code) => props.onChange({ code })} />
          <TextField label="Название" value={v.name} maxLength={200} error={show(nameError)} disabled={!props.canEdit} onChange={(name) => props.onChange({ name })} />
          <Field label="Контур L/B по умолчанию">
            <select className="refInput" value={v.defaultLineBase} disabled={!props.canEdit} onChange={(e) => props.onChange({ defaultLineBase: e.target.value === "LINE" || e.target.value === "BASE" ? e.target.value : "" })}>
              <option value="">— не задан —</option>
              <option value="LINE">L (Line)</option>
              <option value="BASE">B (Base)</option>
            </select>
          </Field>
          {activeSwitch()}
        </>
      )
    });
  }

  if (props.kind === "materials") {
    const codeError = text(v.code, "Укажите код", 64);
    const nameError = text(v.name, "Укажите название", 300);
    const uomError = text(v.uom, "Укажите единицу измерения", 16);
    const dirty = baseDirty || v.uom !== initial.current.uom;
    return shell({
      titleId: "materialCardTitle",
      kicker: "Справочники · Материалы",
      title: props.mode === "create" ? "Новый материал" : v.name.trim() || "Материал",
      subtitle: props.mode === "create" ? "Новая карточка записи" : v.code.trim() || "Карточка материала",
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      onClose: props.onClose,
      onSave: () => submit(!codeError && !nameError && !uomError),
      onDelete: props.mode === "edit" ? props.onDelete : undefined,
      children: (
        <>
          <TextField label="Код" value={v.code} maxLength={64} error={show(codeError)} disabled={!props.canEdit} autoFocus spellCheck={false} onChange={(code) => props.onChange({ code })} />
          <TextField label="Название" value={v.name} maxLength={300} error={show(nameError)} disabled={!props.canEdit} onChange={(name) => props.onChange({ name })} />
          <TextField label="Ед. изм." value={v.uom} maxLength={16} error={show(uomError)} disabled={!props.canEdit} placeholder="Например, EA" onChange={(uom) => props.onChange({ uom })} />
          {activeSwitch()}
        </>
      )
    });
  }

  if (props.kind === "persons") {
    const codeError = v.code.trim().length > 32 ? "Не длиннее 32 символов" : "";
    const nameError = text(v.name, "Укажите имя", 200);
    const dirty = baseDirty || !sameIds(v.personSkillIds, initial.current.personSkillIds);
    return shell({
      titleId: "personCardTitle",
      kicker: "Справочники · Сотрудники",
      title: props.mode === "create" ? "Новый сотрудник" : v.name.trim() || "Сотрудник",
      subtitle: props.mode === "create" ? "Новая карточка записи" : v.code.trim() || "Карточка сотрудника",
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      wide: true,
      onClose: props.onClose,
      onSave: () => submit(!codeError && !nameError),
      onDelete: props.mode === "edit" ? props.onDelete : undefined,
      children: (
        <>
          <TextField label="Имя" value={v.name} maxLength={200} error={show(nameError)} disabled={!props.canEdit} autoFocus onChange={(name) => props.onChange({ name })} />
          <TextField label="Код" value={v.code} maxLength={32} error={show(codeError)} disabled={!props.canEdit} spellCheck={false} placeholder="Необязательно" onChange={(code) => props.onChange({ code })} />
          <Field label="Квалификации">
            <MultiSelectDropdown options={props.skills} value={v.personSkillIds} onChange={(personSkillIds) => props.onChange({ personSkillIds })} placeholder="без квалификаций" width={480} maxHeight={260} searchable selectedLabelMode="labels" disabled={!props.canEdit} />
          </Field>
          {activeSwitch()}
        </>
      )
    });
  }

  if (props.kind === "shifts") {
    const codeError = text(v.code, "Укажите код", 16);
    const nameError = text(v.name, "Укажите название", 80);
    const minuteError = (value: number) => (!Number.isInteger(value) || value < 0 || value > 24 * 60 ? "От 0 до 1440 минут" : "");
    const startError = minuteError(v.startMin);
    const endError = minuteError(v.endMin);
    const dirty = baseDirty || v.startMin !== initial.current.startMin || v.endMin !== initial.current.endMin;
    return shell({
      titleId: "shiftCardTitle",
      kicker: "Справочники · Смены",
      title: props.mode === "create" ? "Новая смена" : v.name.trim() || "Смена",
      subtitle: props.mode === "create" ? "Новая карточка записи" : `${clock(v.startMin)} – ${clock(v.endMin)}`,
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      onClose: props.onClose,
      onSave: () => submit(!codeError && !nameError && !startError && !endError),
      onDelete: props.mode === "edit" ? props.onDelete : undefined,
      children: (
        <>
          <TextField label="Код" value={v.code} maxLength={16} error={show(codeError)} disabled={!props.canEdit} autoFocus spellCheck={false} onChange={(code) => props.onChange({ code })} />
          <TextField label="Название" value={v.name} maxLength={80} error={show(nameError)} disabled={!props.canEdit} onChange={(name) => props.onChange({ name })} />
          <div className="operatorCardMetrics">
            <Field label="Начало, мин" error={show(startError)}>
              <DraftNumberInput className={`refInput${show(startError) ? " refInputInvalid" : ""}`} min={0} max={1440} step={15} value={v.startMin} disabled={!props.canEdit} aria-invalid={Boolean(show(startError))} onChange={(startMin) => props.onChange({ startMin })} />
              <span className="muted">{clock(v.startMin)}</span>
            </Field>
            <Field label="Окончание, мин" error={show(endError)}>
              <DraftNumberInput className={`refInput${show(endError) ? " refInputInvalid" : ""}`} min={0} max={1440} step={15} value={v.endMin} disabled={!props.canEdit} aria-invalid={Boolean(show(endError))} onChange={(endMin) => props.onChange({ endMin })} />
              <span className="muted">{clock(v.endMin)}</span>
            </Field>
          </div>
          {activeSwitch()}
        </>
      )
    });
  }

  if (props.kind === "event-types") {
    const codeError = text(v.code, "Укажите код", 32);
    const nameError = text(v.name, "Укажите название", 200);
    const colorError = /^#[0-9a-fA-F]{6}$/i.test(v.color.trim()) ? "" : "Укажите цвет #RRGGBB";
    const dirty = baseDirty || v.color !== initial.current.color;
    return shell({
      titleId: "eventTypeCardTitle",
      kicker: "Справочники · Типы событий",
      title: props.mode === "create" ? "Новый тип события" : v.name.trim() || "Тип события",
      subtitle: props.mode === "create" ? "Новая карточка записи" : v.code.trim() || "Карточка типа",
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      onClose: props.onClose,
      onSave: () => submit(!codeError && !nameError && !colorError),
      onDelete: props.mode === "edit" ? props.onDelete : undefined,
      children: (
        <>
          <TextField label="Код" value={v.code} maxLength={32} error={show(codeError)} disabled={!props.canEdit} autoFocus spellCheck={false} onChange={(code) => props.onChange({ code })} />
          <TextField label="Название" value={v.name} maxLength={200} error={show(nameError)} disabled={!props.canEdit} onChange={(name) => props.onChange({ name })} />
          <ColorField label="Цвет" value={v.color} error={show(colorError)} disabled={!props.canEdit} onChange={(color) => props.onChange({ color })} />
          {activeSwitch()}
        </>
      )
    });
  }

  if (props.kind === "event-statuses") {
    const locked = props.mode === "edit";
    const deleted = props.record?.id === "DELETED" || v.code === "DELETED";
    const terminal = deleted || props.record?.id === "CANCELLED" || v.code === "CANCELLED";
    const codeError = !/^[A-Z0-9_]{2,64}$/.test(v.code.trim()) ? "Латиница, цифры и подчёркивание, 2–64 символа" : "";
    const nameError = text(v.name, "Укажите название", 200);
    const colorError = v.color.trim() && !/^#[0-9a-fA-F]{6}$/i.test(v.color.trim()) ? "Укажите #RRGGBB или оставьте пустым" : "";
    const orderError = !Number.isInteger(v.sortOrder) || v.sortOrder < 0 || v.sortOrder > 10000 ? "Порядок от 0 до 10000" : "";
    const dirty =
      baseDirty ||
      v.color !== initial.current.color ||
      v.sortOrder !== initial.current.sortOrder ||
      v.allowsAutoInProgress !== initial.current.allowsAutoInProgress ||
      v.manualOnly !== initial.current.manualOnly;
    return shell({
      titleId: "statusCardTitle",
      kicker: "Справочники · Статусы",
      title: props.mode === "create" ? "Новый статус" : v.name.trim() || "Статус",
      subtitle: props.mode === "create" ? "Новая карточка записи" : props.record?.isSystem ? `${v.code} · системный` : v.code || "Карточка статуса",
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      wide: true,
      onClose: props.onClose,
      onSave: () => submit(!codeError && !nameError && !colorError && !orderError),
      onDelete: props.mode === "edit" && !props.record?.isSystem ? props.onDelete : undefined,
      children: (
        <>
          <TextField label="Код" value={v.code} maxLength={64} error={show(codeError)} disabled={!props.canEdit || locked} autoFocus={props.mode === "create"} spellCheck={false} placeholder="Например, CUSTOM_STATUS" onChange={(code) => props.onChange({ code: code.toUpperCase().replace(/[\s-]+/g, "_") })} />
          <TextField label="Название" value={v.name} maxLength={200} error={show(nameError)} disabled={!props.canEdit} autoFocus={props.mode === "edit"} onChange={(name) => props.onChange({ name })} />
          <ColorField label="Цвет полоски на Гантте" value={v.color} error={show(colorError)} disabled={!props.canEdit} allowEmpty onChange={(color) => props.onChange({ color })} />
          <Field label="Порядок" error={show(orderError)}>
            <DraftNumberInput className={`refInput${show(orderError) ? " refInputInvalid" : ""}`} min={0} max={10000} step={10} value={v.sortOrder} disabled={!props.canEdit} aria-invalid={Boolean(show(orderError))} onChange={(sortOrder) => props.onChange({ sortOrder })} />
          </Field>
          <SwitchToggle checked={v.allowsAutoInProgress} onChange={(allowsAutoInProgress) => props.onChange({ allowsAutoInProgress })} disabled={!props.canEdit || terminal} label="Автоперевод в «В работе»" hint="После наступления оперативного начала событие само перейдёт во «В работе»." />
          <SwitchToggle checked={v.manualOnly} onChange={(manualOnly) => props.onChange({ manualOnly })} disabled={!props.canEdit || deleted} label="Только вручную" hint="Не слать уведомление о просрочке без факта." />
          {activeSwitch("Показывать в форме", "Скрытый статус нельзя выбрать в карточке события.", deleted)}
        </>
      )
    });
  }

  if (props.kind === "optimization-profiles") {
    const codeError = text(v.code, "Укажите код", 64);
    const nameError = text(v.name, "Укажите название", 200);
    const descriptionError = v.description.trim().length > 1000 ? "Не длиннее 1000 символов" : "";
    const dirty = baseDirty || v.description !== initial.current.description || v.isDefault !== initial.current.isDefault;
    return shell({
      titleId: "profileCardTitle",
      kicker: "Справочники · Профили оптимизации",
      title: props.mode === "create" ? "Новый профиль" : v.name.trim() || "Профиль",
      subtitle: props.mode === "create" ? "Новая карточка записи" : v.code.trim() || "Карточка профиля",
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      wide: true,
      onClose: props.onClose,
      onSave: () => submit(!codeError && !nameError && !descriptionError),
      onDelete: props.mode === "edit" ? props.onDelete : undefined,
      children: (
        <>
          <TextField label="Код" value={v.code} maxLength={64} error={show(codeError)} disabled={!props.canEdit} autoFocus spellCheck={false} onChange={(code) => props.onChange({ code })} />
          <TextField label="Название" value={v.name} maxLength={200} error={show(nameError)} disabled={!props.canEdit} onChange={(name) => props.onChange({ name })} />
          <TextField label="Описание" value={v.description} maxLength={1000} error={show(descriptionError)} disabled={!props.canEdit} onChange={(description) => props.onChange({ description })} />
          <SwitchToggle checked={v.isDefault} onChange={(isDefault) => props.onChange({ isDefault })} disabled={!props.canEdit} label="Профиль по умолчанию" hint="Остальные профили перестанут быть профилем по умолчанию." />
          {activeSwitch()}
        </>
      )
    });
  }

  if (props.kind === "optimization-score-rules") {
    const profileError = !v.profileId ? "Выберите профиль" : "";
    const codeError = text(v.code, "Укажите код", 64);
    const nameError = text(v.name, "Укажите название", 200);
    const dirty =
      baseDirty ||
      v.profileId !== initial.current.profileId ||
      v.scoreCategory !== initial.current.scoreCategory ||
      v.scoreScope !== initial.current.scoreScope ||
      v.scoreValue !== initial.current.scoreValue ||
      v.scoreUnit !== initial.current.scoreUnit;
    return shell({
      titleId: "scoreRuleCardTitle",
      kicker: "Справочники · Правила scoring",
      title: props.mode === "create" ? "Новое правило" : v.name.trim() || "Правило",
      subtitle: props.mode === "create" ? "Новая карточка записи" : v.code.trim() || "Карточка правила",
      active: v.isActive,
      canEdit: props.canEdit,
      saving: props.saving,
      deleting: props.deleting,
      dirty,
      error: props.error,
      record: props.record,
      showTech: props.showTech,
      wide: true,
      onClose: props.onClose,
      onSave: () => submit(!profileError && !codeError && !nameError),
      onDelete: props.mode === "edit" ? props.onDelete : undefined,
      children: (
        <>
          <Field label="Профиль" error={show(profileError)}>
            <select className={`refInput${show(profileError) ? " refInputInvalid" : ""}`} value={v.profileId} disabled={!props.canEdit} autoFocus={props.mode === "create"} onChange={(e) => props.onChange({ profileId: e.target.value })}>
              <option value="">— выберите —</option>
              {props.profiles.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </Field>
          <TextField label="Код" value={v.code} maxLength={64} error={show(codeError)} disabled={!props.canEdit} spellCheck={false} onChange={(code) => props.onChange({ code })} />
          <TextField label="Название" value={v.name} maxLength={200} error={show(nameError)} disabled={!props.canEdit} autoFocus={props.mode === "edit"} onChange={(name) => props.onChange({ name })} />
          <Field label="Категория">
            <select className="refInput" value={v.scoreCategory} disabled={!props.canEdit} onChange={(e) => props.onChange({ scoreCategory: e.target.value })}>
              <option value="REWARD">Поощрение</option>
              <option value="PENALTY">Штраф</option>
              <option value="LIMIT">Ограничение</option>
            </select>
          </Field>
          <Field label="Область">
            <select className="refInput" value={v.scoreScope} disabled={!props.canEdit} onChange={(e) => props.onChange({ scoreScope: e.target.value })}>
              {Object.entries(SCORE_SCOPE).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Значение">
            <DraftNumberInput className="refInput" step={10} value={v.scoreValue} disabled={!props.canEdit} onChange={(scoreValue) => props.onChange({ scoreValue })} />
          </Field>
          <Field label="Единица">
            <select className="refInput" value={v.scoreUnit} disabled={!props.canEdit} onChange={(e) => props.onChange({ scoreUnit: e.target.value })}>
              {Object.entries(SCORE_UNIT).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </Field>
          {activeSwitch()}
        </>
      )
    });
  }

  const hangarError = !v.hangarId ? "Выберите ангар" : "";
  const layoutError = !v.layoutId ? "Выберите вариант" : "";
  const standError = !v.standId ? "Выберите место" : "";
  const scoreError = !Number.isInteger(v.priorityScore) || v.priorityScore < -100000 || v.priorityScore > 100000 ? "Балл от -100000 до 100000" : "";
  const sourceEventError = v.sourceEventName.trim().length > 300 ? "Не длиннее 300 символов" : "";
  const sourceTypeError = v.sourceAircraftTypeText.trim().length > 300 ? "Не длиннее 300 символов" : "";
  const conditionError = v.conditionText.trim().length > 1000 ? "Не длиннее 1000 символов" : "";
  const commentError = v.comment.trim().length > 1000 ? "Не длиннее 1000 символов" : "";
  const sourceError = v.source.trim().length > 200 ? "Не длиннее 200 символов" : "";
  const layouts = props.layouts.filter((item) => !v.hangarId || item.hangarId === v.hangarId);
  const dirty =
    v.hangarId !== initial.current.hangarId ||
    v.layoutId !== initial.current.layoutId ||
    v.standId !== initial.current.standId ||
    v.priorityScore !== initial.current.priorityScore ||
    !sameIds(v.priorityEventTypeIds, initial.current.priorityEventTypeIds) ||
    !sameIds(v.priorityAircraftTypeIds, initial.current.priorityAircraftTypeIds) ||
    v.sourceEventName !== initial.current.sourceEventName ||
    v.sourceAircraftTypeText !== initial.current.sourceAircraftTypeText ||
    v.conditionText !== initial.current.conditionText ||
    v.comment !== initial.current.comment ||
    v.source !== initial.current.source ||
    v.isActive !== initial.current.isActive;
  const place = props.stands.find((item) => item.id === v.standId)?.label;
  return shell({
    titleId: "priorityCardTitle",
    kicker: "Справочники · Приоритеты размещения",
    title: props.mode === "create" ? "Новый приоритет" : place || "Приоритет",
    subtitle: props.mode === "create" ? "Новая карточка записи" : `${props.hangars.find((item) => item.id === v.hangarId)?.label || "Ангар"} · балл ${v.priorityScore}`,
    active: v.isActive,
    canEdit: props.canEdit,
    saving: props.saving,
    deleting: props.deleting,
    dirty,
    error: props.error,
    record: props.record,
    showTech: props.showTech,
    roomy: true,
    onClose: props.onClose,
    onSave: () => submit(!hangarError && !layoutError && !standError && !scoreError && !sourceEventError && !sourceTypeError && !conditionError && !commentError && !sourceError),
    onDelete: props.mode === "edit" ? props.onDelete : undefined,
    children: (
      <>
        <Field label="Ангар" error={show(hangarError)}>
          <select className={`refInput${show(hangarError) ? " refInputInvalid" : ""}`} value={v.hangarId} disabled={!props.canEdit} autoFocus={props.mode === "create"} onChange={(e) => props.onChange({ hangarId: e.target.value, layoutId: "", standId: "" })}>
            <option value="">— выберите —</option>
            {props.hangars.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Вариант" error={show(layoutError)}>
          <select className={`refInput${show(layoutError) ? " refInputInvalid" : ""}`} value={v.layoutId} disabled={!props.canEdit} onChange={(e) => props.onChange({ layoutId: e.target.value, standId: "" })}>
            <option value="">— выберите —</option>
            {layouts.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Место" error={show(standError)}>
          <select className={`refInput${show(standError) ? " refInputInvalid" : ""}`} value={v.standId} disabled={!props.canEdit} onChange={(e) => props.onChange({ standId: e.target.value })}>
            <option value="">— выберите —</option>
            {props.stands.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Балл приоритета" error={show(scoreError)}>
          <DraftNumberInput className={`refInput${show(scoreError) ? " refInputInvalid" : ""}`} step={50} value={v.priorityScore} disabled={!props.canEdit} aria-invalid={Boolean(show(scoreError))} onChange={(priorityScore) => props.onChange({ priorityScore })} />
        </Field>
        <Field label="Типы событий">
          <MultiSelectDropdown options={props.eventTypes} value={v.priorityEventTypeIds} onChange={(priorityEventTypeIds) => props.onChange({ priorityEventTypeIds })} placeholder="любой тип события" width={600} searchable selectedLabelMode="labels" disabled={!props.canEdit} />
        </Field>
        <Field label="Типы ВС">
          <MultiSelectDropdown options={props.aircraftTypes} value={v.priorityAircraftTypeIds} onChange={(priorityAircraftTypeIds) => props.onChange({ priorityAircraftTypeIds })} placeholder="любой ВС" width={600} searchable selectedLabelMode="labels" disabled={!props.canEdit} />
        </Field>
        <TextField label="Исходное событие" value={v.sourceEventName} maxLength={300} error={show(sourceEventError)} disabled={!props.canEdit} onChange={(sourceEventName) => props.onChange({ sourceEventName })} />
        <TextField label="Исходный тип ВС" value={v.sourceAircraftTypeText} maxLength={300} error={show(sourceTypeError)} disabled={!props.canEdit} onChange={(sourceAircraftTypeText) => props.onChange({ sourceAircraftTypeText })} />
        <TextField label="Условие" value={v.conditionText} maxLength={1000} error={show(conditionError)} disabled={!props.canEdit} onChange={(conditionText) => props.onChange({ conditionText })} />
        <TextField label="Комментарий" value={v.comment} maxLength={1000} error={show(commentError)} disabled={!props.canEdit} onChange={(comment) => props.onChange({ comment })} />
        <TextField label="Источник" value={v.source} maxLength={200} error={show(sourceError)} disabled={!props.canEdit} onChange={(source) => props.onChange({ source })} />
        {activeSwitch()}
      </>
    )
  });
}

function sheet(name: string, file: string, rows: Array<Record<string, unknown>>, widths: number[]) {
  const book = XLSX.utils.book_new();
  const table = XLSX.utils.json_to_sheet(rows);
  table["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(book, table, name);
  XLSX.writeFile(book, file);
}

function statusText(active: boolean) {
  return active ? "Активен" : "Неактивен";
}

export function downloadRemainingRefXlsx(kind: RemainingRefKind, rows: any[]) {
  const sorted = [...rows].sort((a, b) => String(a.name ?? a.code ?? "").localeCompare(String(b.name ?? b.code ?? ""), "ru"));
  if (kind === "event-types") {
    sheet("Типы событий", "event-types.xlsx", sorted.map((row) => ({ Код: row.code ?? "", Название: row.name ?? "", Цвет: row.color ?? "", Статус: statusText(row.isActive !== false) })), [16, 32, 12, 14]);
  } else if (kind === "event-statuses") {
    sheet("Статусы", "event-statuses.xlsx", sorted.map((row) => ({ Код: row.code ?? "", Название: row.name ?? "", Цвет: row.color ?? "", Порядок: row.sortOrder ?? "", "В форме": row.selectable === false || row.isActive === false ? "Нет" : "Да", "Авто в работе": row.allowsAutoInProgress ? "Да" : "Нет", "Только вручную": row.manualOnly ? "Да" : "Нет" })), [24, 32, 12, 12, 12, 16, 16]);
  } else if (kind === "placement-priorities") {
    sheet("Приоритеты", "placement-priorities.xlsx", sorted.map((row) => ({ Ангар: row.hangar?.name ?? "", Вариант: row.layout?.name ?? "", Место: row.stand?.code ?? "", Балл: row.priorityScore ?? 0, События: eventTypeLabel(row), "Типы ВС": aircraftTypeLabel(row), Условие: row.conditionText ?? "", Комментарий: row.comment ?? "", Источник: row.source ?? "", Статус: statusText(row.isActive !== false) })), [22, 24, 12, 10, 36, 36, 28, 28, 20, 14]);
  } else if (kind === "optimization-profiles") {
    sheet("Профили", "optimization-profiles.xlsx", sorted.map((row) => ({ Код: row.code ?? "", Название: row.name ?? "", Описание: row.description ?? "", Роль: row.isDefault ? "по умолчанию" : "обычный", Статус: statusText(row.isActive !== false) })), [16, 32, 40, 16, 14]);
  } else if (kind === "optimization-score-rules") {
    sheet("Правила", "optimization-score-rules.xlsx", sorted.map((row) => ({ Профиль: row.profile?.name ?? "", Код: row.code ?? "", Название: row.name ?? "", Категория: categoryLabel(row.category), Область: scopeLabel(row.scope), Значение: row.value ?? 0, Единица: unitLabel(row.unit), Статус: statusText(row.isActive !== false) })), [24, 20, 32, 16, 24, 12, 16, 14]);
  } else if (kind === "workshops") {
    sheet("Цеха", "workshops.xlsx", sorted.map((row) => ({ Код: row.code ?? "", Название: row.name ?? "", Контур: lineBaseLabel(row.defaultLineBase), Статус: statusText(row.isActive !== false) })), [16, 32, 16, 14]);
  } else if (kind === "persons") {
    sheet("Сотрудники", "persons.xlsx", sorted.map((row) => ({ Код: row.code ?? "", Имя: row.name ?? "", Квалификации: personSkills(row), Статус: statusText(row.isActive !== false) })), [16, 32, 40, 14]);
  } else if (kind === "shifts") {
    sheet("Смены", "shifts.xlsx", sorted.map((row) => ({ Код: row.code ?? "", Название: row.name ?? "", Начало: clock(Number(row.startMin ?? 0)), Окончание: clock(Number(row.endMin ?? 0)), Статус: statusText(row.isActive !== false) })), [12, 24, 12, 12, 14]);
  } else if (kind === "materials") {
    sheet("Материалы", "materials.xlsx", sorted.map((row) => ({ Код: row.code ?? "", Название: row.name ?? "", "Ед. изм.": row.uom ?? "", Статус: statusText(row.isActive !== false) })), [16, 36, 12, 14]);
  } else {
    sheet("Склады", "warehouses.xlsx", sorted.map((row) => ({ Код: row.code ?? "", Название: row.name ?? "", Статус: statusText(row.isActive !== false) })), [16, 36, 14]);
  }
}
