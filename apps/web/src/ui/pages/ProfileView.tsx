import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  authChangePassword,
  authLogout,
  MeResponse
} from "../auth/authApi";
import { ActivityFeed } from "../components/ActivityFeed";

type AuthedUser = Extract<MeResponse, { ok: true }>["user"];
type ProfileTab = "account" | "security" | "activity";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Администратор",
  PLANNER: "Планировщик",
  VIEWER: "Наблюдатель",
  PILOT: "Пилот",
  SUPER_ADMIN: "Супер-админ"
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

export function ProfileView(props: { me: AuthedUser }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ProfileTab>("account");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNew, setShowNew] = useState(false);

  const logoutM = useMutation({
    mutationFn: () => authLogout(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
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

  return (
    <div className="profilePage">
      <header className="profileDashboardHeader">
        <div className="profileDashboardTitle">
          <h1>Личный кабинет</h1>
          <p>Профиль, права доступа и история действий</p>
        </div>
        <div className="profileDashboardIdentity">
          <div className="profileAvatar" aria-hidden="true">
            {initials}
          </div>
          <div className="profileHeroText">
            <div className="profileHeroName">{props.me.displayName ?? props.me.email}</div>
            <div className="profileHeroEmail">{props.me.email}</div>
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
        </div>
      </header>

      <nav className="profileTabs" role="tablist" aria-label="Разделы профиля">
        {(
          [
            ["account", "Учётная запись"],
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

      {tab === "account" ? (
        <div className="profileAccountGrid">
          <section className="card profileCard profileDashboardCard">
            <header className="profileSectionHeader">
              <div>
                <h2>Основная информация</h2>
                <p>Данные вашей учётной записи</p>
              </div>
              <span className="profileStatusBadge">Активна</span>
            </header>
            <div className="profileCardBody profileInfoList">
              <div className="profileKv">
                <div className="profileKvKey">Имя</div>
                <div className="profileKvVal">{props.me.displayName ?? "Не указано"}</div>
              </div>
              <div className="profileKv">
                <div className="profileKvKey">Email</div>
                <div className="profileKvVal">{props.me.email}</div>
              </div>
              <div className="profileKv">
                <div className="profileKvKey">Состояние пароля</div>
                <div className="profileKvVal">
                  {props.me.mustChangePassword ? (
                    <span className="profileInlineWarning">Требуется сменить пароль</span>
                  ) : (
                    <span className="profileInlineSuccess">Пароль установлен</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="card profileCard profileDashboardCard">
            <header className="profileSectionHeader">
              <div>
                <h2>Доступ</h2>
                <p>Назначенные роли и разрешения</p>
              </div>
              <span className="profileAccessCount">{props.me.permissions.length}</span>
            </header>
            <div className="profileCardBody profileAccessBody">
              <div className="profileAccessGroup">
                <div className="profileAccessLabel">Роли</div>
                <div className="profileHeroRoles">
                  {props.me.roles.length === 0 ? (
                    <span className="profileRoleBadge profileRoleBadgeMuted">нет ролей</span>
                  ) : (
                    props.me.roles.map((r) => (
                      <span key={r} className={`profileRoleBadge profileRoleBadge_${r}`}>
                        {ROLE_LABEL[r] ?? r}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="profileAccessGroup">
                <div className="profileAccessLabel">Разрешения</div>
                <div className="profileKvPerms">
                  {props.me.permissions.length === 0 ? (
                    <span className="muted">Нет назначенных разрешений</span>
                  ) : (
                    props.me.permissions.map((p) => (
                      <code key={p} className="profilePerm">
                        {p}
                      </code>
                    ))
                  )}
                </div>
              </div>
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
                    Ошибка:{" "}
                    {changeM.data.error === "OLD_PASSWORD_INVALID"
                      ? "неверный текущий пароль"
                      : changeM.data.error}
                  </span>
                ) : null}
              </div>
            </div>
            <aside className="profileSecurityNote">
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

      {tab === "activity" ? <ActivityFeed mode="self" compact /> : null}
    </div>
  );
}
