import { useState } from "react";

import {
  IMPLIED_DATA_PERMS,
  PERMISSION_GROUPS,
  displayPermissionCodes,
  expandPermissionCodes,
  permissionCodesFromIds,
  permissionIdsFromCodes,
  summarizeGroupAccess,
  type PermGroup
} from "../../lib/permissionCatalog";

type PermRow = { id: string; code: string; name: string };

type PermissionMatrixEditProps = {
  readOnly?: false;
  catalog: PermRow[];
  value: string[];
  onChange: (nextIds: string[]) => void;
  disabled?: boolean;
};

type PermissionMatrixReadProps = {
  readOnly: true;
  permissions: string[];
};

export type PermissionMatrixProps = PermissionMatrixEditProps | PermissionMatrixReadProps;

function Chevron(props: { open: boolean }) {
  return (
    <span className={props.open ? "adminPermChevron adminPermChevronOpen" : "adminPermChevron"} aria-hidden="true">
      ›
    </span>
  );
}

export function PermissionMatrix(props: PermissionMatrixProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const readOnly = props.readOnly === true;
  const catalog = readOnly ? [] : props.catalog;
  const editDisabled = readOnly ? true : Boolean(props.disabled);
  const known = new Set(readOnly ? PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => a.code)) : catalog.map((p) => p.code));
  const hasModuleCatalog = known.has("gantt:read");
  const rawCodes = readOnly ? props.permissions : permissionCodesFromIds(props.value, catalog);
  const selectedCodes = new Set(
    displayPermissionCodes(rawCodes).filter((code) => {
      if (!known.has(code)) return false;
      if (hasModuleCatalog && (code === IMPLIED_DATA_PERMS.read || code === IMPLIED_DATA_PERMS.write)) return false;
      return true;
    })
  );

  const toggle = (code: string, on: boolean) => {
    if (readOnly) return;
    const next = new Set(selectedCodes);
    if (on) next.add(code);
    else next.delete(code);
    props.onChange(permissionIdsFromCodes(expandPermissionCodes(next), catalog));
  };

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderGroup = (id: string, title: string, hint: string | undefined, actions: PermGroup["actions"], summary: string) => {
    const open = openIds.has(id);
    const hasAccess = summary !== "нет доступа";
    return (
      <div key={id} className={hasAccess ? "adminPermGroup adminPermGroupOn" : "adminPermGroup"}>
        <button
          type="button"
          className="adminPermGroupHead"
          aria-expanded={open}
          onClick={() => toggleOpen(id)}
        >
          <Chevron open={open} />
          <span className="adminPermGroupTitle">
            <strong>{title}</strong>
            {hint && open ? <span className="muted">{hint}</span> : null}
          </span>
          <span className={hasAccess ? "adminPermGroupSummary" : "adminPermGroupSummary muted"}>{summary}</span>
        </button>
        {open ? (
          <div className="adminPermActions">
            {actions.map((action) =>
              readOnly ? (
                <span
                  key={action.code}
                  className={selectedCodes.has(action.code) ? "adminPermGranted" : "adminPermDenied"}
                >
                  {action.label}
                </span>
              ) : (
                <label key={action.code} className="adminPermCheck">
                  <input
                    type="checkbox"
                    disabled={editDisabled}
                    checked={selectedCodes.has(action.code)}
                    onChange={(e) => toggle(action.code, e.target.checked)}
                  />
                  <span>{action.label}</span>
                </label>
              )
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="adminPermMatrix">
      <div className="muted adminHint">
        {readOnly
          ? "Права назначает администратор. Раскройте модуль, чтобы увидеть состав доступа."
          : "Редактирование модуля включает просмотр. Раскройте модуль, чтобы изменить права."}
      </div>
      {PERMISSION_GROUPS.map((group) => {
        const actions = group.actions.filter((a) => known.has(a.code));
        if (actions.length === 0) return null;
        return renderGroup(group.id, group.title, group.hint, actions, summarizeGroupAccess(group, selectedCodes));
      })}
      {!readOnly && !hasModuleCatalog && (known.has(IMPLIED_DATA_PERMS.read) || known.has(IMPLIED_DATA_PERMS.write))
        ? renderGroup(
            "legacy-planning",
            "Планирование",
            "Пока нет раздельных прав по модулям",
            [
              ...(known.has(IMPLIED_DATA_PERMS.read) ? [{ code: IMPLIED_DATA_PERMS.read, label: "Просмотр" }] : []),
              ...(known.has(IMPLIED_DATA_PERMS.write) ? [{ code: IMPLIED_DATA_PERMS.write, label: "Редактирование" }] : [])
            ],
            [
              selectedCodes.has(IMPLIED_DATA_PERMS.write) ? "редактирование" : null,
              !selectedCodes.has(IMPLIED_DATA_PERMS.write) && selectedCodes.has(IMPLIED_DATA_PERMS.read) ? "просмотр" : null
            ]
              .filter(Boolean)
              .join(", ") || "нет доступа"
          )
        : null}
    </div>
  );
}
