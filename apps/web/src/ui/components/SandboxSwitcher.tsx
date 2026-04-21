import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, getActiveSandboxId, setActiveSandboxId } from "../../lib/api";

export type SandboxSummary = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  owner: { id: string; email: string; displayName: string | null };
  isOwner: boolean;
  myRole: "OWNER" | "EDITOR" | "VIEWER" | null;
  eventCount: number;
  updatedAt: string;
  createdAt: string;
  members: Array<{ userId: string; role: "OWNER" | "EDITOR" | "VIEWER"; email: string; displayName: string | null }>;
};

export function useActiveSandbox(): { activeId: string | null; active: SandboxSummary | null; list: SandboxSummary[]; loading: boolean } {
  const [activeId, setActiveIdState] = useState<string | null>(() => getActiveSandboxId());

  useEffect(() => {
    const onChange = () => setActiveIdState(getActiveSandboxId());
    window.addEventListener("hangarPlanning:sandboxChanged", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("hangarPlanning:sandboxChanged", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const listQ = useQuery<SandboxSummary[]>({
    queryKey: ["sandboxes", "mine"],
    queryFn: () => apiGet<SandboxSummary[]>("/api/sandboxes"),
    staleTime: 30_000
  });

  const list = listQ.data ?? [];
  const active = useMemo(() => (activeId ? list.find((s) => s.id === activeId) ?? null : null), [activeId, list]);

  return { activeId, active, list, loading: listQ.isLoading };
}

export function SandboxSwitcher({ onManage }: { onManage: () => void }) {
  const qc = useQueryClient();
  const { activeId, active, list, loading } = useActiveSandbox();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (id: string | null) => {
    setActiveSandboxId(id);
    setOpen(false);
    // обнуляем кеш, чтобы запросы перезагрузились с учётом нового контекста
    void qc.invalidateQueries();
  };

  const label = active ? active.name : "Рабочий контур";

  return (
    <div className="sandboxSwitcher" ref={menuRef}>
      <button
        type="button"
        className={activeId ? "sandboxSwitcherBtn sandboxSwitcherBtnActive" : "sandboxSwitcherBtn"}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="sandboxSwitcherIcon" aria-hidden="true">
          {activeId ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7l9-4 9 4-9 4-9-4z" />
              <path d="M3 7v10l9 4 9-4V7" />
              <path d="M3 12l9 4 9-4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </span>
        <span className="sandboxSwitcherLabel">{label}</span>
        {activeId ? <span className="sandboxSwitcherBadge">Песочница</span> : null}
        <span className="sandboxSwitcherCaret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="sandboxSwitcherMenu" role="menu">
          <button
            type="button"
            className={"sandboxSwitcherItem " + (activeId ? "" : "active")}
            onClick={() => pick(null)}
          >
            <span className="sandboxSwitcherItemTitle">Рабочий контур</span>
            <span className="sandboxSwitcherItemMeta">продакшен</span>
          </button>
          <div className="sandboxSwitcherDivider" />
          <div className="sandboxSwitcherGroupTitle">Мои песочницы</div>
          {loading ? <div className="sandboxSwitcherEmpty">Загрузка…</div> : null}
          {!loading && list.length === 0 ? (
            <div className="sandboxSwitcherEmpty">Нет песочниц</div>
          ) : null}
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              className={"sandboxSwitcherItem " + (activeId === s.id ? "active" : "")}
              onClick={() => pick(s.id)}
            >
              <span className="sandboxSwitcherItemTitle">{s.name}</span>
              <span className="sandboxSwitcherItemMeta">
                {s.eventCount} событий · {s.isOwner ? "Владелец" : s.myRole ?? "—"}
              </span>
            </button>
          ))}
          <div className="sandboxSwitcherDivider" />
          <button
            type="button"
            className="sandboxSwitcherItem sandboxSwitcherItemAction"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            Управление песочницами
          </button>
        </div>
      ) : null}
    </div>
  );
}
