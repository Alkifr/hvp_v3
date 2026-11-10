import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Знак вопроса у заголовка. Панель рисуется поверх страницы, чтобы её не обрезал прокручиваемый блок. */
export function BlockHelp(props: { label: string; children: ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);

  const syncPanelPos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(props.width ?? 420, window.innerWidth - 24);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const openUp = spaceBelow < 180 && rect.top > spaceBelow;
    if (openUp) setPanelPos({ bottom: window.innerHeight - rect.top + 6, left, width });
    else setPanelPos({ top: rect.bottom + 6, left, width });
  }, [props.width]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    syncPanelPos();
  }, [open, syncPanelPos]);

  useEffect(() => {
    if (!open) return;
    const onWin = () => syncPanelPos();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open, syncPanelPos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const panel = open && panelPos
    ? createPortal(
      <div
        ref={panelRef}
        className="evCardHelpPanel evCardHelpPanelPortal"
        role="dialog"
        aria-label={`Справка: ${props.label}`}
        style={{ position: "fixed", top: panelPos.top, bottom: panelPos.bottom, left: panelPos.left, width: panelPos.width, maxWidth: panelPos.width, zIndex: 1400 }}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="evCardHelpPanelTitle">{props.label}</div>
        <div className="evCardHelpPanelBody">{props.children}</div>
      </div>,
      document.body
    )
    : null;

  return (
    <div ref={rootRef} className={`evCardHelp${open ? " evCardHelpOpen" : ""}`}>
      <button
        ref={btnRef}
        type="button"
        className="evCardHelpBtn"
        aria-label={`Справка: ${props.label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Справка по блоку"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        ?
      </button>
      {panel}
    </div>
  );
}
