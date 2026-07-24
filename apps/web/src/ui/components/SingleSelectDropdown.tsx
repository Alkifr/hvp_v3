import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type WheelEvent
} from "react";
import { createPortal } from "react-dom";

export type SingleSelectOption = { id: string; label: string; disabled?: boolean };

type PanelPos = { top: number; left: number; width: number; maxHeight: number; openUp: boolean };

export function SingleSelectDropdown(props: {
  options: SingleSelectOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  width?: number | string;
  maxHeight?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  compact?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

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
    const width = Math.max(rect.width, 180);
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
    const onDoc = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
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
    if (!open) {
      setSearch("");
      setActiveIndex(0);
      return;
    }
    const t = window.setTimeout(() => {
      searchRef.current?.focus();
      if (props.searchable) searchRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, props.searchable]);

  const showSearch = props.searchable ?? props.options.length > 8;
  const filteredOptions = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("ru-RU");
    if (!q) return props.options;
    return props.options.filter((o) => o.label.toLocaleLowerCase("ru-RU").includes(q));
  }, [props.options, search]);

  const selectedLabel = useMemo(() => {
    if (!props.value) return props.placeholder ?? "— выберите —";
    return props.options.find((o) => o.id === props.value)?.label ?? props.placeholder ?? "— выберите —";
  }, [props.value, props.options, props.placeholder]);

  const keepWheelInsidePanel = (e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
      e.preventDefault();
    }
    e.stopPropagation();
  };

  const pick = (id: string) => {
    if (props.options.find((option) => option.id === id)?.disabled) return;
    props.onChange(id);
    setOpen(false);
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const enabled = filteredOptions.filter((option) => !option.disabled);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((index) => Math.min(enabled.length - 1, index + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = enabled[Math.min(activeIndex, Math.max(0, enabled.length - 1))];
      if (option) pick(option.id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const panelStyle: CSSProperties | undefined = panelPos
    ? {
        position: "fixed",
        top: panelPos.openUp ? undefined : panelPos.top,
        bottom: panelPos.openUp ? window.innerHeight - panelPos.top : undefined,
        left: panelPos.left,
        width: panelPos.width,
        maxHeight: panelPos.maxHeight,
        zIndex: 1200
      }
    : undefined;

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            className={`msdPanel ssdPanelPortal${props.compact ? " msdCompact" : ""}`}
            style={panelStyle}
            onWheel={keepWheelInsidePanel}
          >
            <div className="msdPanelHeader">
              {props.allowEmpty !== false ? (
                <div className="msdActions" role="group" aria-label="Сброс">
                  <button type="button" onClick={() => pick("")} disabled={!props.value}>
                    Сбросить
                  </button>
                </div>
              ) : null}
              {showSearch && !props.searchable ? (
                <div className="msdSearch">
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder={props.searchPlaceholder ?? "Поиск..."}
                  />
                </div>
              ) : null}
            </div>
            {props.allowEmpty !== false ? (
              <button
                type="button"
                className={`ssdOption${!props.value ? " ssdOptionActive" : ""}`}
                onClick={() => pick("")}
              >
                {props.emptyLabel ?? "— выберите —"}
              </button>
            ) : null}
            {props.options.length === 0 ? (
              <div className="msdEmpty">Нет вариантов</div>
            ) : filteredOptions.length === 0 ? (
              <div className="msdEmpty">Ничего не найдено</div>
            ) : (
              filteredOptions.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`ssdOption${o.id === props.value ? " ssdOptionActive" : ""}`}
                  onClick={() => pick(o.id)}
                  disabled={o.disabled}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`msdRoot ssdRoot${props.compact ? " msdCompact" : ""}${props.className ? ` ${props.className}` : ""}`}
      style={{ width: props.width != null ? (typeof props.width === "number" ? `${props.width}px` : props.width) : undefined }}
    >
      {props.searchable ? (
        <div
          ref={btnRef as RefObject<HTMLDivElement>}
          className={`ssdCombobox${props.disabled ? " ssdComboboxDisabled" : ""}`}
        >
          <input
            ref={searchRef}
            className="ssdComboboxInput"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            value={open ? search : selectedLabel}
            disabled={props.disabled}
            onFocus={() => {
              setSearch("");
              setOpen(true);
            }}
            onClick={(e) => {
              setOpen(true);
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={props.searchPlaceholder ?? props.placeholder ?? "Поиск..."}
          />
          <button
            type="button"
            className="ssdComboboxToggle"
            tabIndex={-1}
            disabled={props.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Закрыть список" : "Открыть список"}
          >
            {open ? "▴" : "▾"}
          </button>
        </div>
      ) : (
        <button
          ref={btnRef as RefObject<HTMLButtonElement>}
          type="button"
          className="msdBtn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={props.disabled}
        >
          <span className="msdBtnText">{selectedLabel}</span>
          <span className="msdChevron">{open ? "▴" : "▾"}</span>
        </button>
      )}
      {panel}
    </div>
  );
}
