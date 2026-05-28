import { useEffect, useMemo, useRef, useState } from "react";

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
    if (props.value.length === 1) {
      const one = props.options.find((o) => o.id === props.value[0]);
      return one?.label ?? "1 выбрано";
    }
    return `${props.value.length} выбрано`;
  }, [props.value, props.options, props.placeholder]);

  const toggle = (id: string) => {
    const next = new Set(props.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onChange(Array.from(next));
  };

  return (
    <div ref={rootRef} className="msdRoot" style={{ width: props.width ? `${props.width}px` : undefined }}>
      <button type="button" className="msdBtn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="msdBtnText">{selectedLabel}</span>
        <span className="msdChevron">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className="msdPanel" style={{ maxHeight: props.maxHeight ? `${props.maxHeight}px` : undefined }}>
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
          {props.options.length === 0 ? (
            <div className="msdEmpty">Нет вариантов</div>
          ) : filteredOptions.length === 0 ? (
            <div className="msdEmpty">Ничего не найдено</div>
          ) : (
            filteredOptions.map((o) => (
              <label key={o.id} className="msdOption">
                <input type="checkbox" checked={selectedSet.has(o.id)} onChange={() => toggle(o.id)} />
                <span>{o.label}</span>
              </label>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

