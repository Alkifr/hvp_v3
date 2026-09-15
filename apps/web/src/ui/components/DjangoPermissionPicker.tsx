import { useMemo, useState } from "react";

import {
  djangoPermissionLabel,
  expandPermissionCodes,
  isHiddenPermissionCode,
  permissionCodesFromIds,
  permissionIdsFromCodes
} from "../../lib/permissionCatalog";

export type DjangoPermRow = {
  id: string;
  code: string;
  name: string;
  appLabel?: string | null;
  model?: string | null;
  action?: string | null;
};

type Props = {
  catalog: DjangoPermRow[];
  value: string[];
  onChange: (nextIds: string[]) => void;
  disabled?: boolean;
};

export function DjangoPermissionPicker(props: Props) {
  const [filter, setFilter] = useState("");
  const [availableSel, setAvailableSel] = useState<string[]>([]);
  const [chosenSel, setChosenSel] = useState<string[]>([]);

  const rows = useMemo(() => {
    return props.catalog
      .filter((row) => !isHiddenPermissionCode(row.code))
      .slice()
      .sort((a, b) => djangoPermissionLabel(a).localeCompare(djangoPermissionLabel(b), "ru"));
  }, [props.catalog]);

  const chosenCodes = new Set(permissionCodesFromIds(props.value, props.catalog));
  const q = filter.trim().toLowerCase();
  const match = (row: DjangoPermRow) => {
    if (!q) return true;
    return djangoPermissionLabel(row).toLowerCase().includes(q) || row.code.toLowerCase().includes(q);
  };

  const available = rows.filter((row) => !chosenCodes.has(row.code) && match(row));
  const chosen = rows.filter((row) => chosenCodes.has(row.code) && match(row));

  const setCodes = (codes: Iterable<string>) => {
    props.onChange(permissionIdsFromCodes(expandPermissionCodes(codes), props.catalog));
  };

  const choose = (codes: string[]) => {
    const next = new Set(chosenCodes);
    for (const code of codes) next.add(code);
    setCodes(next);
    setAvailableSel([]);
  };

  const remove = (codes: string[]) => {
    const next = new Set(chosenCodes);
    for (const code of codes) next.delete(code);
    setCodes(next);
    setChosenSel([]);
  };

  return (
    <div className="djangoPermPicker">
      <p className="muted adminHint">
        Формат Django: приложение | модель | право. В группе набираются права на объекты модели данных
        (view / add / change / delete) и права экранов.
      </p>
      <label className="djangoPermFilter">
        <span className="muted">Фильтр</span>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="auth | User | Can view" />
      </label>
      <div className="djangoPermColumns">
        <div className="djangoPermBox">
          <div className="djangoPermBoxHead">Доступные права</div>
          <select
            multiple
            disabled={props.disabled}
            value={availableSel}
            onChange={(e) => setAvailableSel(Array.from(e.target.selectedOptions, (o) => o.value))}
            onDoubleClick={() => choose(availableSel)}
          >
            {available.map((row) => (
              <option key={row.id} value={row.code} title={row.code}>
                {djangoPermissionLabel(row)}
              </option>
            ))}
          </select>
        </div>
        <div className="djangoPermActions">
          <button type="button" className="btn btnSmall" disabled={props.disabled || availableSel.length === 0} onClick={() => choose(availableSel)}>
            Выбрать →
          </button>
          <button type="button" className="btn btnSmall" disabled={props.disabled || available.length === 0} onClick={() => choose(available.map((r) => r.code))}>
            Все →
          </button>
          <button type="button" className="btn btnSmall" disabled={props.disabled || chosenSel.length === 0} onClick={() => remove(chosenSel)}>
            ← Убрать
          </button>
          <button type="button" className="btn btnSmall" disabled={props.disabled || chosen.length === 0} onClick={() => remove(chosen.map((r) => r.code))}>
            ← Все
          </button>
        </div>
        <div className="djangoPermBox">
          <div className="djangoPermBoxHead">Выбранные права</div>
          <select
            multiple
            disabled={props.disabled}
            value={chosenSel}
            onChange={(e) => setChosenSel(Array.from(e.target.selectedOptions, (o) => o.value))}
            onDoubleClick={() => remove(chosenSel)}
          >
            {chosen.map((row) => (
              <option key={row.id} value={row.code} title={row.code}>
                {djangoPermissionLabel(row)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function DjangoPermissionList(props: { permissions: string[]; catalog?: DjangoPermRow[] }) {
  const rows = (props.catalog ?? []).filter((row) => props.permissions.includes(row.code) && !isHiddenPermissionCode(row.code));
  const grouped = new Map<string, DjangoPermRow[]>();
  for (const row of rows) {
    const key = `${row.appLabel ?? ""} | ${row.model ?? row.code}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  if (rows.length === 0) {
    return <div className="muted">Нет назначенных прав на объекты модели.</div>;
  }
  return (
    <div className="djangoPermReadonly">
      {[...grouped.entries()].map(([key, list]) => (
        <div key={key} className="djangoPermReadonlyGroup">
          <strong>{key}</strong>
          <ul>
            {list.map((row) => (
              <li key={row.code}>{row.name}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
