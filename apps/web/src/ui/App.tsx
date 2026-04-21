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
import { SandboxSwitcher, useActiveSandbox } from "./components/SandboxSwitcher";
import { authMe } from "./auth/authApi";

type Page = "gantt" | "hangar" | "import" | "mass" | "ref" | "profile" | "admin" | "sandboxes";

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
    if (
      hash === "hangar" ||
      hash === "ref" ||
      hash === "gantt" ||
      hash === "import" ||
      hash === "mass" ||
      hash === "profile" ||
      hash === "admin" ||
      hash === "sandboxes"
    )
      return hash;
    return "gantt";
  }, []);

  const [page, setPage] = useState<Page>(initial);

  useEffect(() => {
    location.hash = page;
  }, [page]);

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

  return (
    <div className={inSandbox ? "appShell appShellSandbox" : "appShell"}>
      <aside className="nav">
        <div className="navBrand" title="Hangar Planning" aria-label="Hangar Planning">
          HP
        </div>

        <div className="navGroup">
          {canEvents ? (
            <>
              <NavIcon active={page === "gantt"} onClick={() => setPage("gantt")} label="План (Гантт)" icon={ICONS.gantt} />
              <NavIcon active={page === "hangar"} onClick={() => setPage("hangar")} label="Ангар (схема)" icon={ICONS.hangar} />
            </>
          ) : null}

          {canWrite ? (
            <>
              <NavIcon active={page === "import"} onClick={() => setPage("import")} label="Импорт событий" icon={ICONS.import} />
              <NavIcon active={page === "mass"} onClick={() => setPage("mass")} label="Массовое планирование" icon={ICONS.mass} />
            </>
          ) : null}

          {canRef ? (
            <NavIcon active={page === "ref"} onClick={() => setPage("ref")} label="Справочники" icon={ICONS.ref} />
          ) : null}

          <NavIcon active={page === "sandboxes"} onClick={() => setPage("sandboxes")} label="Песочницы" icon={ICONS.sandboxes} />
        </div>

        <div className="navGroup navGroupBottom">
          <NavIcon active={page === "profile"} onClick={() => setPage("profile")} label="Профиль" icon={ICONS.profile} />
          {canAdmin ? (
            <NavIcon active={page === "admin"} onClick={() => setPage("admin")} label="Админка" icon={ICONS.admin} />
          ) : null}
        </div>
      </aside>

      <main className="content">
        <div className="topbar">
          {inSandbox ? (
            <div className="topbarSandboxBanner" title={activeSandbox?.description ?? ""}>
              <span className="topbarSandboxDot" aria-hidden="true" />
              <span>Вы работаете в песочнице</span>
              <b>{activeSandbox?.name}</b>
              <span className="muted">· изменения изолированы от рабочего контура</span>
            </div>
          ) : (
            <div className="topbarProdBanner">
              <span className="topbarProdDot" aria-hidden="true" />
              <span>Рабочий контур</span>
            </div>
          )}
          <div className="topbarSpacer" />
          <SandboxSwitcher onManage={() => setPage("sandboxes")} />
        </div>

        {page === "gantt" && <GanttView />}
        {page === "hangar" && <HangarView />}
        {page === "import" && <EventImportView />}
        {page === "mass" && <MassPlanView />}
        {page === "ref" && <ReferenceView />}
        {page === "profile" && <ProfileView me={me} />}
        {page === "admin" && <AdminView permissions={permissions} />}
        {page === "sandboxes" && <SandboxesView />}
      </main>
    </div>
  );
}
