import { useEffect, useRef, useState, type ReactNode } from "react";

export function ToolbarPopover(props: {
  label: ReactNode;
  title?: string;
  active?: boolean;
  badge?: string | number | null;
  align?: "left" | "right";
  panelClassName?: string;
  children: ReactNode;
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

  return (
    <div ref={rootRef} className={`tbPopover${open ? " tbPopoverOpen" : ""}`}>
      <button
        type="button"
        className={`btn tbPopoverBtn${props.active ? " tbPopoverBtnActive" : ""}${open ? " tbPopoverBtnOpen" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={props.title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tbPopoverBtnLabel">{props.label}</span>
        {props.badge != null && props.badge !== "" && props.badge !== 0 ? (
          <span className="tbPopoverBadge">{props.badge}</span>
        ) : null}
        <span className="tbPopoverCaret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          className={`tbPopoverPanel${props.align === "right" ? " tbPopoverPanelRight" : ""}${
            props.panelClassName ? ` ${props.panelClassName}` : ""
          }`}
          role="dialog"
        >
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
