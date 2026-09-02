import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  authChangePassword,
  authLogout,
  authUpdateProfile,
  MeResponse
} from "../auth/authApi";
import { grantedGroupCount, hasPermission } from "../../lib/permissionCatalog";
import {
  allowedHomePageOptions,
  NOTIFICATION_KIND_OPTIONS,
  parseMutedNotificationKinds
} from "../../lib/userPrefs";
import { ActivityFeed } from "../components/ActivityFeed";
import { PermissionMatrix } from "../components/PermissionMatrix";
import { PresenceFeed } from "../components/PresenceFeed";
import { SingleSelectDropdown } from "../components/SingleSelectDropdown";
import { SwitchToggle } from "../components/SwitchToggle";
import { formatPresenceWhen } from "../components/UserPresencePanel";
import { sandboxIsArchived, useActiveSandbox } from "../components/SandboxSwitcher";
import { useIsMobile } from "../hooks/useIsMobile";

type AuthedUser = Extract<MeResponse, { ok: true }>["user"];
type ProfileTab = "profile" | "access" | "prefs" | "security" | "activity";
type ActivityPane = "edits" | "presence";
type NavPage = "admin" | "sandboxes";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Администратор",
  PLANNER: "Планировщик",
  VIEWER: "Наблюдатель",
  PILOT: "Пилот",
  SUPER_ADMIN: "Супер-админ"
};

const SANDBOX_ROLE: Record<string, string> = {
  OWNER: "владелец",
  EDITOR: "редактор",
  VIEWER: "просмотр"
};

