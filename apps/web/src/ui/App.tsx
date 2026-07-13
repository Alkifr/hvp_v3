import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { HangarView } from "./pages/HangarView";
import { GanttView } from "./pages/GanttView";
import { EventImportView } from "./pages/EventImportView";
import { MassPlanView } from "./pages/MassPlanView";
import { ReferenceView } from "./pages/ReferenceView";
import { LoginView } from "./pages/LoginView";
import { ProfileView } from "./pages/ProfileView";
import { AdminView } from "./pages/AdminView";
import { SandboxesView } from "./pages/SandboxesView";
import { AnalyticsView } from "./pages/AnalyticsView";
import { HelpView } from "./pages/HelpView";
import { NavSandboxMenu, useActiveSandbox } from "./components/SandboxSwitcher";
import { authMe } from "./auth/authApi";

type Page =
  | "gantt"
  | "hangar"
  | "import"
  | "mass"
  | "itp"
  | "ref"
  | "profile"
  | "admin"
  | "sandboxes"
  | "analytics"
  | "help";

function isPage(value: string): value is Page {
  return (
    value === "hangar" ||
    value === "ref" ||
    value === "gantt" ||
    value === "import" ||
    value === "mass" ||
    value === "itp" ||
    value === "profile" ||
    value === "admin" ||
    value === "sandboxes" ||
    value === "analytics" ||
    value === "help"
  );
}

function NavIcon(props: { active: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <a
      className={props.active ? "navIcon active" : "navIcon"}
      href="#"
      onClick={(e) => {
        e.preventDefault();
        props.onClick();
      }}
      aria-label={props.label}
      title={props.label}
    >
      <span className="navIconGlyph" aria-hidden="true">
        {props.icon}
      </span>
      <span className="navTooltip">{props.label}</span>
    </a>
  );
}

const ICONS = {
  gantt: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="11" height="3" rx="1" />
      <rect x="7" y="10.5" width="12" height="3" rx="1" />
      <rect x="5" y="16" width="9" height="3" rx="1" />
    </svg>
  ),
  hangar: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11c3-4 6-6 9-6s6 2 9 6" />
      <path d="M3 11v9h18v-9" />
      <path d="M8 20v-5h8v5" />
    </svg>
  ),
  import: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  ),
  mass: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </svg>
  ),
  ref: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5z" />
      <path d="M4 19a2 2 0 0 1 2-2h12" />
      <path d="M8 7h7" />
      <path d="M8 11h5" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6l8-3z" />
      <path d="M9.5 12.5l2 2 3.5-4" />
    </svg>
  ),
  sandboxes: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M3 12l9 4 9-4" />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-5" />
      <path d="M12 16V8" />
      <path d="M16 16v-3" />
      <path d="M8 7h.01M12 5h.01M16 9h.01" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 3.8" />
      <path d="M12 17.5h.01" />
    </svg>
  )
} as const;

export function App() {
  const meQ = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => authMe(),
    retry: 0
  });

  const me = meQ.data && meQ.data.ok ? meQ.data.user : null;
  const permissions = me?.permissions ?? [];

  const initial = useMemo<Page>(() => {
    const hash = (location.hash || "").replace("#", "");
    if (isPage(hash)) return hash;
    return "gantt";
  }, []);

  const [page, setPage] = useState<Page>(() => (initial === "itp" ? "gantt" : initial));

  useEffect(() => {
    if (page === "itp") setPage("gantt");
  }, [page]);

  useEffect(() => {
    location.hash = page === "itp" ? "gantt" : page;
  }, [page]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = (location.hash || "").replace("#", "");
      if (hash === "itp") {
        setPage("gantt");
        return;
      }
      if (isPage(hash)) setPage(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (meQ.isLoading) {
    return (
      <div className="content">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  if (!me) {
    return <LoginView />;
  }

  const canEvents = permissions.includes("events:read");
  const canWrite = permissions.includes("events:write");
  const canRef = permissions.includes("ref:read");
  const canAdmin = permissions.includes("admin:users") || permissions.includes("admin:roles");

  return <AppShell me={me} permissions={permissions} page={page} setPage={setPage} canEvents={canEvents} canWrite={canWrite} canRef={canRef} canAdmin={canAdmin} />;
}

function AppShell(props: {
  me: any;
  permissions: string[];
  page: Page;
  setPage: (p: Page) => void;
  canEvents: boolean;
  canWrite: boolean;
  canRef: boolean;
  canAdmin: boolean;
}) {
  const { me, permissions, page, setPage, canEvents, canWrite, canRef, canAdmin } = props;
  const { active: activeSandbox } = useActiveSandbox();
  const inSandbox = Boolean(activeSandbox);
  const canWriteInActiveContext =
    canWrite || activeSandbox?.myRole === "OWNER" || activeSandbox?.myRole === "EDITOR";

  return (
    <div className={inSandbox ? "appShell appShellSandbox" : "appShell appShellProd"}>
      <aside className="nav" aria-label="Навигация HVP">
        <div className="navBrand" title="HVP — Hangar Visual Planning" aria-label="HVP">
          <span className="navBrandIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11c3-4 6-6 9-6s6 2 9 6" />
              <path d="M3 11v9h18v-9" />
              <path d="M8 20v-5h8v5" />
            </svg>
          </span>
          <span className="navBrandText">HVP</span>
        </div>

        <div className="navGroup">
          {canEvents ? (
            <>
              <NavIcon active={page === "gantt"} onClick={() => setPage("gantt")} label="План (Гантт)" icon={ICONS.gantt} />
              <NavIcon active={page === "hangar"} onClick={() => setPage("hangar")} label="Ангар (схема)" icon={ICONS.hangar} />
              <NavIcon active={page === "analytics"} onClick={() => setPage("analytics")} label="Аналитика" icon={ICONS.analytics} />
            </>
          ) : null}

          {canWriteInActiveContext ? (
            <>
              <NavIcon active={page === "import"} onClick={() => setPage("import")} label="Импорт событий" icon={ICONS.import} />
              <NavIcon active={page === "mass"} onClick={() => setPage("mass")} label="Массовое планирование" icon={ICONS.mass} />
            </>
          ) : null}

          {canRef ? (
            <NavIcon active={page === "ref"} onClick={() => setPage("ref")} label="Справочники" icon={ICONS.ref} />
          ) : null}

          <NavSandboxMenu active={page === "sandboxes"} icon={ICONS.sandboxes} onManage={() => setPage("sandboxes")} />
        </div>

        <div className="navGroup navGroupBottom">
          <NavIcon active={page === "help"} onClick={() => setPage("help")} label="Инструкция" icon={ICONS.help} />
          <NavIcon active={page === "profile"} onClick={() => setPage("profile")} label="Профиль" icon={ICONS.profile} />
          {canAdmin ? (
            <NavIcon active={page === "admin"} onClick={() => setPage("admin")} label="Админка" icon={ICONS.admin} />
          ) : null}
        </div>
      </aside>

      <main className="content">
        {page === "gantt" && <GanttView />}
        {page === "hangar" && <HangarView />}
        {page === "import" && <EventImportView />}
        {page === "mass" && <MassPlanView />}
        {page === "ref" && <ReferenceView />}
        {page === "profile" && <ProfileView me={me} />}
        {page === "admin" && <AdminView permissions={permissions} />}
        {page === "sandboxes" && <SandboxesView />}
        {page === "analytics" && <AnalyticsView />}
        {page === "help" && <HelpView permissions={permissions} onNavigate={(p) => setPage(p as Page)} />}
      </main>
    </div>
  );
}
