import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import { isValidDateInput } from "../../lib/dateInput";
import {
  adminTabFromHash,
  buildAdminHash,
  parseHashPage,
  type AdminHashTab
} from "../../lib/eventDeepLink";
import { permissionCodesFromIds, summarizeRolePermissions, previewNavLabels, nextCloneRoleCode } from "../../lib/permissionCatalog";
import { ActivityFeed } from "../components/ActivityFeed";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { PermissionMatrix } from "../components/PermissionMatrix";
import type { SandboxSummary } from "../components/SandboxSwitcher";
import { SwitchToggle } from "../components/SwitchToggle";
import { formatPresenceWhen, UserPresencePanel } from "../components/UserPresencePanel";
import { AdminAnnouncementsPanel } from "./AdminAnnouncementsPanel";
import { AdminOverview } from "./AdminOverview";
import { AdminReportsPanel } from "./AdminReportsPanel";
import { AdminSandboxesPanel } from "./AdminSandboxesPanel";

type Role = { id: string; code: string; name: string; isSystem: boolean; permissions: { permission: Permission }[] };
type Permission = { id: string; code: string; name: string };
type User = {
  id: string;
  email: string;
  displayName?: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  dbAccessEnabled?: boolean;
  pgRoleName?: string | null;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  roles: { role: { id: string; code: string; name: string } }[];
};
type EventTypeRef = { id: string; code: string; name: string };
type AircraftTypeRef = { id: string; icaoType?: string | null; name: string };
type AircraftRef = { id: string; tailNumber: string; type?: AircraftTypeRef | null };
type CleanupEventItem = {
  id: string;
  title: string;
  status: string;
  startAt: string;
  endAt: string;
  aircraft?: { tailNumber: string; type?: AircraftTypeRef | null } | null;
  virtualAircraft?: { operatorId?: string; aircraftTypeId?: string; label?: string } | null;
  eventType?: { name: string; code?: string | null } | null;
};
type CleanupPreview = { ok: true; total: number; items: CleanupEventItem[] };
type CleanupApplyResult = { ok: true; updated: number };

type MailDigestSettings = {
  id: string;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  hasPassword: boolean;
  mailFrom: string | null;
  updatedAt: string;
};

type AdminTab = AdminHashTab;
type AdminGroup = "overview" | "people" | "access" | "comms" | "risk";
type AdminUserFilter = "all" | "active" | "inactive" | "password";

const TAB_META: Record<AdminTab, { label: string; group: AdminGroup; danger?: boolean }> = {
  overview: { label: "Обзор", group: "overview" },
  users: { label: "Пользователи", group: "people" },
  activity: { label: "Журнал", group: "people" },
  presence: { label: "Присутствие", group: "people" },
  roles: { label: "Роли", group: "access" },
  announce: { label: "Объявления", group: "comms" },
  mail: { label: "SMTP", group: "comms" },
  cleanup: { label: "Очистка", group: "risk", danger: true },
  sandboxes: { label: "Песочницы", group: "risk" },
  reports: { label: "Отчёты", group: "risk" }
};

const ADMIN_GROUPS: Array<{ id: AdminGroup; label: string; danger?: boolean }> = [
  { id: "overview", label: "Обзор" },
  { id: "people", label: "Люди" },
  { id: "access", label: "Доступ" },
  { id: "comms", label: "Коммуникации" },
  { id: "risk", label: "Данные и риск", danger: true }
];

function writeAdminLocation(tab: AdminTab, invite: boolean) {
  const next = `#${buildAdminHash(tab, { invite: invite && tab === "users" })}`;
  const current = `#${(location.hash || "").replace(/^#/, "")}`;
  if (current === next) return;
  try {
    history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
  } catch {
    location.hash = next.slice(1);
  }
}

function codesFromRoleIds(roleIds: Iterable<string>, catalog: Role[]): string[] {
  const ids = new Set(roleIds);
  return [
    ...new Set(
      catalog.filter((r) => ids.has(r.id)).flatMap((r) => r.permissions.map((p) => p.permission.code))
    )
  ];
}

type AdminUser = {
  email: string;
  displayName?: string | null;
  roles?: string[];
  writeBlocked?: boolean;
};

