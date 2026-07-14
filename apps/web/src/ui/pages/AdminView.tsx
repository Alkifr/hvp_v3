import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "../../lib/api";
import { isValidDateInput } from "../../lib/dateInput";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import type { SandboxSummary } from "../components/SandboxSwitcher";

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

export function AdminView(props: { permissions: string[] }) {
  const qc = useQueryClient();
  const canUsers = props.permissions.includes("admin:users");
  const canRoles = props.permissions.includes("admin:roles");
  const canCleanup = props.permissions.includes("admin:cleanup");

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
  const cleanupEventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<EventTypeRef[]>("/api/ref/event-types"),
    enabled: canCleanup
  });
  const cleanupAircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftTypeRef[]>("/api/ref/aircraft-types"),
    enabled: canCleanup
  });
  const cleanupAircraftQ = useQuery({
    queryKey: ["ref", "aircraft"],
    queryFn: () => apiGet<AircraftRef[]>("/api/ref/aircraft"),
    enabled: canCleanup
  });
  const cleanupSandboxesQ = useQuery({
    queryKey: ["sandboxes"],
    queryFn: () => apiGet<SandboxSummary[]>("/api/sandboxes"),
    enabled: canCleanup
  });

  // create user
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
  const cleanupHasFilters = Boolean(cleanupEventId.trim() || cleanupEventTypeId || cleanupAircraftTypeId || cleanupAircraftId || cleanupFrom || cleanupTo || cleanupConfirmBulk);
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
    }
  });

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
  const roleByCode = useMemo(() => new Map(roles.map((r) => [r.code, r])), [roles]);
  const pickInviteRole = (code: "PLANNER" | "VIEWER") => {
    const role = roleByCode.get(code);
    if (role) setURoleIds([role.id]);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card">
        <div className="row">
          <strong>Админка</strong>
          <span className="muted">Управление пользователями и ролями/правами.</span>
        </div>
        {!canUsers && !canRoles && !canCleanup ? <div className="error" style={{ marginTop: 10 }}>Нет прав администратора.</div> : null}
      </div>

      {canCleanup ? (
        <div className="card adminDangerZone">
          <div className="row">
            <div>
              <strong>Очистка событий</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                События не удаляются физически, а переводятся в статус «Удалено». Можно выбрать рабочий контур или конкретную песочницу.
              </div>
            </div>
            <span className="gpChip gpChipError">только SUPER_ADMIN</span>
          </div>

          <div className="row" style={{ alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Область</span>
              <select
                value={cleanupTarget}
                onChange={(e) => {
                  const next = e.target.value === "sandbox" ? "sandbox" : "prod";
                  setCleanupTarget(next);
                  if (next === "prod") setCleanupSandboxId("");
                  setCleanupPreview(null);
                }}
                style={{ width: 190 }}
              >
                <option value="prod">Рабочий контур</option>
                <option value="sandbox">Песочница</option>
              </select>
            </label>
            {cleanupTarget === "sandbox" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Песочница</span>
                <select
                  value={cleanupSandboxId}
                  onChange={(e) => {
                    setCleanupSandboxId(e.target.value);
                    setCleanupPreview(null);
                  }}
                  style={{ width: 240 }}
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
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">ID события</span>
              <input value={cleanupEventId} onChange={(e) => { setCleanupEventId(e.target.value); setCleanupPreview(null); }} placeholder="опционально" style={{ width: 240 }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Тип события</span>
              <select value={cleanupEventTypeId} onChange={(e) => { setCleanupEventTypeId(e.target.value); setCleanupPreview(null); }} style={{ width: 220 }}>
                <option value="">— любой —</option>
                {(cleanupEventTypesQ.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Тип ВС</span>
              <select value={cleanupAircraftTypeId} onChange={(e) => { setCleanupAircraftTypeId(e.target.value); setCleanupPreview(null); }} style={{ width: 240 }}>
                <option value="">— любой —</option>
                {(cleanupAircraftTypesQ.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.icaoType ? `${t.icaoType} • ${t.name}` : t.name}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Борт</span>
              <select value={cleanupAircraftId} onChange={(e) => { setCleanupAircraftId(e.target.value); setCleanupPreview(null); }} style={{ width: 200 }}>
                <option value="">— любой —</option>
                {(cleanupAircraftQ.data ?? [])
                  .filter((a) => !cleanupAircraftTypeId || a.type?.id === cleanupAircraftTypeId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.tailNumber}</option>
                  ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">с</span>
              <input type="date" value={cleanupFrom} onChange={(e) => { setCleanupFrom(e.target.value); setCleanupPreview(null); }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">по</span>
              <input type="date" value={cleanupTo} onChange={(e) => { setCleanupTo(e.target.value); setCleanupPreview(null); }} />
            </label>
            <button className="btn" disabled={!cleanupTargetReady || !cleanupHasFilters || cleanupPreviewM.isPending} onClick={() => cleanupPreviewM.mutate()}>
              Предпросмотр
            </button>
          </div>

          {!cleanupEventId.trim() && !cleanupFrom && !cleanupTo ? (
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={cleanupConfirmBulk} onChange={(e) => { setCleanupConfirmBulk(e.target.checked); setCleanupPreview(null); }} />
              <span className="muted">Разрешить массовую очистку без периода</span>
            </label>
          ) : null}

          {cleanupPreviewM.error ? <div className="error">{String(cleanupPreviewM.error.message || cleanupPreviewM.error)}</div> : null}
          {cleanupApplyM.error ? <div className="error">{String(cleanupApplyM.error.message || cleanupApplyM.error)}</div> : null}
          {cleanupApplyM.data ? <div className="muted">Переведено в статус «Удалено»: {cleanupApplyM.data.updated}</div> : null}

          {cleanupPreview ? (
            <div className="adminCleanupPreview">
              <div className="row">
                <strong>Найдено событий: {cleanupPreview.total}</strong>
                <span className="muted">Показаны первые {cleanupPreview.items.length}</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Событие</th>
                    <th>Борт</th>
                    <th>Тип события</th>
                    <th>Период</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {cleanupPreview.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>{item.id}</div>
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
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Причина</span>
                  <input value={cleanupReason} onChange={(e) => setCleanupReason(e.target.value)} placeholder={`Очистка ${cleanupTargetLabel}`} style={{ width: 320 }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="muted">Пароль текущего пользователя</span>
                  <input type="password" value={cleanupPassword} onChange={(e) => setCleanupPassword(e.target.value)} style={{ width: 260 }} />
                </label>
                <button
                  className="btn btnDanger"
                  disabled={cleanupPreview.total === 0 || !cleanupPassword || cleanupApplyM.isPending}
                  onClick={() => {
                    if (!confirm(`Перевести в статус «Удалено» ${cleanupPreview.total} событий ${cleanupTargetLabel}?`)) return;
                    cleanupApplyM.mutate();
                  }}
                >
                  Перевести в «Удалено»
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {canUsers ? (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="row">
            <strong>Пользователи</strong>
            {usersQ.isFetching ? <span className="muted">обновление…</span> : null}
          </div>
          {usersQ.error ? <div className="error">{String(usersQ.error.message || usersQ.error)}</div> : null}

          <div className="adminInviteBox">
            <div>
              <strong>Пригласить пользователя</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Создайте учётную запись с временным паролем. При первом входе пользователь обязан сменить пароль.
              </div>
            </div>
            <div className="adminQuickRoles">
              <button type="button" className="btn" onClick={() => pickInviteRole("PLANNER")}>
                Планировщик
              </button>
              <button type="button" className="btn" onClick={() => pickInviteRole("VIEWER")}>
                Просмотрщик
              </button>
            </div>
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
                <span className="muted">Временный пароль (min 8)</span>
                <input type="password" value={uPass} onChange={(e) => setUPass(e.target.value)} style={{ width: 220 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Роли</span>
                <MultiSelectDropdown options={roleOptions} value={uRoleIds} onChange={setURoleIds} width={260} maxHeight={220} />
              </label>
              <button className="btn btnPrimary" disabled={!uEmail || uPass.length < 8 || createUserM.isPending} onClick={() => createUserM.mutate()}>
                Пригласить
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
    const [tempPassword, setTempPassword] = useState("");

    const saveM = useMutation({
      mutationFn: () => apiPatch<User>(`/api/admin/users/${props.u.id}`, { roleIds: selRoles, isActive }),
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      }
    });
    const resetM = useMutation({
      mutationFn: () => apiPost<{ ok: true }>(`/api/admin/users/${props.u.id}/reset-password`, { newPassword: tempPassword }),
      onSuccess: async () => {
        setTempPassword("");
        await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      }
    });

    return (
      <tr>
        <td>{props.u.email}</td>
        <td>{props.u.displayName ?? "—"}</td>
        <td className="muted">{props.u.roles.map((x) => x.role.code).join(", ") || "—"}</td>
        <td>
          {props.u.isActive ? "активен" : "выключен"}
          {props.u.mustChangePassword ? <div className="muted" style={{ fontSize: 12 }}>нужна смена пароля</div> : null}
        </td>
        <td>
          <div className="adminUserActions">
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
            <div className="row" style={{ gap: 8 }}>
              <input
                type="password"
                placeholder="Новый временный пароль"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                style={{ width: 220 }}
              />
              <button className="btn" onClick={() => resetM.mutate()} disabled={tempPassword.length < 8 || resetM.isPending}>
                Выдать временный пароль
              </button>
            </div>
          </div>
          {saveM.error ? <div className="error">{String(saveM.error.message || saveM.error)}</div> : null}
          {resetM.error ? <div className="error">{String(resetM.error.message || resetM.error)}</div> : null}
          {resetM.isSuccess ? <div className="muted" style={{ fontSize: 12 }}>Временный пароль выдан. Пользователь сменит его при входе.</div> : null}
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

