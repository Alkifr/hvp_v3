import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authLogin } from "../auth/authApi";

export function LoginView() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("admin@local.dev");
  const [password, setPassword] = useState("admin");

  const loginM = useMutation({
    mutationFn: () => authLogin(email, password),
    onSuccess: async (r) => {
      if (r.ok) await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "70vh" }}>
      <div className="card" style={{ width: 440, maxWidth: "92vw", display: "grid", gap: 12 }}>
        <div>
          <strong>Вход</strong>
          <div className="muted" style={{ marginTop: 6 }}>
            Введите email и пароль.
          </div>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted">Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted">Пароль</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        <button className="btn btnPrimary" onClick={() => loginM.mutate()} disabled={loginM.isPending}>
          Войти
        </button>

        {loginM.data && !loginM.data.ok ? <div className="error">Ошибка: {loginM.data.error}</div> : null}
      </div>
    </div>
  );
}

