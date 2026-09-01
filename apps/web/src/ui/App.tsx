import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { HangarView } from "./pages/HangarView";
import { GanttView } from "./pages/GanttView";
import { BulkEventsView } from "./pages/BulkEventsView";
import { ReferenceView } from "./pages/ReferenceView";
import { LoginView } from "./pages/LoginView";
import { ProfileView } from "./pages/ProfileView";
import { AdminView } from "./pages/AdminView";
import { SandboxesView } from "./pages/SandboxesView";
import { AnalyticsView } from "./pages/AnalyticsView";
import { MailDigestView } from "./pages/MailDigestView";
import { RmItpView } from "./pages/RmItpView";
import { HelpView } from "./pages/HelpView";
import { NavSandboxMenu, useActiveSandbox } from "./components/SandboxSwitcher";
import { NotificationBell } from "./components/NotificationBell";
import { AnnouncementModal } from "./components/AnnouncementModal";
import { useIsMobile } from "./hooks/useIsMobile";
import { authMe } from "./auth/authApi";
import { getActiveSandboxId, setActiveSandboxId } from "../lib/api";
import { installPresenceTracker, reportPageView } from "../lib/presence";
import { installFourDigitDateYearLimit } from "../lib/dateInput";
import {
  applyEventDeepLink,
  eventDeepLinkFromHashQuery,
  parseHashPage
} from "../lib/eventDeepLink";
import { hasPermission } from "../lib/permissionCatalog";
import { firstAllowedPage, APPLY_HOME_KEY, resolveStartPage } from "../lib/userPrefs";

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
  | "mail"
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
    value === "mail" ||
    value === "help"
  );
}

function pageFromHash(hashRaw: string): Page | null {
  const { page } = parseHashPage(hashRaw);
  return isPage(page) ? page : null;
}

