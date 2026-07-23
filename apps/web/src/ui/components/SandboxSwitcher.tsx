import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, getActiveSandboxId, setActiveSandboxId } from "../../lib/api";

export type SandboxStatus = "ACTIVE" | "ARCHIVED";

export type SandboxSummary = {
  id: string;
  name: string;
  description: string | null;
  status?: SandboxStatus;
  ownerId: string;
  owner: { id: string; email: string; displayName: string | null };
  isOwner: boolean;
  myRole: "OWNER" | "EDITOR" | "VIEWER" | null;
  sharedWithAllRole: "EDITOR" | "VIEWER" | null;
  eventCount: number;
  updatedAt: string;
  createdAt: string;
  members: Array<{ userId: string; role: "OWNER" | "EDITOR" | "VIEWER"; email: string; displayName: string | null }>;
};

export function sandboxIsArchived(s: Pick<SandboxSummary, "status">): boolean {
  return s.status === "ARCHIVED";
}

export function useActiveSandbox(): {
  activeId: string | null;
  active: SandboxSummary | null;
  list: SandboxSummary[];
  loading: boolean;
} {
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

  // Если активная песочница ушла в архив или пропала — возвращаемся в рабочий контур.
  useEffect(() => {
    if (!activeId || listQ.isLoading || !listQ.data) return;
    const found = list.find((s) => s.id === activeId);
    if (!found || sandboxIsArchived(found)) {
      setActiveSandboxId(null);
    }
  }, [activeId, list, listQ.isLoading, listQ.data]);

  return { activeId, active, list, loading: listQ.isLoading };
}

/** Дерево быстрого переключения контекста у иконки песочниц в навбаре. */
export function NavSandboxMenu(props: {
  active: boolean;
  icon: ReactNode;
  onManage: () => void;
}) {
  const qc = useQueryClient();
  const { activeId, list, loading } = useActiveSandbox();
  const [open, setOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  const activeList = useMemo(() => list.filter((s) => !sandboxIsArchived(s)), [list]);
  const archivedList = useMemo(() => list.filter((s) => sandboxIsArchived(s)), [list]);

  const pick = (id: string | null) => {
    setActiveSandboxId(id);
    setOpen(false);
    void qc.invalidateQueries();
  };

  return (
    <div className="navSandboxRoot" ref={rootRef}>
      <button
        type="button"
        className={`navIcon${props.active || open ? " active" : ""}${activeId ? " navIconSandboxActive" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Контекст плана"
        title="Контекст плана"
      >
        <span className="navIconGlyph" aria-hidden="true">
          {props.icon}
        </span>
        <span className="navTooltip">Контекст плана</span>
      </button>

      {open ? (
        <div className="navSandboxMenu" role="menu">
          <div className="navSandboxMenuTitle">Контекст плана</div>

          <button
            type="button"
            className={`navSandboxItem${activeId ? "" : " active"}`}
            onClick={() => pick(null)}
            role="menuitem"
          >
            <span className="navSandboxItemMark" aria-hidden="true">
              {activeId ? "○" : "●"}
            </span>
            <span className="navSandboxItemBody">
              <span className="navSandboxItemTitle">Рабочий контур</span>
              <span className="navSandboxItemMeta">продакшен</span>
            </span>
          </button>

          <div className="navSandboxGroup">
            <div className="navSandboxGroupTitle">Песочницы</div>
            {loading ? <div className="navSandboxEmpty">Загрузка…</div> : null}
            {!loading && activeList.length === 0 ? <div className="navSandboxEmpty">Нет активных песочниц</div> : null}
            {activeList.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`navSandboxItem navSandboxItemChild${activeId === s.id ? " active" : ""}`}
                onClick={() => pick(s.id)}
                role="menuitem"
              >
                <span className="navSandboxItemMark" aria-hidden="true">
                  {activeId === s.id ? "●" : "○"}
                </span>
                <span className="navSandboxItemBody">
                  <span className="navSandboxItemTitle">{s.name}</span>
                  <span className="navSandboxItemMeta">
                    {s.eventCount} соб. · {s.isOwner ? "Владелец" : s.myRole ?? "—"}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {archivedList.length > 0 ? (
            <div className="navSandboxGroup">
              <button
                type="button"
                className="navSandboxGroupToggle"
                onClick={() => setArchiveOpen((v) => !v)}
                aria-expanded={archiveOpen}
              >
                <span aria-hidden="true">{archiveOpen ? "▾" : "▸"}</span>
                Архив <span className="navSandboxCount">{archivedList.length}</span>
              </button>
              {archiveOpen
                ? archivedList.map((s) => (
                    <div key={s.id} className="navSandboxItem navSandboxItemChild navSandboxItemArchived" role="presentation">
                      <span className="navSandboxItemMark" aria-hidden="true">
                        ◌
                      </span>
                      <span className="navSandboxItemBody">
                        <span className="navSandboxItemTitle">{s.name}</span>
                        <span className="navSandboxItemMeta">в архиве — откройте в управлении</span>
                      </span>
                    </div>
                  ))
                : null}
            </div>
          ) : null}

          <div className="navSandboxDivider" />
          <button
            type="button"
            className="navSandboxItem navSandboxItemAction"
            onClick={() => {
              setOpen(false);
              props.onManage();
            }}
            role="menuitem"
          >
            <span className="navSandboxItemBody">
              <span className="navSandboxItemTitle">Управление песочницами</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