function initialsFromUser(u: AuthedUser): string {
  const base = (u.displayName ?? u.email).trim();
  if (!base) return "?";
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

function RoleBadges(props: { roles: string[] }) {
  if (props.roles.length === 0) {
    return <span className="profileRoleBadge profileRoleBadgeMuted">нет ролей</span>;
  }
  return (
    <>
      {props.roles.map((r) => (
        <span key={r} className={`profileRoleBadge profileRoleBadge_${r}`}>
          {ROLE_LABEL[r] ?? r}
        </span>
      ))}
    </>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function CopyField(props: { label: string; value: string; hint?: string; secret?: boolean; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  const copyable = props.copyable !== false && props.value.length > 0;
  return (
    <div className="profileDbRow">
      <div className="profileDbLabel">{props.label}</div>
      <div className="profileDbValue">
        <code className={`profileDbCode${props.secret && !show ? " profileDbCodeSecret" : ""}`}>
          {props.secret && !show ? "••••••••••••" : props.value || "—"}
        </code>
        {props.hint ? <div className="profileFieldHint">{props.hint}</div> : null}
      </div>
      <div className="profileDbActions">
        {props.secret ? (
          <button type="button" className="profileDbCopyBtn" onClick={() => setShow((v) => !v)}>
            {show ? "скрыть" : "показать"}
          </button>
        ) : null}
        {copyable ? (
          <button
            type="button"
            className="profileDbCopyBtn"
            onClick={async () => {
              const ok = await copyText(props.value);
              if (!ok) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? "скопировано" : "копировать"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ProfileView(props: { me: AuthedUser; onNavigate: (page: NavPage) => void }) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { list: sandboxes, loading: sandboxesLoading } = useActiveSandbox();
  const [tab, setTab] = useState<ProfileTab>(props.me.mustChangePassword ? "security" : "profile");
  const [activityPane, setActivityPane] = useState<ActivityPane>("edits");
  const [displayName, setDisplayName] = useState(props.me.displayName ?? "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const moduleCount = useMemo(() => grantedGroupCount(props.me.permissions), [props.me.permissions]);
  const currentName = (props.me.displayName ?? "").trim();
  const nextName = displayName.trim();
  const nameDirty = nextName.length > 0 && nextName !== currentName;
  const muted = parseMutedNotificationKinds(props.me.mutedNotificationKinds);
  const isAdmin = props.me.roles.includes("ADMIN") || props.me.roles.includes("SUPER_ADMIN");
  const canAdminUsers = hasPermission(props.me.permissions, "admin:users");
  const canNotify =
    hasPermission(props.me.permissions, "events:read") ||
    hasPermission(props.me.permissions, "gantt:read") ||
    hasPermission(props.me.permissions, "hangar:read");
  const homeOptions = useMemo(
    () => allowedHomePageOptions(props.me.permissions, isMobile).map((o) => ({ id: o.id, label: o.label })),
    [props.me.permissions, isMobile]
  );
  const mySandboxes = useMemo(
    () =>
      sandboxes.filter(
        (s) => !sandboxIsArchived(s) && (s.isOwner || s.members.some((m) => m.userId === props.me.id))
      ),
    [sandboxes, props.me.id]
  );

  useEffect(() => {
    setDisplayName(props.me.displayName ?? "");
  }, [props.me.displayName]);

  const logoutM = useMutation({
    mutationFn: () => authLogout(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });

  const patchM = useMutation({
    mutationFn: (body: { displayName?: string; homePage?: string | null; mutedNotificationKinds?: string[] }) =>
      authUpdateProfile(body),
    onSuccess: async (r) => {
      if (r.ok) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["auth", "me"] }),
          qc.invalidateQueries({ queryKey: ["notifications"] })
        ]);
      }
    }
  });

  const changeM = useMutation({
    mutationFn: () => authChangePassword(oldPassword, newPassword),
    onSuccess: async (r) => {
      if (r.ok) {
        setOldPassword("");
        setNewPassword("");
        await qc.invalidateQueries({ queryKey: ["auth", "me"] });
      }
    }
  });

  const pwStrength = useMemo(() => {
    const pw = newPassword;
    if (!pw) return { score: 0, label: "" };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const label = ["очень слабый", "слабый", "средний", "хороший", "надёжный", "отличный"][score] ?? "";
    return { score, label };
  }, [newPassword]);

  const initials = initialsFromUser(props.me);
  const titleName = props.me.displayName?.trim() || props.me.email;

  const openAdminUsers = () => {
    try {
      history.replaceState(null, "", `${location.pathname}${location.search}#admin/users`);
    } catch {
      location.hash = "admin/users";
    }
    props.onNavigate("admin");
  };

  const setMutedKind = (kind: string, enabled: boolean) => {
    const next = new Set(muted);
    if (enabled) next.delete(kind);
    else next.add(kind);
    patchM.mutate({ mutedNotificationKinds: [...next] });
  };

  return (
    <div className="profilePage">
      <header className="profileHeroBar">
        <div className="profileHeroIdentity">
          <div className="profileAvatar" aria-hidden="true">
            {initials}
          </div>
          <div className="profileHeroText">
            <h1 className="profileHeroName">{titleName}</h1>
            <div className="profileHeroMeta">
              <span>{props.me.email}</span>
              <span className="profileHeroDot" aria-hidden="true">
                ·
              </span>
              <span>вход {formatPresenceWhen(props.me.lastLoginAt)}</span>
              <span className="profileHeroDot" aria-hidden="true">
                ·
              </span>
              <span>в системе {formatPresenceWhen(props.me.lastSeenAt)}</span>
            </div>
            <div className="profileHeroRoles">
              <RoleBadges roles={props.me.roles} />
            </div>
          </div>
        </div>
        <button
          className="profileLogoutBtn"
          onClick={() => logoutM.mutate()}
          disabled={logoutM.isPending}
          title="Выйти из системы"
          aria-label="Выйти из системы"
        >
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M12 6l4 4-4 4m4-4H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Выйти</span>
        </button>
      </header>

      {props.me.mustChangePassword ? (
        <div className="profilePasswordBanner" role="status">
          <div>
            <strong>Требуется сменить пароль</strong>
            <p>Задайте постоянный пароль на вкладке «Безопасность».</p>
          </div>
          {tab !== "security" ? (
            <button type="button" className="btn btnPrimary" onClick={() => setTab("security")}>
              Перейти к смене
            </button>
          ) : null}
        </div>
      ) : null}

      <nav className="profileTabs" role="tablist" aria-label="Разделы профиля">
        {(
          [
            ["profile", "Профиль"],
            ["access", "Доступ"],
            ["prefs", "Предпочтения"],
            ["security", "Безопасность"],
            ["activity", "Активность"]
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`profileTab${tab === id ? " profileTabActive" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "profile" ? (
        <section className="card profileCard profileDashboardCard">
          <header className="profileSectionHeader">
            <div>
              <h2>Учётная запись</h2>
              <p>Имя можно изменить самостоятельно, email задаёт администратор</p>
            </div>
          </header>
          <div className="profileCardBody profileInfoList">
            <div className="profileKv">
              <div className="profileKvKey">Имя</div>
              <div className="profileKvVal">
                <div className="profileNameEdit">
                  <input
                    className="profileInput"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      patchM.reset();
                    }}
                    maxLength={200}
                    autoComplete="name"
                    placeholder="Как к вам обращаться"
                  />
                  <button
                    type="button"
                    className="btn btnPrimary"
                    disabled={!nameDirty || patchM.isPending}
                    onClick={() => patchM.mutate({ displayName: nextName })}
                  >
                    {patchM.isPending ? "Сохраняем…" : "Сохранить"}
                  </button>
                </div>
                {patchM.data?.ok && patchM.variables?.displayName ? (
                  <span className="profileInlineSuccess">Имя обновлено</span>
                ) : patchM.data && !patchM.data.ok && patchM.variables?.displayName ? (
                  <span className="error">{patchM.data.message || patchM.data.error}</span>
                ) : null}
              </div>
            </div>
            <div className="profileKv">
              <div className="profileKvKey">Email</div>
              <div className="profileKvVal">
                <div>{props.me.email}</div>
                <div className="profileFieldHint">Меняет администратор</div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "access" ? (
        <div className="profileStack">
          <section className="card profileCard profileDashboardCard">
            <header className="profileSectionHeader">
              <div>
                <h2>Доступ</h2>
                <p>Роли и права по модулям. Назначает администратор</p>
              </div>
              <span className="profileAccessCount" title="Модули с доступом">
                {moduleCount}
              </span>
            </header>
            <div className="profileCardBody profileAccessBody">
              <div className="profileAccessGroup">
                <div className="profileAccessLabel">Роли</div>
                <div className="profileHeroRoles">
                  <RoleBadges roles={props.me.roles} />
                </div>
              </div>
              <div className="profileAccessGroup">
                <div className="profileAccessLabel">Модули</div>
                <PermissionMatrix readOnly permissions={props.me.permissions} />
              </div>
              <div className="profileAccessNote">
                {canAdminUsers ? (
                  <button type="button" className="profileTextLink" onClick={openAdminUsers}>
                    Управление пользователями
                  </button>
                ) : (
                  <span className="muted">Нужны другие права — обратитесь к администратору.</span>
                )}
              </div>
            </div>
          </section>

          {props.me.dbAccess ? (
            <section className="card profileCard profileDashboardCard">
              <header className="profileSectionHeader">
                <div>
                  <h2>Подключение к базе (DBeaver)</h2>
                  <p>Только чтение. Пароль приложения для входа в интерфейс — другой.</p>
                </div>
              </header>
              <div className="profileCardBody profileDbBody">
                <CopyField
                  label="Хост"
                  value=""
                  hint="Хост нужно уточнить у администратора"
                  copyable={false}
                />
                <CopyField label="Порт" value={String(props.me.dbAccess.port)} />
                <CopyField label="База" value={props.me.dbAccess.database} />
                <CopyField label="Пользователь" value={props.me.dbAccess.user} />
                <CopyField label="Пароль" value={props.me.dbAccess.password} secret />
              </div>
            </section>
          ) : null}

          <section className="card profileCard profileDashboardCard">
            <header className="profileSectionHeader">
              <div>
                <h2>Песочницы</h2>
                <p>Сценарии, где вы владелец или участник</p>
              </div>
              <button type="button" className="profileTextLink" onClick={() => props.onNavigate("sandboxes")}>
                Открыть список
              </button>
            </header>
            <div className="profileCardBody">
              {sandboxesLoading ? (
                <div className="muted">Загрузка…</div>
              ) : mySandboxes.length === 0 ? (
                <div className="muted">Вы не состоите в песочницах.</div>
              ) : (
                <ul className="profileSandboxList">
                  {mySandboxes.map((s) => (
                    <li key={s.id}>
                      <span className="profileSandboxName">{s.name}</span>
                      <span className="muted">{SANDBOX_ROLE[s.myRole ?? ""] ?? s.myRole}</span>
                      <span className="muted">{s.eventCount} соб.</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "prefs" ? (
        <div className="profileStack">
          <section className="card profileCard profileDashboardCard">
            <header className="profileSectionHeader">
              <div>
                <h2>Стартовая страница</h2>
                <p>Откроется при входе, если в адресе нет явного раздела</p>
              </div>
            </header>
            <div className="profileCardBody">
              <SingleSelectDropdown
                options={homeOptions}
                value={props.me.homePage ?? ""}
                allowEmpty
                emptyLabel="Автоматически (первый доступный)"
                onChange={(next) => patchM.mutate({ homePage: next || null })}
                width="100%"
              />
              {patchM.data && !patchM.data.ok && patchM.variables?.homePage !== undefined ? (
                <span className="error">{patchM.data.message || patchM.data.error}</span>
              ) : null}
            </div>
          </section>

          <section className="card profileCard profileDashboardCard">
            <header className="profileSectionHeader">
              <div>
                <h2>Колокольчик</h2>
                <p>Какие уведомления рабочего контура показывать</p>
              </div>
            </header>
            <div className="profileCardBody profilePrefToggles">
              {!canNotify ? (
                <div className="muted">Колокольчик недоступен при текущих правах.</div>
              ) : (
                NOTIFICATION_KIND_OPTIONS.filter((opt) => !opt.adminOnly || isAdmin).map((opt) => (
                  <SwitchToggle
                    key={opt.kind}
                    compact
                    checked={!muted.includes(opt.kind)}
                    disabled={patchM.isPending}
                    onChange={(on) => setMutedKind(opt.kind, on)}
                    label={opt.label}
                    hint={opt.hint}
                  />
                ))
              )}
              {patchM.data && !patchM.data.ok && patchM.variables?.mutedNotificationKinds ? (
                <span className="error">{patchM.data.message || patchM.data.error}</span>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "security" ? (
        <section className="card profileCard profileDashboardCard profileSecurityCard">
          <header className="profileSectionHeader">
            <div>
              <h2>Смена пароля</h2>
              <p>Используйте уникальный пароль длиной не менее 8 символов</p>
            </div>
            <span className="profileSecurityIcon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect x="4" y="8" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
          </header>
          <div className="profileSecurityLayout">
            <div className="profileCardBody profileSecurityForm">
              <label className="profileField">
                <span className="profileFieldLabel">Текущий пароль</span>
                <input
                  className="profileInput"
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Введите текущий пароль"
                />
              </label>
              <label className="profileField">
                <span className="profileFieldLabel">Новый пароль</span>
                <div className="profilePwRow">
                  <input
                    className="profileInput"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    placeholder="Минимум 8 символов"
                  />
                  <button
                    type="button"
                    className="profilePwToggle"
                    onClick={() => setShowNew((v) => !v)}
                    title={showNew ? "Скрыть пароль" : "Показать пароль"}
                  >
                    {showNew ? "скрыть" : "показать"}
                  </button>
                </div>
                {newPassword ? (
                  <div className={`profilePwMeter profilePwMeter_${Math.min(5, pwStrength.score)}`}>
                    <div className="profilePwMeterBar" />
                    <span className="profilePwMeterLabel">{pwStrength.label}</span>
                  </div>
                ) : null}
              </label>
              <div className="profileActions">
                <button
                  className="btn btnPrimary"
                  onClick={() => changeM.mutate()}
                  disabled={changeM.isPending || oldPassword.length === 0 || newPassword.length < 8}
                >
                  {changeM.isPending ? "Сохраняем…" : "Обновить пароль"}
                </button>
                {changeM.data?.ok ? (
                  <span className="profileInlineSuccess">Пароль обновлён</span>
                ) : changeM.data && !changeM.data.ok ? (
                  <span className="error">
                    Ошибка: {changeM.data.message || (changeM.data.error === "OLD_PASSWORD_INVALID" ? "неверный текущий пароль" : changeM.data.error)}
                  </span>
                ) : null}
              </div>
            </div>
            <aside className="profileSecurityNote">
              <strong>Сессия</strong>
              <ul>
                <li>Последний вход: {formatPresenceWhen(props.me.lastLoginAt)}</li>
                <li>В системе: {formatPresenceWhen(props.me.lastSeenAt)}</li>
              </ul>
              <strong>Рекомендации</strong>
              <ul>
                <li>Не используйте пароль от других сервисов</li>
                <li>Добавьте цифры и специальные символы</li>
                <li>Не передавайте пароль другим сотрудникам</li>
              </ul>
            </aside>
          </div>
        </section>
      ) : null}

      {tab === "activity" ? (
        <div className="profileStack">
          <div className="profileSubTabs" role="tablist" aria-label="Тип журнала">
            <button
              type="button"
              role="tab"
              aria-selected={activityPane === "edits"}
              className={`profileSubTab${activityPane === "edits" ? " profileSubTabActive" : ""}`}
              onClick={() => setActivityPane("edits")}
            >
              Правки плана
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activityPane === "presence"}
              className={`profileSubTab${activityPane === "presence" ? " profileSubTabActive" : ""}`}
              onClick={() => setActivityPane("presence")}
            >
              Входы
            </button>
          </div>
          {activityPane === "edits" ? <ActivityFeed mode="self" compact /> : <PresenceFeed />}
        </div>
      ) : null}
    </div>
  );
}
