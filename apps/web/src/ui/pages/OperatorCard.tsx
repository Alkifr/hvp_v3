import { useEffect, useRef, useState } from "react";

import { SwitchToggle } from "../components/SwitchToggle";

type OperatorRow = {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
};

export function OperatorsTable(props: {
  rows: OperatorRow[];
  editingId: string;
  onOpen: (row: OperatorRow) => void;
}) {
  return (
    <table className="table refTable">
      <thead>
        <tr>
          <th>Оператор</th>
          <th>Код</th>
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
          props.rows.map((row) => {
            const active = row.isActive !== false;
            const editing = props.editingId === row.id;
            return (
              <tr
                key={row.id}
                className={`refRowClickable${editing ? " refRowEditing" : ""}`}
                tabIndex={0}
                onClick={() => props.onOpen(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onOpen(row);
                  }
                }}
              >
                <td>
                  <div className="refCellTitle">
                    <strong>{row.name || "—"}</strong>
                  </div>
                </td>
                <td>
                  <span className="refCodeChip">{row.code || "—"}</span>
                </td>
                <td>
                  {active ? (
                    <span className="refStatus refStatusActive">Активен</span>
                  ) : (
                    <span className="refStatus refStatusInactive">Неактивен</span>
                  )}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

export function OperatorCardModal(props: {
  mode: "create" | "edit";
  code: string;
  name: string;
  isActive: boolean;
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  record?: { id?: string } | null;
  showTech?: boolean;
  onChange: (patch: { code?: string; name?: string; isActive?: boolean }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const initial = useRef({ code: props.code, name: props.name, isActive: props.isActive });
  const [attempted, setAttempted] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const code = props.code;
  const name = props.name;
  const codeError = !code.trim() ? "Укажите код" : code.trim().length > 32 ? "Не длиннее 32 символов" : "";
  const nameError = !name.trim() ? "Укажите название" : name.trim().length > 200 ? "Не длиннее 200 символов" : "";
  const valid = !codeError && !nameError;
  const dirty =
    code !== initial.current.code || name !== initial.current.name || props.isActive !== initial.current.isActive;
  const title = props.mode === "create" ? "Новый оператор" : name.trim() || "Оператор";

  const requestClose = () => {
    if (props.saving) return;
    if (props.canEdit && dirty && !window.confirm("Закрыть карточку без сохранения?")) return;
    props.onClose();
  };

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="modalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="modalWindow operatorCard" role="dialog" aria-modal="true" aria-labelledby="operatorCardTitle">
        <header className="modalHeader operatorCardHeader">
          <div className="operatorCardHeading">
            <div className="operatorCardKicker">Справочники · Операторы</div>
            <div className="operatorCardTitleRow">
              <h2 className="operatorCardTitle" id="operatorCardTitle">
                {title}
              </h2>
              <span className={props.isActive ? "refStatus refStatusActive" : "refStatus refStatusInactive"}>
                {props.isActive ? "Активен" : "Неактивен"}
              </span>
            </div>
            <div className="operatorCardSubtitle muted">
              {props.mode === "create" ? "Новая карточка записи" : `Код ${code.trim() || "—"}`}
            </div>
          </div>
          <button type="button" className="modalClose" onClick={requestClose} aria-label="Закрыть карточку">
            ×
          </button>
        </header>

        <form
          className="modalBody operatorCardBody"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dirty) return;
            setAttempted(true);
            if (!props.canEdit || !valid || props.saving) return;
            props.onSave();
          }}
        >
          <label className="refLabel">
            <span>Код</span>
            <input
              ref={codeRef}
              className={`refInput${attempted && codeError ? " refInputInvalid" : ""}`}
              value={code}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              placeholder="Например, SU"
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
              value={name}
              maxLength={200}
              autoComplete="off"
              placeholder="Например, Аэрофлот"
              disabled={!props.canEdit}
              aria-invalid={attempted && Boolean(nameError)}
              onChange={(e) => props.onChange({ name: e.target.value })}
            />
            {attempted && nameError ? <span className="operatorCardFieldError">{nameError}</span> : null}
          </label>

          <SwitchToggle
            checked={props.isActive}
            onChange={(next) => props.onChange({ isActive: next })}
            disabled={!props.canEdit}
            label="Активен"
            hint="Активные операторы показываются в начале списка справочника."
          />

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
          <div>
            {props.mode === "edit" && props.canEdit && props.onDelete ? (
              <button type="button" className="btn btnDanger" disabled={props.deleting || props.saving} onClick={props.onDelete}>
                {props.deleting ? "Удаление…" : "Удалить"}
              </button>
            ) : null}
          </div>
          <div className="operatorCardFooterActions">
            <button type="button" className="btn" onClick={requestClose} disabled={props.saving}>
              {props.canEdit ? "Отмена" : "Закрыть"}
            </button>
            {props.canEdit ? (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={!dirty || props.saving || props.deleting}
                onClick={() => {
                  setAttempted(true);
                  if (!valid) return;
                  props.onSave();
                }}
              >
                {props.saving ? "Сохранение…" : "Сохранить"}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
