import { useEffect, useMemo, useRef, useState } from "react";

export type MultiSelectOption = { id: string; label: string };

export function MultiSelectDropdown(props: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  width?: number;
  maxHeight?: number;
}) {
  const [open, setOpen] = useState(false);
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

  const selectedSet = useMemo(() => new Set(props.value), [props.value]);
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
          {props.options.length === 0 ? (
            <div className="msdEmpty">Нет вариантов</div>
          ) : (
            props.options.map((o) => (
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