function consumeEventDeepLinkFromHash() {
  const { page, query } = parseHashPage(location.hash);
  const link = eventDeepLinkFromHashQuery(query);
  if (!link) return null;

  const targetSandbox = link.sandboxId ?? null;
  const current = getActiveSandboxId();
  if ((targetSandbox || null) !== (current || null)) {
    setActiveSandboxId(targetSandbox);
  }
  applyEventDeepLink(link);

  const cleanPage = isPage(page) ? page : "gantt";
  const next = `${location.pathname}${location.search}#${cleanPage}`;
  try {
    history.replaceState(null, "", next);
  } catch {
    location.hash = cleanPage;
  }
  return cleanPage as Page;
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
  mass: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </svg>
  ),
  itp: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M15 4v4h4" />
      <path d="M9 12h6M9 16h4" />
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
  mail: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 7 9-7" />
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
  const isMobile = useIsMobile();
  const meQ = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => authMe(),
    retry: 0
  });

  const me = meQ.data && meQ.data.ok ? meQ.data.user : null;
  const permissions = me?.permissions ?? [];

  const [page, setPage] = useState<Page | null>(() => pageFromHash(location.hash));
  const resolvedPage: Page | null = page ?? (me ? resolveStartPage(me.homePage, permissions, isMobile) : null);

  useEffect(() => {
    if (resolvedPage == null) return;
    const desired = resolvedPage;
    const { page: hashPage, query } = parseHashPage(location.hash);
    // Не затираем deep-link (`#gantt?event=...`), пока его не обработали.
    if (hashPage === desired && query.get("event")) return;
    // Подпуть админки (`#admin/users`) пишет сам AdminView.
    if (desired === "admin" && hashPage === "admin") return;
    if (hashPage === desired && !query.toString()) return;
    location.hash = desired;
  }, [resolvedPage]);

  useEffect(() => {
    const opened = consumeEventDeepLinkFromHash();
    if (opened) setPage(opened);

    const onHashChange = () => {
      const openedFromHash = consumeEventDeepLinkFromHash();
      if (openedFromHash) {
        setPage(openedFromHash);
        return;
      }
      setPage(pageFromHash(location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!me) return;
    let apply = false;
    try {
      apply = sessionStorage.getItem(APPLY_HOME_KEY) === "1";
      if (apply) sessionStorage.removeItem(APPLY_HOME_KEY);
    } catch {
      apply = false;
    }
    if (!apply) return;
    if (parseHashPage(location.hash).query.get("event")) return;
    setPage(resolveStartPage(me.homePage, me.permissions, isMobile));
  }, [me, isMobile]);

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

  if (me.mustChangePassword) {
    return <LoginView forcedEmail={me.email} />;
  }

  if (!resolvedPage) {
    return (
      <div className="content">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  const canGantt = hasPermission(permissions, "gantt:read");
  const canHangar = hasPermission(permissions, "hangar:read");
  const canAnalytics = hasPermission(permissions, "analytics:read");
  const canItp = hasPermission(permissions, "itp:read");
  const canImport = hasPermission(permissions, "import:write");
  const canRef = hasPermission(permissions, "ref:read");
  const canAdmin = hasPermission(permissions, "admin:users") || hasPermission(permissions, "admin:roles");
  const canMail = hasPermission(permissions, "mail:send") || hasPermission(permissions, "admin:mail");
  const canNotify = canGantt || canHangar || hasPermission(permissions, "events:read");

  return (
    <AppShell
      me={me}
      permissions={permissions}
      page={resolvedPage}
      setPage={setPage}
      canGantt={canGantt}
      canHangar={canHangar}
      canAnalytics={canAnalytics}
      canItp={canItp}
      canImport={canImport}
      canRef={canRef}
      canAdmin={canAdmin}
      canMail={canMail}
      canNotify={canNotify}
    />
  );
}

function AppShell(props: {
  me: any;
  permissions: string[];
  page: Page;
  setPage: (p: Page) => void;
  canGantt: boolean;
  canHangar: boolean;
  canAnalytics: boolean;
  canItp: boolean;
  canImport: boolean;
  canRef: boolean;
  canAdmin: boolean;
  canMail: boolean;
  canNotify: boolean;
}) {
  const {
    me,
    permissions,
    page,
    setPage,
    canGantt,
    canHangar,
    canAnalytics,
    canItp,
    canImport,
    canRef,
    canAdmin,
    canMail,
    canNotify
  } = props;
  const isMobile = useIsMobile();
  const { active: activeSandbox } = useActiveSandbox();
  const inSandbox = Boolean(activeSandbox);
  const sandboxCanWrite = activeSandbox?.myRole === "OWNER" || activeSandbox?.myRole === "EDITOR";
  const canImportInActiveContext = canImport || sandboxCanWrite;

  useEffect(() => installFourDigitDateYearLimit(), []);

  const lastBulkTabRef = useRef<"import" | "mass">(page === "mass" ? "mass" : "import");
  useEffect(() => {
    if (page === "import" || page === "mass") lastBulkTabRef.current = page;
  }, [page]);

  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    reportPageView(page);
  }, [page]);
  useEffect(() => installPresenceTracker(() => pageRef.current), []);

  useEffect(() => {
    const allowed: Record<Page, boolean> = {
      gantt: canGantt,
      hangar: canHangar,
      analytics: canAnalytics,
      itp: canItp && !isMobile,
      import: canImportInActiveContext && !isMobile,
      mass: canImportInActiveContext && !isMobile,
      ref: canRef && !isMobile,
      mail: canMail && !isMobile,
      admin: canAdmin && !isMobile,
      profile: true,
      sandboxes: true,
      help: true
    };
    if (!allowed[page]) setPage(firstAllowedPage(permissions, isMobile));
  }, [
    page,
    setPage,
    permissions,
    isMobile,
    canGantt,
    canHangar,
    canAnalytics,
    canItp,
    canImportInActiveContext,
    canRef,
    canMail,
    canAdmin
  ]);

  const shellClass = [
    "appShell",
    inSandbox ? "appShellSandbox" : "appShellProd",
    isMobile ? "appShellMobile" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
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

        <div className="navScroll">
          <div className="navGroup">
            {canGantt ? (
              <NavIcon active={page === "gantt"} onClick={() => setPage("gantt")} label="План (Гантт)" icon={ICONS.gantt} />
            ) : null}
            {canHangar ? (
              <NavIcon active={page === "hangar"} onClick={() => setPage("hangar")} label="Ангар (схема)" icon={ICONS.hangar} />
            ) : null}
            {canAnalytics ? (
              <NavIcon active={page === "analytics"} onClick={() => setPage("analytics")} label="Аналитика" icon={ICONS.analytics} />
            ) : null}
            {!isMobile && canItp ? (
              <NavIcon active={page === "itp"} onClick={() => setPage("itp")} label="РМ ИТП" icon={ICONS.itp} />
            ) : null}

            {!isMobile && canMail ? (
              <NavIcon active={page === "mail"} onClick={() => setPage("mail")} label="Рассылка" icon={ICONS.mail} />
            ) : null}

            {!isMobile && canImportInActiveContext ? (
              <NavIcon
                active={page === "import" || page === "mass"}
                onClick={() => setPage(lastBulkTabRef.current)}
                label="Импорт/План"
                icon={ICONS.mass}
              />
            ) : null}

            {!isMobile && canRef ? (
              <NavIcon active={page === "ref"} onClick={() => setPage("ref")} label="Справочники" icon={ICONS.ref} />
            ) : null}

            <NavSandboxMenu active={page === "sandboxes"} icon={ICONS.sandboxes} onManage={() => setPage("sandboxes")} />
          </div>

          <div className="navGroup navGroupBottom">
            {canNotify ? (
              <NotificationBell
                enabled
                onOpenEvent={(detail) => {
                  const targetSandbox = detail.sandboxId ?? null;
                  const current = getActiveSandboxId();
                  if ((targetSandbox || null) !== (current || null)) {
                    setActiveSandboxId(targetSandbox);
                  }
                  setPage(canGantt ? "gantt" : canHangar ? "hangar" : firstAllowedPage(permissions, isMobile));
                }}
              />
            ) : null}
            <NavIcon active={page === "help"} onClick={() => setPage("help")} label="Инструкция" icon={ICONS.help} />
            <NavIcon active={page === "profile"} onClick={() => setPage("profile")} label="Профиль" icon={ICONS.profile} />
            {!isMobile && canAdmin ? (
              <NavIcon active={page === "admin"} onClick={() => setPage("admin")} label="Админка" icon={ICONS.admin} />
            ) : null}
          </div>
        </div>
      </aside>

      <main className="content">
        {me.writeBlocked ? (
          <div className="writeBlockedBanner" role="status">
            Контур в режиме только просмотр. Изменения плана, ангара и справочников недоступны.
          </div>
        ) : null}
        {page === "gantt" && canGantt ? <GanttView /> : null}
        {page === "hangar" && canHangar ? <HangarView /> : null}
        {!isMobile && page === "itp" && canItp ? <RmItpView /> : null}
        {!isMobile && canImportInActiveContext && (page === "import" || page === "mass") ? (
          <BulkEventsView tab={page === "mass" ? "mass" : "import"} onTab={(tab) => setPage(tab)} />
        ) : null}
        {!isMobile && page === "ref" && canRef ? <ReferenceView /> : null}
        {page === "profile" ? (
          <ProfileView
            me={me}
            onNavigate={(next) => {
              setPage(next);
            }}
          />
        ) : null}
        {!isMobile && page === "admin" && canAdmin ? <AdminView permissions={permissions} me={me} /> : null}
        {page === "sandboxes" ? <SandboxesView permissions={permissions} /> : null}
        {page === "analytics" && canAnalytics ? <AnalyticsView /> : null}
        {!isMobile && page === "mail" && canMail ? <MailDigestView /> : null}
        {page === "help" ? (
          <HelpView
            permissions={permissions}
            onNavigate={(p, hash) => {
              if (hash) {
                const next = hash.replace(/^#/, "");
                try {
                  history.replaceState(null, "", `${location.pathname}${location.search}#${next}`);
                } catch {
                  location.hash = next;
                }
              }
              setPage(p as Page);
            }}
          />
        ) : null}
      </main>
      <AnnouncementModal />
    </div>
  );
}
