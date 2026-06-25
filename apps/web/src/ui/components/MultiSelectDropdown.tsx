import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";

export type MultiSelectOption = { id: string; label: string };

export function MultiSelectDropdown(props: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  width?: number;
  maxHeight?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  compact?: boolean;
  selectedLabelMode?: "count" | "labels";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const selectedSet = useMemo(() => new Set(props.value), [props.value]);
  const showSearch = props.searchable ?? props.options.length > 8;
  const filteredOptions = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru-RU");
    if (!q) return props.options;
    return props.options.filter((o) => o.label.toLocaleLowerCase("ru-RU").includes(q));
  }, [props.options, search]);
  const selectedLabel = useMemo(() => {
    if (props.value.length === 0) return props.placeholder ?? "не выбрано";
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
  }, [props.value, props.options, props.placeholder, props.selectedLabelMode]);

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

  return (
    <div ref={rootRef} className={`msdRoot${props.compact ? " msdCompact" : ""}`} style={{ width: props.width ? `${props.width}px` : undefined }}>
      <button type="button" className="msdBtn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="msdBtnText">{selectedLabel}</span>
        <span className="msdChevron">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className="msdPanel" style={{ maxHeight: props.maxHeight ? `${props.maxHeight}px` : undefined }} onWheel={keepWheelInsidePanel}>
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
                  <span className="msdOptionText">{o.label}</span>
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
      ) : null}
    </div>
  );
}