function userInitials(u: User): string {
  const base = (u.displayName ?? u.email).trim();
  if (!base) return "?";
  const parts = base.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function IconSave(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 4.5A1.5 1.5 0 0 1 5.5 3h7.379a1.5 1.5 0 0 1 1.06.44l1.621 1.62A1.5 1.5 0 0 1 16 6.122V15.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M7 3.5V7h6V3.5M7 16.5v-4h6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconKey(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 9.5 16 15m-2.5-2.5L15 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m4 14.5-.5 2 2-.5L15 6.5 13.5 5 4 14.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m12.5 6 1.5 1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 6h11M8 3.5h4M6.5 6l.5 10h6l.5-10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHeat() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="8" width="3" height="8" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.5" y="4" width="3" height="12" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="14" y="10" width="3" height="6" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8.75" cy="8.75" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12.5 12.5 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 4v12" />
      <path d="M4 10h12" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function AdminView(props: { permissions: string[]; me?: AdminUser }) {
  const qc = useQueryClient();
  const canUsers = props.permissions.includes("admin:users");
  const canRoles = props.permissions.includes("admin:roles");
  const canCleanup = props.permissions.includes("admin:cleanup");
  const canMail = props.permissions.includes("admin:mail");

  const availableTabs = useMemo(() => {
    const tabs: Array<{ id: AdminTab; label: string; group: AdminGroup; danger?: boolean }> = [];
    const add = (id: AdminTab) => tabs.push({ id, ...TAB_META[id] });
    add("overview");
    if (canUsers) add("users");
    if (canUsers) add("activity");
    if (canUsers) add("presence");
    if (canRoles) add("roles");
    if (canUsers) add("announce");
    if (canMail) add("mail");
    if (canCleanup) add("cleanup");
    if (canUsers) add("sandboxes");
    if (canUsers) add("reports");
    return tabs;
  }, [canUsers, canRoles, canCleanup, canMail]);

  const [tab, setTab] = useState<AdminTab>(() => adminTabFromHash(location.hash) ?? "overview");
  const [inviteOpen, setInviteOpen] = useState(() => parseHashPage(location.hash).query.get("invite") === "1");
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [userFilter, setUserFilter] = useState<AdminUserFilter>("all");
  const [userRoleFilter, setUserRoleFilter] = useState("");
  const [userPage, setUserPage] = useState(0);
  const [userPageSize, setUserPageSize] = useState(10);
  const [presenceUserId, setPresenceUserId] = useState<string | null>(null);

  const permsQ = useQuery({
    queryKey: ["admin", "permissions"],
    queryFn: () => apiGet<Permission[]>("/api/admin/permissions"),
    enabled: canRoles
  });
  const rolesQ = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => apiGet<Role[]>("/api/admin/roles"),
    enabled: canRoles || canUsers
  });
  const usersQ = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiGet<User[]>("/api/admin/users"),
    enabled: canUsers
  });
  const cleanupEventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<EventTypeRef[]>("/api/ref/event-types"),
    enabled: canCleanup && tab === "cleanup"
  });
  const cleanupAircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftTypeRef[]>("/api/ref/aircraft-types"),
    enabled: canCleanup && tab === "cleanup"
  });
  const cleanupAircraftQ = useQuery({
    queryKey: ["ref", "aircraft"],
    queryFn: () => apiGet<AircraftRef[]>("/api/ref/aircraft"),
    enabled: canCleanup && tab === "cleanup"
  });
  const cleanupSandboxesQ = useQuery({
    queryKey: ["sandboxes"],
    queryFn: () => apiGet<SandboxSummary[]>("/api/sandboxes"),
    enabled: canCleanup && tab === "cleanup"
  });

  const [uEmail, setUEmail] = useState("");
  const [uName, setUName] = useState("");
  const [uPass, setUPass] = useState("");
  const [uRoleIds, setURoleIds] = useState<string[]>([]);
  const [cleanupEventId, setCleanupEventId] = useState("");
  const [cleanupTarget, setCleanupTarget] = useState<"prod" | "sandbox">("prod");
  const [cleanupSandboxId, setCleanupSandboxId] = useState("");
  const [cleanupEventTypeId, setCleanupEventTypeId] = useState("");
  const [cleanupAircraftTypeId, setCleanupAircraftTypeId] = useState("");
  const [cleanupAircraftId, setCleanupAircraftId] = useState("");
  const [cleanupFrom, setCleanupFrom] = useState("");
  const [cleanupTo, setCleanupTo] = useState("");
  const [cleanupConfirmBulk, setCleanupConfirmBulk] = useState(false);
  const [cleanupPassword, setCleanupPassword] = useState("");
  const [cleanupReason, setCleanupReason] = useState("");
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);

  const [mailSmtpHost, setMailSmtpHost] = useState("smtp.yandex.ru");
  const [mailSmtpPort, setMailSmtpPort] = useState("465");
  const [mailSmtpSecure, setMailSmtpSecure] = useState(true);
  const [mailSmtpUser, setMailSmtpUser] = useState("");
  const [mailSmtpPass, setMailSmtpPass] = useState("");
  const [mailFrom, setMailFrom] = useState("");
  const [mailHasPassword, setMailHasPassword] = useState(false);
  const [mailTestTo, setMailTestTo] = useState("");
  const [mailSettingsHydrated, setMailSettingsHydrated] = useState(false);

  const mailSettingsQ = useQuery({
    queryKey: ["admin", "mail-digest", "settings"],
    queryFn: () => apiGet<MailDigestSettings>("/api/admin/mail-digest/settings"),
    enabled: canMail && (tab === "mail" || tab === "overview")
  });

  useEffect(() => {
    if (!mailSettingsQ.data || mailSettingsHydrated) return;
    const s = mailSettingsQ.data;
    setMailSmtpHost(s.smtpHost ?? "smtp.yandex.ru");
    setMailSmtpPort(String(s.smtpPort ?? 465));
    setMailSmtpSecure(s.smtpSecure);
    setMailSmtpUser(s.smtpUser ?? "");
    setMailFrom(s.mailFrom ?? "");
    setMailHasPassword(s.hasPassword);
    setMailSettingsHydrated(true);
  }, [mailSettingsQ.data, mailSettingsHydrated]);

  const saveMailSettingsM = useMutation({
    mutationFn: () =>
      apiPut<MailDigestSettings>("/api/admin/mail-digest/settings", {
        smtpHost: mailSmtpHost.trim() || null,
        smtpPort: Number(mailSmtpPort) || 465,
        smtpSecure: mailSmtpSecure,
        smtpUser: mailSmtpUser.trim() || null,
        smtpPass: mailSmtpPass.trim() || undefined,
        mailFrom: mailFrom.trim() || null
      }),
    onSuccess: async (s) => {
      setMailSmtpPass("");
      setMailHasPassword(s.hasPassword);
      await qc.invalidateQueries({ queryKey: ["admin", "mail-digest", "settings"] });
    }
  });

  const mailTestM = useMutation({
    mutationFn: () =>
      apiPost<{ ok: true; messageId: string; to: string }>("/api/admin/mail-digest/test", {
        ...(mailTestTo.trim() ? { to: mailTestTo.trim() } : {})
      })
  });

  const cleanupPayload = () => ({
    ...(cleanupTarget === "sandbox" && cleanupSandboxId ? { sandboxId: cleanupSandboxId } : {}),
    ...(cleanupEventId.trim() ? { eventId: cleanupEventId.trim() } : {}),
    ...(cleanupEventTypeId ? { eventTypeId: cleanupEventTypeId } : {}),
    ...(cleanupAircraftTypeId ? { aircraftTypeId: cleanupAircraftTypeId } : {}),
    ...(cleanupAircraftId ? { aircraftId: cleanupAircraftId } : {}),
    ...(isValidDateInput(cleanupFrom) ? { from: new Date(`${cleanupFrom}T00:00:00`).toISOString() } : {}),
    ...(isValidDateInput(cleanupTo) ? { to: new Date(`${cleanupTo}T23:59:59`).toISOString() } : {}),
    ...(cleanupConfirmBulk ? { confirmBulk: true } : {})
  });
  const cleanupHasFilters = Boolean(
    cleanupEventId.trim() ||
      cleanupEventTypeId ||
      cleanupAircraftTypeId ||
      cleanupAircraftId ||
      cleanupFrom ||
      cleanupTo ||
      cleanupConfirmBulk
  );
  const cleanupTargetReady = cleanupTarget === "prod" || Boolean(cleanupSandboxId);
  const cleanupTargetLabel =
    cleanupTarget === "sandbox"
      ? `песочницы «${(cleanupSandboxesQ.data ?? []).find((sandbox) => sandbox.id === cleanupSandboxId)?.name ?? "—"}»`
      : "рабочего контура";

  const cleanupPreviewM = useMutation({
    mutationFn: () => apiPost<CleanupPreview>("/api/admin/cleanup/events/preview", cleanupPayload()),
    onSuccess: (res) => setCleanupPreview(res)
  });
  const cleanupApplyM = useMutation({
    mutationFn: () =>
      apiPost<CleanupApplyResult>("/api/admin/cleanup/events/apply", {
        ...cleanupPayload(),
        password: cleanupPassword,
        reason: cleanupReason.trim() || undefined
      }),
    onSuccess: async () => {
      setCleanupPassword("");
      setCleanupPreview(null);
      await qc.invalidateQueries({ queryKey: ["events"] });
      await qc.invalidateQueries({ queryKey: ["reservations"] });
      await qc.invalidateQueries({ queryKey: ["hangar-planning"] });
      await qc.invalidateQueries({ queryKey: ["sandboxes"] });
      await qc.invalidateQueries({ queryKey: ["admin", "activity"] });
    }
  });

  const createUserM = useMutation({
    mutationFn: () =>
      apiPost<User>("/api/admin/users", {
        email: uEmail,
        displayName: uName || undefined,
        password: uPass,
        roleIds: uRoleIds
      }),
    onSuccess: async () => {
      setUEmail("");
      setUName("");
      setUPass("");
      setURoleIds([]);
      setInviteOpen(false);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    }
  });

  const [rCode, setRCode] = useState("");
  const [rName, setRName] = useState("");
  const [rPermIds, setRPermIds] = useState<string[]>([]);

  const createRoleM = useMutation({
    mutationFn: () => apiPost<Role>("/api/admin/roles", { code: rCode, name: rName, permissionIds: rPermIds }),
    onSuccess: async () => {
      setRCode("");
      setRName("");
      setRPermIds([]);
      setCreateRoleOpen(false);
      await qc.invalidateQueries({ queryKey: ["admin", "roles"] });
      await qc.invalidateQueries({ queryKey: ["admin", "permissions"] });
    }
  });

  const roles = rolesQ.data ?? [];
  const permissions = permsQ.data ?? [];

  const roleOptions = useMemo(
    () => roles.map((r) => ({ id: r.id, label: `${r.code} • ${r.name}` })),
    [roles]
  );

  const activityActors = useMemo(
    () =>
      (usersQ.data ?? []).map((u) => ({
        email: u.email,
        label: u.displayName ? `${u.displayName} (${u.email})` : u.email
      })),
    [usersQ.data]
  );

  const filteredUsers = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const list = usersQ.data ?? [];
    return list.filter((u) => {
      const hay = [
        u.email,
        u.displayName ?? "",
        ...u.roles.map((r) => r.role.code),
        ...u.roles.map((r) => r.role.name)
      ]
        .join(" ")
        .toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (userRoleFilter && !u.roles.some((r) => r.role.id === userRoleFilter)) return false;
      if (userFilter === "active" && !u.isActive) return false;
      if (userFilter === "inactive" && u.isActive) return false;
      if (userFilter === "password" && !u.mustChangePassword) return false;
      return true;
    });
  }, [usersQ.data, listSearch, userRoleFilter, userFilter]);

  const filteredRoles = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const list = rolesQ.data ?? [];
    if (!q) return list;
    return list.filter((r) => {
      const codes = r.permissions.map((x) => x.permission.code);
      const hay = [r.name, r.code, summarizeRolePermissions(codes)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rolesQ.data, listSearch]);

  const navGroups = useMemo(() => {
    return ADMIN_GROUPS.map((group) => ({
      ...group,
      tabs: availableTabs.filter((t) => t.group === group.id)
    })).filter((group) => group.tabs.length > 0);
  }, [availableTabs]);

  const activeTab = availableTabs.some((t) => t.id === tab) ? tab : availableTabs[0]?.id ?? "overview";
  const activeGroup = TAB_META[activeTab].group;
  const groupTabs = navGroups.find((g) => g.id === activeGroup)?.tabs ?? [];
  const searchPlaceholder =
    activeTab === "roles"
      ? "Поиск ролей…"
      : activeTab === "users" || activeTab === "presence"
        ? "Поиск пользователей…"
        : activeTab === "sandboxes"
          ? "Поиск песочниц…"
          : activeTab === "reports"
            ? "Поиск отчётов…"
            : "Поиск…";
  const canCreateOnTab = (activeTab === "users" && canUsers) || (activeTab === "roles" && canRoles);
  const createOpen = activeTab === "users" ? inviteOpen : activeTab === "roles" ? createRoleOpen : false;
  const createLabel = activeTab === "roles" ? "Создать роль" : "Пригласить пользователя";

  useEffect(() => {
    if (tab !== "users") setInviteOpen(false);
    if (tab !== "roles") setCreateRoleOpen(false);
  }, [tab]);

  useEffect(() => {
    if (availableTabs.length === 0) return;
    writeAdminLocation(activeTab, inviteOpen);
  }, [activeTab, inviteOpen, availableTabs.length]);

  useEffect(() => {
    const onHashChange = () => {
      const parsed = adminTabFromHash(location.hash);
      if (parsed && availableTabs.some((t) => t.id === parsed)) setTab(parsed);
      setInviteOpen(parseHashPage(location.hash).query.get("invite") === "1");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [availableTabs]);

  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
  const safeUserPage = Math.min(userPage, userPageCount - 1);
  const pagedUsers = filteredUsers.slice(safeUserPage * userPageSize, (safeUserPage + 1) * userPageSize);
  const activeUsersCount = (usersQ.data ?? []).filter((u) => u.isActive).length;
  const tempPasswordCount = (usersQ.data ?? []).filter((u) => u.mustChangePassword).length;
  const canDeleteSandboxes = (props.me?.roles ?? []).some((code) => code === "ADMIN" || code === "SUPER_ADMIN");

  if (availableTabs.length === 0) {
    return (
      <div className="adminPage">
        <div className="card adminPanel">
          <div className="error">Нет прав администратора.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <header className="adminHeader">
        <div className="adminHeaderMain">
          <div>
            <h1 className="adminTitle">Административная панель</h1>
          </div>
          <div className="adminHeaderStats" aria-label="Сводка">
            <div className="adminHeaderStat">
              <strong>{usersQ.data?.length ?? 0}</strong>
              <span>пользователей</span>
            </div>
            <div className="adminHeaderStat">
              <strong>{activeUsersCount}</strong>
              <span>активных</span>
            </div>
            <div className="adminHeaderStat">
              <strong>{roles.length}</strong>
              <span>ролей</span>
            </div>
          </div>
        </div>
        <div className="adminHeaderTools">
          {canCreateOnTab ? (
            <button
              type="button"
              className="btn btnPrimary ganttIconBtn"
              aria-pressed={createOpen}
              aria-label={createLabel}
              title={createLabel}
              onClick={() => {
                if (activeTab === "roles") setCreateRoleOpen((v) => !v);
                else setInviteOpen((v) => !v);
              }}
            >
              <IconPlus />
            </button>
          ) : null}
          <label className="adminHeaderSearch">
            <IconSearch />
            <input
              type="search"
              value={listSearch}
              onChange={(e) => {
                setListSearch(e.target.value);
                setUserPage(0);
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </label>
          <div className="adminProfileChip" title={props.me?.email}>
            <span className="adminProfileAvatar" aria-hidden="true">
              {(props.me?.displayName ?? props.me?.email ?? "A").slice(0, 2).toUpperCase()}
            </span>
            <span className="adminProfileText">
              <strong>{props.me?.displayName ?? "Администратор"}</strong>
              <small>{props.me?.email ?? "Текущий пользователь"}</small>
            </span>
          </div>
        </div>
      </header>

      <nav className="adminNav" aria-label="Разделы админки">
        <div className="adminNavGroups" role="tablist" aria-label="Группы">
          {navGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={activeGroup === group.id}
              className={`adminNavGroup${activeGroup === group.id ? " adminNavGroupActive" : ""}${group.danger ? " adminNavGroupDanger" : ""}`}
              onClick={() => {
                if (activeGroup !== group.id) setListSearch("");
                if (!group.tabs.some((t) => t.id === activeTab)) setTab(group.tabs[0]!.id);
              }}
            >
              {group.label}
            </button>
          ))}
        </div>
        {groupTabs.length > 1 ? (
          <div className="adminTabs" role="tablist" aria-label={navGroups.find((g) => g.id === activeGroup)?.label ?? "Вкладки"}>
            {groupTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`adminTab${activeTab === t.id ? " adminTabActive" : ""}${t.danger ? " adminTabDanger" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}
      </nav>

      {activeTab === "overview" ? (
        <AdminOverview
          canUsers={canUsers}
          canRoles={canRoles}
          canMail={canMail}
          canRuntime={canUsers || canCleanup}
          usersCount={usersQ.data?.length ?? 0}
          activeUsersCount={activeUsersCount}
          tempPasswordCount={tempPasswordCount}
          rolesCount={roles.length}
          writeBlocked={Boolean(props.me?.writeBlocked)}
          onGo={(next) => setTab(next)}
        />
      ) : null}

      {activeTab === "users" && canUsers ? (
        <div className="adminUsersLayout">
          {inviteOpen ? (
          <section className="card adminInviteCard">
            <div className="adminInviteHead">
              <div>
                <div className="adminInviteTitle">Пригласить пользователя</div>
                <div className="muted adminHint">
                  Создайте учётную запись с временным паролем. При первом входе потребуется смена пароля.
                </div>
              </div>
              <button
                type="button"
                className="btn ganttIconBtn adminInviteClose"
                aria-label="Закрыть форму приглашения"
                onClick={() => setInviteOpen(false)}
              >
                <IconClose />
              </button>
            </div>
            <div className="adminInviteGrid">
              <label className="adminField">
                <span className="muted">Email</span>
                <input value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="user@company.com" />
              </label>
              <label className="adminField">
                <span className="muted">Имя</span>
                <input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Имя Фамилия" />
              </label>
              <label className="adminField">
                <span className="muted">Временный пароль</span>
                <input
                  type="password"
                  value={uPass}
                  onChange={(e) => setUPass(e.target.value)}
                  placeholder="минимум 8 символов"
                />
              </label>
              <div className="adminField">
                <span className="muted">Роли</span>
                <MultiSelectDropdown options={roleOptions} value={uRoleIds} onChange={setURoleIds} width={240} maxHeight={220} />
              </div>
              <div className="adminInviteSubmit">
                <button
                  className="btn btnPrimary"
                  disabled={!uEmail || uPass.length < 8 || createUserM.isPending}
                  onClick={() => createUserM.mutate()}
                >
                  Пригласить
                </button>
              </div>
            </div>
            {createUserM.error ? (
              <div className="error">{String(createUserM.error.message || createUserM.error)}</div>
            ) : null}
          </section>
          ) : null}

          <section className="card adminPanel">
            <div className="adminListToolbar">
              <div className="adminListTitle">
                <strong>Пользователи</strong>
                <span className="muted adminHint">
                  {filteredUsers.length}
                  {listSearch.trim() || userFilter !== "all" || userRoleFilter ? ` из ${usersQ.data?.length ?? 0}` : ""}
                </span>
              </div>
              <div className="adminFilters">
                <label>
                  <span>Статус</span>
                  <select
                    value={userFilter}
                    onChange={(e) => {
                      setUserFilter(e.target.value as AdminUserFilter);
                      setUserPage(0);
                    }}
                  >
                    <option value="all">Все</option>
                    <option value="active">Активные</option>
                    <option value="inactive">Отключённые</option>
                    <option value="password">Требуется смена пароля</option>
                  </select>
                </label>
                <label>
                  <span>Роль</span>
                  <select
                    value={userRoleFilter}
                    onChange={(e) => {
                      setUserRoleFilter(e.target.value);
                      setUserPage(0);
                    }}
                  >
                    <option value="">Все роли</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                </label>
                {userFilter !== "all" || userRoleFilter || listSearch ? (
                  <button
                    type="button"
                    className="adminFilterReset"
                    onClick={() => {
                      setListSearch("");
                      setUserFilter("all");
                      setUserRoleFilter("");
                      setUserPage(0);
                    }}
                  >
                    Сбросить
                  </button>
                ) : null}
              </div>
            </div>

            {usersQ.error ? <div className="error">{String(usersQ.error.message || usersQ.error)}</div> : null}

            <div className="adminTableWrap">
              <table className="table adminTable adminUsersTable">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Роли</th>
                    <th>Активен</th>
                    <th className="adminThActions">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <div className="muted adminEmpty">
                          {listSearch.trim() ? "Никого не найдено по запросу." : "Пользователей пока нет."}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pagedUsers.map((u) => <UserRow key={u.id} u={u} roles={roles} />)
                  )}
                </tbody>
              </table>
            </div>
            <footer className="adminTableFooter">
              <span className="muted">
                {filteredUsers.length === 0
                  ? "Нет записей"
                  : `${safeUserPage * userPageSize + 1}–${Math.min((safeUserPage + 1) * userPageSize, filteredUsers.length)} из ${filteredUsers.length}`}
              </span>
              <div className="adminPager">
                <label>
                  <span className="muted">На странице</span>
                  <select
                    value={userPageSize}
                    onChange={(e) => {
                      setUserPageSize(Number(e.target.value));
                      setUserPage(0);
                    }}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="adminPagerBtn"
                  disabled={safeUserPage === 0}
                  onClick={() => setUserPage(Math.max(0, safeUserPage - 1))}
                  aria-label="Предыдущая страница"
                >
                  ←
                </button>
                <span className="adminPagerPage">{safeUserPage + 1} / {userPageCount}</span>
                <button
                  type="button"
                  className="adminPagerBtn"
                  disabled={safeUserPage >= userPageCount - 1}
                  onClick={() => setUserPage(Math.min(userPageCount - 1, safeUserPage + 1))}
                  aria-label="Следующая страница"
                >
                  →
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {activeTab === "roles" && canRoles ? (
        <section className="card adminPanel">
          {createRoleOpen ? (
          <div className="adminInviteCard adminInviteCardNested">
            <div className="adminInviteHead">
              <div>
                <div className="adminInviteTitle">Новая роль</div>
              </div>
              <button
                type="button"
                className="btn ganttIconBtn adminInviteClose"
                aria-label="Закрыть форму новой роли"
                onClick={() => setCreateRoleOpen(false)}
              >
                <IconClose />
              </button>
            </div>
            <div className="adminInviteGrid adminRolesCreateGrid">
              <label className="adminField">
                <span className="muted">Код</span>
                <input value={rCode} onChange={(e) => setRCode(e.target.value)} placeholder="PLANNER_EAST" />
                <span className="muted adminHint">Латиница и цифры, стабильный id. После создания лучше не менять.</span>
              </label>
              <label className="adminField">
                <span className="muted">Название</span>
                <input value={rName} onChange={(e) => setRName(e.target.value)} />
              </label>
              <div className="adminInviteSubmit">
                <button
                  className="btn btnPrimary"
                  disabled={!rCode || !rName || createRoleM.isPending}
                  onClick={() => createRoleM.mutate()}
                >
                  Создать
                </button>
              </div>
            </div>
            <div className="adminRolesPermsField">
              <span className="muted">Доступ к модулям</span>
              <span className="adminRoleCardSummary">
                {summarizeRolePermissions(permissionCodesFromIds(rPermIds, permissions))}
              </span>
              <PermissionMatrix catalog={permissions} value={rPermIds} onChange={setRPermIds} />
            </div>
            {createRoleM.error ? (
              <div className="error">{String(createRoleM.error.message || createRoleM.error)}</div>
            ) : null}
          </div>
          ) : null}

          {rolesQ.error ? <div className="error">{String(rolesQ.error.message || rolesQ.error)}</div> : null}
          {permsQ.error ? <div className="error">{String(permsQ.error.message || permsQ.error)}</div> : null}

          <div className="adminRoleList">
            {filteredRoles.length === 0 ? (
              <div className="muted adminEmpty">
                {listSearch.trim() ? "Ролей по запросу не найдено." : "Ролей пока нет."}
              </div>
            ) : (
              filteredRoles.map((r) => (
                <RoleCard key={r.id} role={r} permissions={permissions} users={usersQ.data ?? []} />
              ))
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "activity" && canUsers ? (
        <ActivityFeed mode="admin" compact actors={activityActors} />
      ) : null}

      {activeTab === "presence" && canUsers ? (
        <UserPresencePanel
          users={(usersQ.data ?? []).filter((u) => {
            const q = listSearch.trim().toLowerCase();
            if (!q) return true;
            const hay = `${u.email} ${u.displayName ?? ""}`.toLowerCase();
            return hay.includes(q);
          })}
          selectedUserId={presenceUserId}
          onSelectUser={setPresenceUserId}
        />
      ) : null}

      {activeTab === "announce" && canUsers ? <AdminAnnouncementsPanel /> : null}

      {activeTab === "mail" && canMail ? (
        <section className="card adminPanel">
          <div className="adminSectionHead">
            <div>
              <strong>Системные настройки почты</strong>
              <div className="muted adminHint">
                SMTP остаётся в админке. Состав рассылки, превью и отправку планировщик делает в разделе «Рассылка».
              </div>
            </div>
          </div>

          <div className="adminSectionHead">
            <strong>SMTP</strong>
            <span className="muted">Yandex: smtp.yandex.ru, порт 465, SSL</span>
          </div>
          <div className="adminFormRow adminFormRowWrap">
            <label className="adminField">
              <span className="muted">Host</span>
              <input value={mailSmtpHost} onChange={(e) => setMailSmtpHost(e.target.value)} placeholder="smtp.yandex.ru" />
            </label>
            <label className="adminField">
              <span className="muted">Port</span>
              <input value={mailSmtpPort} onChange={(e) => setMailSmtpPort(e.target.value)} placeholder="465" />
            </label>
            <label className="adminField">
              <span className="muted">SSL/TLS</span>
              <div style={{ paddingTop: 6 }}>
                <SwitchToggle compact checked={mailSmtpSecure} onChange={setMailSmtpSecure} label={mailSmtpSecure ? "Да" : "Нет"} />
              </div>
            </label>
            <label className="adminField">
              <span className="muted">User</span>
              <input value={mailSmtpUser} onChange={(e) => setMailSmtpUser(e.target.value)} placeholder="user@yandex.ru" />
            </label>
            <label className="adminField">
              <span className="muted">Password {mailHasPassword ? "(задан)" : ""}</span>
              <input
                type="password"
                value={mailSmtpPass}
                onChange={(e) => setMailSmtpPass(e.target.value)}
                placeholder={mailHasPassword ? "оставьте пустым, чтобы не менять" : "пароль приложения"}
                autoComplete="new-password"
              />
            </label>
            <label className="adminField">
              <span className="muted">From</span>
              <input value={mailFrom} onChange={(e) => setMailFrom(e.target.value)} placeholder="user@yandex.ru" />
            </label>
          </div>

          <div className="adminFormRow" style={{ marginTop: 12 }}>
            <button className="btn btnPrimary" disabled={saveMailSettingsM.isPending} onClick={() => saveMailSettingsM.mutate()}>
              Сохранить настройки
            </button>
            <label className="adminField">
              <span className="muted">Тест на адрес</span>
              <input
                value={mailTestTo}
                onChange={(e) => setMailTestTo(e.target.value)}
                placeholder={mailSmtpUser || "email@…"}
              />
            </label>
            <button className="btn" disabled={mailTestM.isPending} onClick={() => mailTestM.mutate()}>
              Тест
            </button>
          </div>
          {saveMailSettingsM.error ? (
            <div className="error">{String(saveMailSettingsM.error.message || saveMailSettingsM.error)}</div>
          ) : null}
          {saveMailSettingsM.isSuccess ? <div className="muted">Настройки сохранены</div> : null}
          {mailTestM.error ? <div className="error">{String(mailTestM.error.message || mailTestM.error)}</div> : null}
          {mailTestM.data ? <div className="muted">Тест отправлен на {mailTestM.data.to}</div> : null}
        </section>
      ) : null}

      {activeTab === "cleanup" && canCleanup ? (
        <section className="card adminPanel adminDangerZone">
          <div className="adminSectionHead">
            <div>
              <strong>Очистка событий</strong>
              <div className="muted adminHint">Логическое удаление (статус «Удалено»). Только SUPER_ADMIN.</div>
            </div>
            <span className="gpChip gpChipError">опасно</span>
          </div>

          <div className="adminFormRow adminFormRowWrap">
            <label className="adminField">
              <span className="muted">Область</span>
              <select
                value={cleanupTarget}
                onChange={(e) => {
                  const next = e.target.value === "sandbox" ? "sandbox" : "prod";
                  setCleanupTarget(next);
                  if (next === "prod") setCleanupSandboxId("");
                  setCleanupPreview(null);
                }}
              >
                <option value="prod">Рабочий контур</option>
                <option value="sandbox">Песочница</option>
              </select>
            </label>
            {cleanupTarget === "sandbox" ? (
              <label className="adminField">
                <span className="muted">Песочница</span>
                <select
                  value={cleanupSandboxId}
                  onChange={(e) => {
                    setCleanupSandboxId(e.target.value);
                    setCleanupPreview(null);
                  }}
                >
                  <option value="">— выберите —</option>
                  {(cleanupSandboxesQ.data ?? []).map((sandbox) => (
                    <option key={sandbox.id} value={sandbox.id}>
                      {sandbox.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="adminField">
              <span className="muted">ID события</span>
              <input
                value={cleanupEventId}
                onChange={(e) => {
                  setCleanupEventId(e.target.value);
                  setCleanupPreview(null);
                }}
                placeholder="опционально"
              />
            </label>
            <label className="adminField">
              <span className="muted">Тип события</span>
              <select
                value={cleanupEventTypeId}
                onChange={(e) => {
                  setCleanupEventTypeId(e.target.value);
                  setCleanupPreview(null);
                }}
              >
                <option value="">— любой —</option>
                {(cleanupEventTypesQ.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="adminField">
              <span className="muted">Тип ВС</span>
              <select
                value={cleanupAircraftTypeId}
                onChange={(e) => {
                  setCleanupAircraftTypeId(e.target.value);
                  setCleanupPreview(null);
                }}
              >
                <option value="">— любой —</option>
                {(cleanupAircraftTypesQ.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icaoType ? `${t.icaoType} • ${t.name}` : t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="adminField">
              <span className="muted">Борт</span>
              <select
                value={cleanupAircraftId}
                onChange={(e) => {
                  setCleanupAircraftId(e.target.value);
                  setCleanupPreview(null);
                }}
              >
                <option value="">— любой —</option>
                {(cleanupAircraftQ.data ?? [])
                  .filter((a) => !cleanupAircraftTypeId || a.type?.id === cleanupAircraftTypeId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tailNumber}
                    </option>
                  ))}
              </select>
            </label>
            <label className="adminField">
              <span className="muted">с</span>
              <input
                type="date"
                value={cleanupFrom}
                onChange={(e) => {
                  setCleanupFrom(e.target.value);
                  setCleanupPreview(null);
                }}
              />
            </label>
            <label className="adminField">
              <span className="muted">по</span>
              <input
                type="date"
                value={cleanupTo}
                onChange={(e) => {
                  setCleanupTo(e.target.value);
                  setCleanupPreview(null);
                }}
              />
            </label>
            <button
              className="btn"
              disabled={!cleanupTargetReady || !cleanupHasFilters || cleanupPreviewM.isPending}
              onClick={() => cleanupPreviewM.mutate()}
            >
              Предпросмотр
            </button>
          </div>

          {!cleanupEventId.trim() && !cleanupFrom && !cleanupTo ? (
            <SwitchToggle
              compact
              checked={cleanupConfirmBulk}
              onChange={(v) => {
                setCleanupConfirmBulk(v);
                setCleanupPreview(null);
              }}
              label="Разрешить массовую очистку без периода"
            />
          ) : null}

          {cleanupPreviewM.error ? (
            <div className="error">{String(cleanupPreviewM.error.message || cleanupPreviewM.error)}</div>
          ) : null}
          {cleanupApplyM.error ? (
            <div className="error">{String(cleanupApplyM.error.message || cleanupApplyM.error)}</div>
          ) : null}
          {cleanupApplyM.data ? (
            <div className="muted">Переведено в статус «Удалено»: {cleanupApplyM.data.updated}</div>
          ) : null}

          {cleanupPreview ? (
            <div className="adminCleanupPreview">
              <div className="adminSectionHead">
                <strong>Найдено: {cleanupPreview.total}</strong>
                <span className="muted">показаны первые {cleanupPreview.items.length}</span>
              </div>
              <div className="adminTableWrap">
                <table className="table adminTable">
                  <thead>
                    <tr>
                      <th>Событие</th>
                      <th>Борт</th>
                      <th>Тип</th>
                      <th>Период</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cleanupPreview.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.title}</strong>
                          <div className="muted adminMono">{item.id}</div>
                        </td>
                        <td>{item.aircraft?.tailNumber ?? item.virtualAircraft?.label ?? "—"}</td>
                        <td>{item.eventType?.name ?? "—"}</td>
                        <td>
                          {new Date(item.startAt).toLocaleString("ru-RU")}
                          <div className="muted">до {new Date(item.endAt).toLocaleString("ru-RU")}</div>
                        </td>
                        <td>{item.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="adminFormRow">
                <label className="adminField adminFieldGrow">
                  <span className="muted">Причина</span>
                  <input
                    value={cleanupReason}
                    onChange={(e) => setCleanupReason(e.target.value)}
                    placeholder={`Очистка ${cleanupTargetLabel}`}
                  />
                </label>
                <label className="adminField">
                  <span className="muted">Ваш пароль</span>
                  <input
                    type="password"
                    value={cleanupPassword}
                    onChange={(e) => setCleanupPassword(e.target.value)}
                  />
                </label>
                <button
                  className="btn btnDanger"
                  disabled={cleanupPreview.total === 0 || !cleanupPassword || cleanupApplyM.isPending}
                  onClick={() => {
                    if (!confirm(`Перевести в статус «Удалено» ${cleanupPreview.total} событий ${cleanupTargetLabel}?`))
                      return;
                    cleanupApplyM.mutate();
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "sandboxes" && canUsers ? (
        <AdminSandboxesPanel canDelete={canDeleteSandboxes} search={listSearch} />
      ) : null}

      {activeTab === "reports" && canUsers ? <AdminReportsPanel search={listSearch} /> : null}
    </div>
  );

  function UserRow(props: { u: User; roles: Role[] }) {
    const roleIds = props.u.roles.map((x) => x.role.id);
    const [selRoles, setSelRoles] = useState<string[]>(roleIds);
    const [isActive, setIsActive] = useState(props.u.isActive);
    const [dbAccess, setDbAccess] = useState(Boolean(props.u.dbAccessEnabled));
    const [displayName, setDisplayName] = useState(props.u.displayName ?? "");
    const [tempPassword, setTempPassword] = useState("");
    const [editOpen, setEditOpen] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);

    const saveUserM = useMutation({
      mutationFn: () =>
        apiPatch<User>(`/api/admin/users/${props.u.id}`, {
          displayName: displayName.trim() || null,
          roleIds: selRoles,
          isActive
        }),
      onSuccess: async () => {
        setEditOpen(false);
        await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      }
    });

    const toggleActiveM = useMutation({
      mutationFn: (next: boolean) =>
        apiPatch<User>(`/api/admin/users/${props.u.id}`, { roleIds: selRoles, isActive: next }),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      }
    });

    const toggleDbAccessM = useMutation({
      mutationFn: (next: boolean) =>
        apiPatch<User>(`/api/admin/users/${props.u.id}`, { dbAccessEnabled: next }),
      onSuccess: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["admin", "users"] }),
          qc.invalidateQueries({ queryKey: ["auth", "me"] })
        ]);
      }
    });

    const resetM = useMutation({
      mutationFn: () =>
        apiPost<{ ok: true }>(`/api/admin/users/${props.u.id}/reset-password`, { newPassword: tempPassword }),
      onSuccess: async () => {
        setTempPassword("");
        setResetOpen(false);
        await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      }
    });
    const revokeM = useMutation({
      mutationFn: () => apiPost<{ ok: true }>(`/api/admin/users/${props.u.id}/revoke-sessions`, {}),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      }
    });
    const accessCodes = codesFromRoleIds(selRoles, props.roles);

    return (
      <Fragment>
        <tr className={!isActive ? "adminUserRowOff" : undefined}>
          <td>
            <div className="adminUserCell">
              <div className="adminUserAvatar" aria-hidden="true">
                {userInitials(props.u)}
              </div>
              <div className="adminUserMeta">
                <div className="adminUserName">{props.u.displayName ?? props.u.email}</div>
                <div className="muted adminUserEmail">{props.u.email}</div>
                <div className="muted adminUserSeen">в системе: {formatPresenceWhen(props.u.lastSeenAt)}</div>
                {props.u.mustChangePassword ? <div className="adminUserWarn">нужна смена пароля</div> : null}
                {props.u.dbAccessEnabled ? <div className="adminUserDbBadge">доступ к БД</div> : null}
              </div>
            </div>
          </td>
          <td>
            <div className="adminRoleBadges">
              {props.u.roles.length === 0 ? (
                <span className="muted">Без роли</span>
              ) : (
                props.u.roles.map(({ role }) => (
                  <span key={role.id} className="adminRoleBadge">{role.name}</span>
                ))
              )}
            </div>
          </td>
          <td>
            <SwitchToggle
              compact
              checked={isActive}
              disabled={toggleActiveM.isPending}
              label={isActive ? "Да" : "Нет"}
              onChange={(next) => {
                setIsActive(next);
                toggleActiveM.mutate(next, {
                  onError: () => setIsActive(!next)
                });
              }}
            />
          </td>
          <td className="adminTdActions">
            <div className="adminIconActions">
              <button
                type="button"
                className="adminIconBtn"
                title="Тепловая карта присутствия"
                aria-label="Тепловая карта присутствия"
                onClick={() => {
                  setPresenceUserId(props.u.id);
                  setTab("presence");
                }}
              >
                <IconHeat />
              </button>
              <button
                type="button"
                className={`adminIconBtn${editOpen ? " adminIconBtnActive" : ""}`}
                title="Редактировать пользователя"
                aria-label="Редактировать пользователя"
                aria-expanded={editOpen}
                onClick={() => {
                  setEditOpen((v) => !v);
                  setResetOpen(false);
                }}
              >
                <IconEdit />
              </button>
              <button
                type="button"
                className={`adminIconBtn${resetOpen ? " adminIconBtnActive" : ""}`}
                title="Выдать временный пароль"
                aria-label="Выдать временный пароль"
                aria-expanded={resetOpen}
                onClick={() => {
                  setResetOpen((v) => !v);
                  setEditOpen(false);
                }}
              >
                <IconKey />
              </button>
              <button
                type="button"
                className="adminIconBtn adminIconBtnDanger"
                title={isActive ? "Отключить пользователя" : "Пользователь уже отключён"}
                aria-label="Отключить пользователя"
                disabled={!isActive || toggleActiveM.isPending}
                onClick={() => {
                  if (!confirm(`Отключить учётную запись ${props.u.email}? Журнал и данные пользователя сохранятся.`)) return;
                  setIsActive(false);
                  toggleActiveM.mutate(false, { onError: () => setIsActive(true) });
                }}
              >
                <IconTrash />
              </button>
            </div>
          </td>
        </tr>
        {editOpen || resetOpen ? (
          <tr className="adminUserDetailRow">
            <td colSpan={4}>
              {editOpen ? (
                <div className="adminUserEditorWrap">
                <div className="adminUserEditor">
                  <label className="adminField">
                    <span className="muted">Имя</span>
                    <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  </label>
                  <div className="adminField adminUserEditorRoles">
                    <span className="muted">Роли</span>
                    <MultiSelectDropdown
                      options={props.roles.map((r) => ({ id: r.id, label: `${r.code} • ${r.name}` }))}
                      value={selRoles}
                      onChange={setSelRoles}
                      width={320}
                      maxHeight={220}
                    />
                  </div>
                  <div className="adminField adminUserDbField">
                    <SwitchToggle
                      compact
                      checked={dbAccess}
                      disabled={toggleDbAccessM.isPending}
                      label="Доступ к БД"
                      hint="DBeaver / SQL IDE, только чтение. Параметры появятся в профиле пользователя."
                      onChange={(next) => {
                        setDbAccess(next);
                        toggleDbAccessM.mutate(next, { onError: () => setDbAccess(!next) });
                      }}
                    />
                  </div>
                  <button className="btn btnPrimary btnSmall" onClick={() => saveUserM.mutate()} disabled={saveUserM.isPending}>
                    <IconSave /> Сохранить
                  </button>
                  <button
                    type="button"
                    className="btn btnSmall"
                    disabled={revokeM.isPending}
                    onClick={() => {
                      if (!confirm(`Сбросить все сессии ${props.u.email}? Пользователю нужно будет войти снова.`)) return;
                      revokeM.mutate();
                    }}
                  >
                    Сбросить сессии
                  </button>
                  <button className="btn btnSmall" onClick={() => setEditOpen(false)}>Отмена</button>
                </div>
                <div className="adminUserAccess">
                  <div>{summarizeRolePermissions(accessCodes)}</div>
                  <div className="muted">Меню: {previewNavLabels(accessCodes)}</div>
                </div>
                </div>
              ) : null}
              {resetOpen ? (
                <div className="adminUserEditor">
                  <label className="adminField">
                    <span className="muted">Новый временный пароль</span>
                    <input
                      type="password"
                      className="adminInlineInput"
                      placeholder="Минимум 8 символов"
                      value={tempPassword}
                      onChange={(e) => setTempPassword(e.target.value)}
                      autoFocus
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btnSmall btnPrimary"
                    disabled={tempPassword.length < 8 || resetM.isPending}
                    onClick={() => resetM.mutate()}
                  >
                    Выдать пароль
                  </button>
                  <button className="btn btnSmall" onClick={() => setResetOpen(false)}>Отмена</button>
                </div>
              ) : null}
              {saveUserM.error ? <div className="error">{String(saveUserM.error.message || saveUserM.error)}</div> : null}
              {toggleActiveM.error ? <div className="error">{String(toggleActiveM.error.message || toggleActiveM.error)}</div> : null}
              {toggleDbAccessM.error ? <div className="error">{String(toggleDbAccessM.error.message || toggleDbAccessM.error)}</div> : null}
              {resetM.error ? <div className="error">{String(resetM.error.message || resetM.error)}</div> : null}
              {revokeM.error ? <div className="error">{String(revokeM.error.message || revokeM.error)}</div> : null}
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }

  function RoleCard(props: { role: Role; permissions: Permission[]; users: User[] }) {
    const current = props.role.permissions.map((x) => x.permission.id);
    const [sel, setSel] = useState<string[]>(current);
    const [open, setOpen] = useState(false);
    const savedCodes = props.role.permissions.map((x) => x.permission.code);
    const draftCodes = props.permissions.length ? permissionCodesFromIds(sel, props.permissions) : savedCodes;
    const summary = summarizeRolePermissions(draftCodes);
    const dirty = [...sel].sort().join(",") !== [...current].sort().join(",");
    const members = props.users.filter((u) => u.roles.some((r) => r.role.id === props.role.id));
    const saveM = useMutation({
      mutationFn: () => apiPatch<Role>(`/api/admin/roles/${props.role.id}`, { permissionIds: sel }),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ["admin", "roles"] });
        await qc.invalidateQueries({ queryKey: ["admin", "permissions"] });
      }
    });
    const cloneM = useMutation({
      mutationFn: () =>
        apiPost<Role>("/api/admin/roles", {
          code: nextCloneRoleCode(props.role.code, (rolesQ.data ?? []).map((r) => r.code)),
          name: `Копия: ${props.role.name}`.slice(0, 200),
          permissionIds: sel
        }),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ["admin", "roles"] });
        await qc.invalidateQueries({ queryKey: ["admin", "permissions"] });
      }
    });

    return (
      <div className={open ? "adminRoleCard adminRoleCardOpen" : "adminRoleCard"}>
        <div className="adminSectionHead adminRoleCardBar">
          <button type="button" className="adminRoleCardHead" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className={open ? "adminPermChevron adminPermChevronOpen" : "adminPermChevron"} aria-hidden="true">
              ›
            </span>
            <span className="adminRoleCardTitle">
              <strong>{props.role.name}</strong>
              <span className="muted">
                {props.role.code}
                {props.role.isSystem ? " · system" : ""}
                {dirty ? " · не сохранено" : ""}
              </span>
              <span className="adminRoleCardSummary">{summary}</span>
              <span className="muted adminRoleCardMembers">
                {members.length === 0
                  ? "Никто не назначен"
                  : `Назначено: ${members.map((u) => u.displayName ?? u.email).join(", ")}`}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="btn btnSmall"
            disabled={cloneM.isPending}
            onClick={() => cloneM.mutate()}
          >
            Клонировать
          </button>
          {open || dirty ? (
            <button className="btn btnSmall" onClick={() => saveM.mutate()} disabled={saveM.isPending || !dirty}>
              Сохранить
            </button>
          ) : null}
        </div>
        {open ? (
          <div className="adminRoleCardBody">
            <PermissionMatrix catalog={props.permissions} value={sel} onChange={setSel} />
            <aside className="adminRoleMenuPreview">
              <span className="muted">Как в меню</span>
              <strong>{previewNavLabels(draftCodes)}</strong>
            </aside>
          </div>
        ) : null}
        {saveM.error ? <div className="error">{String(saveM.error.message || saveM.error)}</div> : null}
        {cloneM.error ? <div className="error">{String(cloneM.error.message || cloneM.error)}</div> : null}
      </div>
    );
  }
}
