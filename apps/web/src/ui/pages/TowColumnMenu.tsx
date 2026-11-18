import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { Column } from "react-data-grid";

import { columnWidth, hiddenColumnKeys, readTowColumnPref, visibleColumnKeys, type TowColumnPref } from "../../lib/towColumnLayout";

export type TowColumnSpec = {
  key: string;
  label: string;
  width: number;
  locked?: boolean;
};

function readPref(storageKey: string): TowColumnPref {
  try {
    if (typeof window === "undefined") return { hidden: [], widths: {} };
    const raw = window.localStorage.getItem(storageKey);
    return readTowColumnPref(raw ? JSON.parse(raw) : null);
  } catch {
    return { hidden: [], widths: {} };
  }
}

export function useTowColumnLayout(storageKey: string, specs: readonly TowColumnSpec[]) {
  const [pref, setPref] = useState<TowColumnPref>(() => readPref(storageKey));
  const prefRef = useRef(pref);
  prefRef.current = pref;
  const all = useMemo(() => specs.map((spec) => spec.key), [specs]);
  const locked = useMemo(() => specs.filter((spec) => spec.locked).map((spec) => spec.key), [specs]);
  const hidden = useMemo(() => hiddenColumnKeys(all, pref.hidden, locked), [all, locked, pref.hidden]);
  const visibleKeys = useMemo(() => visibleColumnKeys(all, hidden, locked), [all, hidden, locked]);

  const commit = useCallback(
    (next: TowColumnPref) => {
      prefRef.current = next;
      setPref(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  const widthOf = useCallback(
    (key: string, fallback: number) => columnWidth(pref.widths[key], fallback),
    [pref.widths]
  );

  const resize = useCallback(
    (key: string, width: number) => {
      const rounded = columnWidth(width, width);
      if (prefRef.current.widths[key] === rounded) return;
      commit({ ...prefRef.current, widths: { ...prefRef.current.widths, [key]: rounded } });
    },
    [commit]
  );

  const setShown = useCallback(
    (shown: string[]) => {
      const shownSet = new Set(shown);
      const nextHidden = hiddenColumnKeys(
        all,
        all.filter((key) => !locked.includes(key) && !shownSet.has(key)),
        locked
      );
      commit({ ...prefRef.current, hidden: nextHidden });
    },
    [all, commit, locked]
  );

  return { hidden, visibleKeys, widthOf, resize, setShown };
}

export function layoutColumn<T>(column: Column<T>, width: number): Column<T> {
  const name = typeof column.name === "string" ? column.name : "";
  const fixed = column.key === "select";
  return {
    ...column,
    width: fixed ? 44 : width,
    minWidth: fixed ? 44 : 56,
    maxWidth: fixed ? 44 : 1200,
    resizable: !fixed,
    renderHeaderCell: column.renderHeaderCell
      ? column.renderHeaderCell
      : name
        ? () => (
            <span className="towGridHeaderLabel" title="ПКМ — столбцы">
              {name}
            </span>
          )
        : undefined
  };
}

export function TowText({ children }: { children: string }) {
  return <span className="towGridCellText">{children}</span>;
}

export type TowColumnMenuPoint = { x: number; y: number };

export function towHeaderContextPoint(event: ReactMouseEvent): TowColumnMenuPoint | null {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest("[role='columnheader']")) return null;
  event.preventDefault();
  return { x: event.clientX, y: event.clientY };
}

function menuStyle(point: TowColumnMenuPoint): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const width = 320;
  const margin = 8;
  const left = Math.min(Math.max(margin, point.x), Math.max(margin, window.innerWidth - width - margin));
  const spaceBelow = window.innerHeight - point.y - margin;
  const spaceAbove = point.y - margin;
  if (spaceBelow < 200 && spaceAbove > spaceBelow) {
    return { left, bottom: window.innerHeight - point.y, maxHeight: Math.max(120, Math.min(360, spaceAbove)) };
  }
  return { left, top: point.y, maxHeight: Math.max(120, Math.min(360, spaceBelow)) };
}

export function TowColumnMenu({
  specs,
  hidden,
  onShown,
  point,
  onClose
}: {
  specs: readonly TowColumnSpec[];
  hidden: readonly string[];
  onShown: (shown: string[]) => void;
  point: TowColumnMenuPoint | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const options = specs.filter((spec) => !spec.locked);
  const hiddenSet = new Set(hidden);
  const shown = options.filter((spec) => !hiddenSet.has(spec.key)).map((spec) => spec.key);

  useEffect(() => {
    if (!point) return;
    const onDoc = (event: MouseEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [point]);

  if (!point || typeof document === "undefined") return null;

  const toggle = (key: string) => {
    const next = shown.includes(key) ? shown.filter((item) => item !== key) : [...shown, key];
    if (next.length === 0) return;
    onShown(next);
  };

  return createPortal(
    <div
      ref={panelRef}
      className="towColumnMenuPanel"
      style={menuStyle(point)}
      role="dialog"
      aria-label="Столбцы"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="towColumnMenuHead">
        <span>Показать в таблице</span>
        <button type="button" onClick={() => onShown(options.map((spec) => spec.key))} disabled={hidden.length === 0}>
          Показать все
        </button>
      </div>
      {options.map((spec) => (
        <label key={spec.key}>
          <input type="checkbox" checked={!hiddenSet.has(spec.key)} onChange={() => toggle(spec.key)} />
          <span>{spec.label}</span>
        </label>
      ))}
    </div>,
    document.body
  );
}
