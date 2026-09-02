import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authChangePassword, authLogin, authLogout } from "../auth/authApi";
import { APPLY_HOME_KEY } from "../../lib/userPrefs";

function HangarMark() {
  return (
    <span className="authLogo" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11c3-4 6-6 9-6s6 2 9 6" />
        <path d="M3 11v9h18v-9" />
        <path d="M8 20v-5h8v5" />
      </svg>
    </span>
  );
}

export function LoginView(props: { forcedEmail?: string } = {}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState(props.forcedEmail ?? "");
  const [password, setPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(Boolean(props.forcedEmail));
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  const loginM = useMutation({
    mutationFn: () => authLogin(email, password),
    onSuccess: async (r) => {
      if (!r.ok) return;
      if (r.mustChangePassword) {
        setMustChangePassword(true);
        return;
      }
      try {
        sessionStorage.setItem(APPLY_HOME_KEY, "1");
      } catch {
        /* ignore */
      }
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });

  const changePasswordM = useMutation({
    mutationFn: () => authChangePassword(password, newPassword),
    onSuccess: async (r) => {
      if (!r.ok) return;
      setPassword(newPassword);
      setNewPassword("");
      setNewPassword2("");
      setMustChangePassword(false);
      try {
        sessionStorage.setItem(APPLY_HOME_KEY, "1");
      } catch {
        /* ignore */
      }
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });

  const canChangePassword = newPassword.length >= 8 && newPassword === newPassword2;
  const loginError =
    loginM.data && !loginM.data.ok
      ? loginM.data.message
      : loginM.isError
        ? String((loginM.error as Error)?.message ?? "Не удалось войти")
        : null;
  const changeError =
    changePasswordM.data && !changePasswordM.data.ok
      ? changePasswordM.data.message
      : changePasswordM.isError
        ? String((changePasswordM.error as Error)?.message ?? "Не удалось сменить пароль")
        : null;

  return (
    <div className="authShell">
      <div className="authCard">
        <header className="authHero">
          <HangarMark />
          <div className="authHeroText">
            <div className="massEyebrow">Hangar Visit Plan</div>
            <h1>{mustChangePassword ? "Смените пароль" : "Вход"}</h1>
          </div>
        </header>

        {!mustChangePassword ? (
          <form
            className="authBody"
            onSubmit={(e) => {
              e.preventDefault();
              if (email && password && !loginM.isPending) loginM.mutate();
            }}
          >
            <label className="authField">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </label>
            <label className="authField">
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>

            <button
              type="submit"
              className="btn btnPrimary authSubmit"
              disabled={loginM.isPending || !email || !password}
            >
              {loginM.isPending ? "Входим…" : "Войти"}
            </button>

            {loginError ? <div className="error">{loginError}</div> : null}
            <p className="authHint">Нет учётной записи или забыли пароль — обратитесь к администратору.</p>
          </form>
        ) : (
          <form
            className="authBody"
            onSubmit={(e) => {
              e.preventDefault();
              if (canChangePassword && password && !changePasswordM.isPending) changePasswordM.mutate();
            }}
          >
            <p className="authLead">
              Вы вошли как <b>{email || props.forcedEmail}</b>. Задайте постоянный пароль — не короче 8 символов.
            </p>
            <label className="authField">
              <span>Текущий пароль</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="authField">
              <span>Новый пароль</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="authField">
              <span>Повторите новый пароль</span>
              <input
                type="password"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            {newPassword2 && newPassword !== newPassword2 ? <div className="error">Пароли не совпадают</div> : null}
            <button
              type="submit"
              className="btn btnPrimary authSubmit"
              disabled={!canChangePassword || changePasswordM.isPending || !password}
            >
              {changePasswordM.isPending ? "Сохраняем…" : "Сменить пароль и войти"}
            </button>
            {props.forcedEmail ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void authLogout().then(() => {
                    void qc.invalidateQueries({ queryKey: ["auth", "me"] });
                  });
                }}
                disabled={changePasswordM.isPending}
              >
                Выйти
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => setMustChangePassword(false)}
                disabled={changePasswordM.isPending}
              >
                Вернуться ко входу
              </button>
            )}
            {changeError ? <div className="error">{changeError}</div> : null}
          </form>
        )}
      </div>
    </div>
  );
}
