import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authChangePassword, authLogout, MeResponse } from "../auth/authApi";

export function ProfileView(props: { me: Extract<MeResponse, { ok: true }>["user"] }) {
  const qc = useQueryClient();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

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

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div className="row">
        <strong>Профиль</strong>
        <span style={{ flex: "1 1 auto" }} />
        <button className="btn" onClick={() => logoutM.mutate()} disabled={logoutM.isPending}>
          Выйти
        </button>
      </div>

      <div>
        <div>
          <strong>{props.me.displayName ?? props.me.email}</strong>
        </div>
        <div className="muted">{props.me.email}</div>
        <div className="muted" style={{ marginTop: 6 }}>
          Роли: {props.me.roles.join(", ") || "—"}
        </div>
      </div>

      <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 12, display: "grid", gap: 10 }}>
        <strong>Смена пароля</strong>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted">Текущий пароль</span>
          <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted">Новый пароль (min 8)</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <button className="btn btnPrimary" onClick={() => changeM.mutate()} disabled={changeM.isPending}>
          Сохранить пароль
        </button>
        {changeM.data && !changeM.data.ok ? <div className="error">Ошибка: {changeM.data.error}</div> : null}
        {props.me.mustChangePassword ? (
          <div className="muted">Требуется смена пароля (mustChangePassword=true).</div>
        ) : null}
      </div>
    </div>
  );
}

