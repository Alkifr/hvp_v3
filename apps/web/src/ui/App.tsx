import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { HangarView } from "./pages/HangarView";
import { GanttView } from "./pages/GanttView";
import { EventImportView } from "./pages/EventImportView";
import { ReferenceView } from "./pages/ReferenceView";
import { LoginView } from "./pages/LoginView";
import { ProfileView } from "./pages/ProfileView";
import { AdminView } from "./pages/AdminView";
import { authMe } from "./auth/authApi";

type Page = "gantt" | "hangar" | "import" | "ref" | "profile" | "admin";

function NavLink(props: { active: boolean; onClick: () => void; children: string }) {
  return (
    <a
      className={props.active ? "active" : ""}
      href="#"
      onClick={(e) => {
        e.preventDefault();
        props.onClick();
      }}
    >
      {props.children}
    </a>
  );
}

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
    if (hash === "hangar" || hash === "ref" || hash === "gantt" || hash === "import" || hash === "profile" || hash === "admin")
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

  return (
    <div className="appShell">
      <aside className="nav">
        <h1>Hangar Planning</h1>
        {permissions.includes("events:read") ? (
          <>
            <NavLink active={page === "gantt"} onClick={() => setPage("gantt")}>
              План (Гантт)
            </NavLink>
            <NavLink active={page === "hangar"} onClick={() => setPage("hangar")}>
              Ангар (схема)
            </NavLink>
          </>
        ) : null}

        {permissions.includes("events:write") ? (
          <NavLink active={page === "import"} onClick={() => setPage("import")}>
            Импорт событий
          </NavLink>
        ) : null}

        {permissions.includes("ref:read") ? (
          <NavLink active={page === "ref"} onClick={() => setPage("ref")}>
            Справочники
          </NavLink>
        ) : null}

        <NavLink active={page === "profile"} onClick={() => setPage("profile")}>
          Профиль
        </NavLink>

        {permissions.includes("admin:users") || permissions.includes("admin:roles") ? (
          <NavLink active={page === "admin"} onClick={() => setPage("admin")}>
            Админка
          </NavLink>
        ) : null}
      </aside>

      <main className="content">
        {page === "gantt" && <GanttView />}
        {page === "hangar" && <HangarView />}
        {page === "import" && <EventImportView />}
        {page === "ref" && <ReferenceView />}
        {page === "profile" && <ProfileView me={me} />}
        {page === "admin" && <AdminView permissions={permissions} />}
      </main>
    </div>
  );
}

