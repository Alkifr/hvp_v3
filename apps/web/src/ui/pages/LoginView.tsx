import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authChangePassword, authLogin } from "../auth/authApi";

export function LoginView() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("admin@local.dev");
  const [password, setPassword] = useState("admin");
  const [mustChangePassword, setMustChangePassword] = useState(false);
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
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });

  const canChangePassword = newPassword.length >= 8 && newPassword === newPassword2;
  const loginError = loginM.data && !loginM.data.ok ? loginM.data.message : null;
  const changeError = changePasswordM.data && !changePasswordM.data.ok ? changePasswordM.data.message : null;

  return (
    <div className="authShell">
      <div className="authCard">
        <div className="authBrand">
          <div className="authLogo">HP</div>
          <div>
            <div className="authEyebrow">Hangar Planning</div>
            <h1>{mustChangePassword ? "Смените временный пароль" : "Вход в систему"}</h1>
            <p>
              {mustChangePassword
                ? "Администратор выдал временный пароль. Задайте постоянный пароль перед продолжением."
                : "Доступ выдаётся администратором. Самостоятельная регистрация отключена."}
            </p>
          </div>
        </div>

        {!mustChangePassword ? (
          <>
            <label className="authField">
              <span>Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </label>
            <label className="authField">
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email && password && !loginM.isPending) loginM.mutate();
                }}
              />
            </label>

            <button className="btn btnPrimary authSubmit" onClick={() => loginM.mutate()} disabled={loginM.isPending || !email || !password}>
              {loginM.isPending ? "Входим…" : "Войти"}
            </button>

            <div className="authHint">
              Нет учётной записи или забыли пароль? Обратитесь к администратору: он создаст пользователя или выдаст временный пароль.
            </div>
            {loginError ? <div className="error">{loginError}</div> : null}
          </>
        ) : (
          <>
            <div className="authNotice">
              Вы вошли как <b>{email}</b>. Новый пароль должен быть не короче 8 символов.
            </div>
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canChangePassword && !changePasswordM.isPending) changePasswordM.mutate();
                }}
              />
            </label>
            {newPassword2 && newPassword !== newPassword2 ? <div className="error">Пароли не совпадают</div> : null}
            <button className="btn btnPrimary authSubmit" onClick={() => changePasswordM.mutate()} disabled={!canChangePassword || changePasswordM.isPending}>
              {changePasswordM.isPending ? "Сохраняем…" : "Сменить пароль и войти"}
            </button>
            <button className="btn" onClick={() => setMustChangePassword(false)} disabled={changePasswordM.isPending}>
              Вернуться ко входу
            </button>
            {changeError ? <div className="error">{changeError}</div> : null}
          </>
        )}

        <div className="authDemo">
          <div><b>Демо-доступы после seed:</b></div>
          <div>Админ: admin@local.dev / admin</div>
          <div>Планировщик: planner@local.dev / planner123</div>
          <div>Просмотрщик: viewer@local.dev / viewer123</div>
        </div>
      </div>
    </div>
  );
}

