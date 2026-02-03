import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "../../lib/api";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";

type Role = { id: string; code: string; name: string; isSystem: boolean; permissions: { permission: Permission }[] };
type Permission = { id: string; code: string; name: string };
type User = {
  id: string;
  email: string;
  displayName?: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: { role: { id: string; code: string; name: string } }[];
};

export function AdminView(props: { permissions: string[] }) {
  const qc = useQueryClient();
  const canUsers = props.permissions.includes("admin:users");
  const canRoles = props.permissions.includes("admin:roles");

  const permsQ = useQuery({
    queryKey: ["admin", "permissions"],
    queryFn: () => apiGet<Permission[]>("/api/admin/permissions"),
    enabled: canRoles
  });
  const rolesQ = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => apiGet<Role[]>("/api/admin/roles"),
    enabled: canRoles
  });
  const usersQ = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiGet<User[]>("/api/admin/users"),
    enabled: canUsers
  });

  // create user
  const [uEmail, setUEmail] = useState("");
  const [uName, setUName] = useState("");
  const [uPass, setUPass] = useState("");
  const [uRoleIds, setURoleIds] = useState<string[]>([]);

  const createUserM = useMutation({
    mutationFn: () => apiPost<User>("/api/admin/users", { email: uEmail, displayName: uName || undefined, password: uPass, roleIds: uRoleIds }),
    onSuccess: async () => {
      setUEmail("");
      setUName("");
      setUPass("");
      setURoleIds([]);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    }
  });

  // create role
  const [rCode, setRCode] = useState("");
  const [rName, setRName] = useState("");
  const [rPermIds, setRPermIds] = useState<string[]>([]);

  const createRoleM = useMutation({
    mutationFn: () => apiPost<Role>("/api/admin/roles", { code: rCode, name: rName, permissionIds: rPermIds }),
    onSuccess: async () => {
      setRCode("");
      setRName("");
      setRPermIds([]);
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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card">
        <div className="row">
          <strong>Админка</strong>
          <span className="muted">Управление пользователями и ролями/правами.</span>
        </div>
        {!canUsers && !canRoles ? <div className="error" style={{ marginTop: 10 }}>Нет прав администратора.</div> : null}
      </div>

      {canUsers ? (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="row">
            <strong>Пользователи</strong>
            {usersQ.isFetching ? <span className="muted">обновление…</span> : null}
          </div>
          {usersQ.error ? <div className="error">{String(usersQ.error.message || usersQ.error)}</div> : null}

          <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Email</span>
                <input value={uEmail} onChange={(e) => setUEmail(e.target.value)} style={{ width: 260 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Имя</span>
                <input value={uName} onChange={(e) => setUName(e.target.value)} style={{ width: 220 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Пароль (min 8)</span>
                <input type="password" value={uPass} onChange={(e) => setUPass(e.target.value)} style={{ width: 220 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Роли</span>
                <MultiSelectDropdown options={roleOptions} value={uRoleIds} onChange={setURoleIds} width={260} maxHeight={220} />
              </label>
              <button className="btn btnPrimary" disabled={!uEmail || uPass.length < 8 || createUserM.isPending} onClick={() => createUserM.mutate()}>
                Создать
              </button>
            </div>
            {createUserM.error ? <div className="error" style={{ marginTop: 8 }}>{String(createUserM.error.message || createUserM.error)}</div> : null}
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Имя</th>
                <th>Роли</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {(usersQ.data ?? []).map((u) => (
                <UserRow key={u.id} u={u} roles={roles} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {canRoles ? (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="row">
            <strong>Роли и права</strong>
            {rolesQ.isFetching || permsQ.isFetching ? <span className="muted">обновление…</span> : null}
          </div>
          {rolesQ.error ? <div className="error">{String(rolesQ.error.message || rolesQ.error)}</div> : null}
          {permsQ.error ? <div className="error">{String(permsQ.error.message || permsQ.error)}</div> : null}

          <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Код</span>
                <input value={rCode} onChange={(e) => setRCode(e.target.value)} style={{ width: 200 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Название</span>
                <input value={rName} onChange={(e) => setRName(e.target.value)} style={{ width: 260 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Права</span>
                <MultiSelectDropdown
                  options={permissions.map((p) => ({ id: p.id, label: `${p.code} • ${p.name}` }))}
                  value={rPermIds}
                  onChange={setRPermIds}
                  width={320}
                  maxHeight={260}
                />
              </label>
              <button className="btn btnPrimary" disabled={!rCode || !rName || createRoleM.isPending} onClick={() => createRoleM.mutate()}>
                Создать роль
              </button>
            </div>
            {createRoleM.error ? <div className="error" style={{ marginTop: 8 }}>{String(createRoleM.error.message || createRoleM.error)}</div> : null}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {(rolesQ.data ?? []).map((r) => (
              <RoleCard key={r.id} role={r} permissions={permissions} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  function UserRow(props: { u: User; roles: Role[] }) {
    const roleIds = props.u.roles.map((x) => x.role.id);
    const [selRoles, setSelRoles] = useState<string[]>(roleIds);
    const [isActive, setIsActive] = useState(props.u.isActive);

    const saveM = useMutation({
      mutationFn: () => apiPatch<User>(`/api/admin/users/${props.u.id}`, { roleIds: selRoles, isActive }),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      }
    });

    return (
      <tr>
        <td>{props.u.email}</td>
        <td>{props.u.displayName ?? "—"}</td>
        <td className="muted">{props.u.roles.map((x) => x.role.code).join(", ") || "—"}</td>
        <td>{props.u.isActive ? "активен" : "выключен"}</td>
        <td>
          <div className="row" style={{ gap: 8 }}>
            <label className="row" style={{ gap: 6 }}>
              <span className="muted">активен</span>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            </label>
            <MultiSelectDropdown
              options={props.roles.map((r) => ({ id: r.id, label: `${r.code} • ${r.name}` }))}
              value={selRoles}
              onChange={setSelRoles}
              width={240}
              maxHeight={240}
            />
            <button className="btn" onClick={() => saveM.mutate()} disabled={saveM.isPending}>
              Сохранить
            </button>
          </div>
          {saveM.error ? <div className="error">{String(saveM.error.message || saveM.error)}</div> : null}
        </td>
      </tr>
    );
  }

  function RoleCard(props: { role: Role; permissions: Permission[] }) {
    const current = props.role.permissions.map((x) => x.permission.id);
    const [sel, setSel] = useState<string[]>(current);
    const saveM = useMutation({
      mutationFn: () => apiPatch<Role>(`/api/admin/roles/${props.role.id}`, { permissionIds: sel }),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ["admin", "roles"] });
        await qc.invalidateQueries({ queryKey: ["admin", "permissions"] });
      }
    });

    return (
      <div style={{ border: "1px solid rgba(148,163,184,0.35)", borderRadius: 12, padding: 12 }}>
        <div className="row">
          <strong>{props.role.code}</strong>
          <span className="muted">{props.role.name}</span>
          {props.role.isSystem ? <span className="muted">(system)</span> : null}
          <span style={{ flex: "1 1 auto" }} />
          <button className="btn" onClick={() => saveM.mutate()} disabled={saveM.isPending}>
            Сохранить права
          </button>
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: "flex-start" }}>
          <MultiSelectDropdown
            options={props.permissions.map((p) => ({ id: p.id, label: `${p.code} • ${p.name}` }))}
            value={sel}
            onChange={setSel}
            width={420}
            maxHeight={260}
          />
          <div className="muted" style={{ fontSize: 12 }}>
            Текущие права: {props.role.permissions.map((x) => x.permission.code).join(", ") || "—"}
          </div>
        </div>
        {saveM.error ? <div className="error" style={{ marginTop: 8 }}>{String(saveM.error.message || saveM.error)}</div> : null}
      </div>
    );
  }
}

