import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from "react";
import { createPortal } from "react-dom";

import { fitDropdownWidth } from "../../lib/fitDropdownWidth";

export type MultiSelectOption = { id: string; label: string; description?: string };

export function MultiSelectDropdown(props: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  width?: number;
  /** Подогнать ширину кнопки под самое длинное значение списка. */
  autoWidth?: boolean;
  maxHeight?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  compact?: boolean;
  selectedLabelMode?: "count" | "labels";
  /** Короткая подпись, когда отмечены все пункты списка. */
  collapseAllLabel?: string;
  disabled?: boolean;
  /** Рисовать список поверх страницы, чтобы его не обрезал overflow родителя (модалки). */
  portal?: boolean;
  /** Слой списка, если окно подтверждения само лежит выше стандартного портала. */
  menuZIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; maxHeight: number; openUp: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const syncPanelPos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const preferredMax = props.maxHeight ?? 280;
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(preferredMax, openUp ? spaceAbove : spaceBelow));
    const width = Math.max(rect.width, 220);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    setPanelPos({
      top: openUp ? rect.top - gap : rect.bottom + gap,
      left,
      width,
      maxHeight,
      openUp
    });
  }, [props.maxHeight]);

  useLayoutEffect(() => {
    if (!open || !props.portal) {
      setPanelPos(null);
      return;
    }
    syncPanelPos();
  }, [open, props.portal, syncPanelPos]);

  useEffect(() => {
    if (!open || !props.portal) return;
    const onWin = () => syncPanelPos();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open, props.portal, syncPanelPos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const selectedSet = useMemo(() => new Set(props.value), [props.value]);
  const showSearch = props.searchable ?? props.options.length > 8;
  const filteredOptions = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru-RU");
    if (!q) return props.options;
    return props.options.filter((o) => `${o.label} ${o.description ?? ""}`.toLocaleLowerCase("ru-RU").includes(q));
  }, [props.options, search]);
  const selectedLabel = useMemo(() => {
    if (props.value.length === 0) return props.placeholder ?? "не выбрано";
    if (props.collapseAllLabel && props.options.length > 1 && props.value.length === props.options.length) return props.collapseAllLabel;
    if (props.selectedLabelMode === "labels") {
      const labels = props.value
        .map((id) => props.options.find((o) => o.id === id)?.label)
        .filter(Boolean);
      return labels.length > 0 ? labels.join(", ") : `${props.value.length} выбрано`;
    }
    if (props.value.length === 1) {
      const one = props.options.find((o) => o.id === props.value[0]);
      return one?.label ?? "1 выбрано";
    }
    return `${props.value.length} выбрано`;
  }, [props.value, props.options, props.placeholder, props.selectedLabelMode, props.collapseAllLabel]);

  const toggle = (id: string) => {
    const next = new Set(props.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onChange(Array.from(next));
  };

  const selectAll = () => props.onChange(props.options.map((o) => o.id));
  const selectOnly = (id: string) => props.onChange([id]);
  const selectExcept = (id: string) => props.onChange(props.options.filter((o) => o.id !== id).map((o) => o.id));
  const keepWheelInsidePanel = (e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
      e.preventDefault();
    }
    e.stopPropagation();
  };

  const autoWidth = useMemo(() => {
    if (!props.autoWidth) return props.width;
    return fitDropdownWidth([props.placeholder, ...props.options.map((o) => o.label)]);
  }, [props.autoWidth, props.width, props.placeholder, props.options]);

  const panelStyle: CSSProperties | undefined = props.portal
    ? panelPos
      ? {
          position: "fixed",
          top: panelPos.openUp ? undefined : panelPos.top,
          bottom: panelPos.openUp ? window.innerHeight - panelPos.top : "auto",
          left: panelPos.left,
          right: "auto",
          width: panelPos.width,
          maxHeight: panelPos.maxHeight,
          zIndex: props.menuZIndex ?? 1200
        }
      : undefined
    : props.maxHeight
      ? { maxHeight: props.maxHeight }
      : undefined;

  const panel = (
    <div
      ref={panelRef}
      className={`msdPanel${props.portal ? " ssdPanelPortal" : ""}`}
      style={panelStyle}
      onWheel={keepWheelInsidePanel}
    >
      <div className="msdPanelHeader">
        <div className="msdActions" role="group" aria-label="Быстрый выбор">
          <button type="button" onClick={selectAll} disabled={props.options.length === 0 || props.value.length === props.options.length}>
            Выбрать все
          </button>
          <button type="button" onClick={() => props.onChange([])} disabled={props.value.length === 0}>
            Сбросить
          </button>
        </div>
        {showSearch ? (
          <div className="msdSearch">
            <input
              value={search}
              name="filter-search"
              autoComplete="off"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={props.searchPlaceholder ?? "Поиск..."}
              autoFocus
            />
          </div>
        ) : null}
      </div>
      {props.options.length === 0 ? (
        <div className="msdEmpty">Нет вариантов</div>
      ) : filteredOptions.length === 0 ? (
        <div className="msdEmpty">Ничего не найдено</div>
      ) : (
        filteredOptions.map((o) => {
          const isOnlySelected = props.value.length === 1 && selectedSet.has(o.id);
          return (
            <label key={o.id} className="msdOption">
              <input type="checkbox" checked={selectedSet.has(o.id)} onChange={() => toggle(o.id)} />
              <span className="msdOptionText">
                {o.label}
                {o.description ? <span className="ssdOptionDesc">{o.description}</span> : null}
              </span>
              <span className="msdOptionActions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isOnlySelected) selectExcept(o.id);
                    else selectOnly(o.id);
                  }}
                  title={isOnlySelected ? "Выбрать все, кроме этого значения" : "Оставить только это значение"}
                >
                  {isOnlySelected ? "Кроме" : "Только"}
                </button>
              </span>
            </label>
          );
        })
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`msdRoot${props.compact ? " msdCompact" : ""}`}
      style={{ width: autoWidth ? `${autoWidth}px` : undefined }}
    >
      <button
        ref={btnRef}
        type="button"
        className="msdBtn"
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={props.value.length > 0 ? props.value.map((id) => props.options.find((o) => o.id === id)?.label).filter(Boolean).join(", ") : undefined}
      >
        <span className="msdBtnText">{selectedLabel}</span>
        <span className="msdChevron">{open ? "▴" : "▾"}</span>
      </button>
      {open && props.portal && panelPos ? createPortal(panel, document.body) : null}
      {open && !props.portal ? panel : null}
    </div>
  );
}
