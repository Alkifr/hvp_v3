import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiDelete, apiGet, apiPatch } from "../../lib/api";

type AdminSandbox = {
  id: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
  owner: { id: string; email: string; displayName: string | null; isActive: boolean };
  ownerActive: boolean;
  updatedAt: string;
  sharedWithAllRole: "EDITOR" | "VIEWER" | null;
  eventCount: number;
  memberCount: number;
};

export function AdminSandboxesPanel(props: { canDelete: boolean; search: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"all" | "ACTIVE" | "ARCHIVED">("all");
  const listQ = useQuery({
    queryKey: ["admin", "sandboxes", status],
    queryFn: () => apiGet<{ ok: true; items: AdminSandbox[] }>(`/api/admin/sandboxes?status=${status}`)
  });

  const patchM = useMutation({
    mutationFn: (vars: { id: string; status?: "ACTIVE" | "ARCHIVED"; sharedWithAllRole?: "EDITOR" | "VIEWER" | null }) =>
      apiPatch<AdminSandbox>(`/api/admin/sandboxes/${vars.id}`, {
        ...(vars.status ? { status: vars.status } : {}),
        ...(vars.sharedWithAllRole !== undefined ? { sharedWithAllRole: vars.sharedWithAllRole } : {})
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "sandboxes"] });
      await qc.invalidateQueries({ queryKey: ["sandboxes"] });
    }
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: true }>(`/api/admin/sandboxes/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "sandboxes"] });
      await qc.invalidateQueries({ queryKey: ["sandboxes"] });
    }
  });

  const q = props.search.trim().toLowerCase();
  const items = useMemo(() => {
    const list = listQ.data?.items ?? [];
    if (!q) return list;
    return list.filter((s) =>
      `${s.name} ${s.owner.email} ${s.owner.displayName ?? ""}`.toLowerCase().includes(q)
    );
  }, [listQ.data, q]);

  return (
    <section className="card adminPanel">
      <div className="adminListToolbar">
        <div className="adminListTitle">
          <strong>Песочницы</strong>
          <span className="muted adminHint">{items.length}</span>
        </div>
        <div className="adminFilters">
          <label>
            <span>Статус</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="all">Все</option>
              <option value="ACTIVE">Активные</option>
              <option value="ARCHIVED">Архив</option>
            </select>
          </label>
        </div>
      </div>
      {listQ.error ? <div className="error">{String(listQ.error.message || listQ.error)}</div> : null}
      {patchM.error ? <div className="error">{String(patchM.error.message || patchM.error)}</div> : null}
      {deleteM.error ? <div className="error">{String(deleteM.error.message || deleteM.error)}</div> : null}
      <div className="adminTableWrap">
        <table className="table adminTable">
          <thead>
            <tr>
              <th>Песочница</th>
              <th>Владелец</th>
              <th>Для всех</th>
              <th>События</th>
              <th className="adminThActions">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="muted adminEmpty">{q ? "Ничего не найдено." : "Песочниц нет."}</div>
                </td>
              </tr>
            ) : (
              items.map((s) => (
                <tr key={s.id} className={s.status === "ARCHIVED" ? "adminUserRowOff" : undefined}>
                  <td>
                    <div>{s.name}</div>
                    <div className="muted adminHint">{s.status === "ARCHIVED" ? "Архив" : "Активна"} · {s.memberCount} уч.</div>
                  </td>
                  <td>
                    {s.owner.displayName ?? s.owner.email}
                    {!s.ownerActive ? <div className="adminUserWarn">владелец отключён</div> : null}
                  </td>
                  <td>{s.sharedWithAllRole ? (s.sharedWithAllRole === "EDITOR" ? "Редактор" : "Наблюдатель") : "—"}</td>
                  <td>{s.eventCount}</td>
                  <td className="adminTdActions">
                    <div className="adminIconActions adminRiskActions">
                      {s.sharedWithAllRole ? (
                        <button
                          type="button"
                          className="btn btnSmall"
                          disabled={patchM.isPending}
                          onClick={() => patchM.mutate({ id: s.id, sharedWithAllRole: null })}
                        >
                          Снять «для всех»
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btnSmall"
                        disabled={patchM.isPending}
                        onClick={() => {
                          if (s.status === "ACTIVE") {
                            if (!confirm(`Отправить песочницу «${s.name}» в архив?`)) return;
                            patchM.mutate({ id: s.id, status: "ARCHIVED" });
                          } else {
                            patchM.mutate({ id: s.id, status: "ACTIVE" });
                          }
                        }}
                      >
                        {s.status === "ACTIVE" ? "В архив" : "Вернуть"}
                      </button>
                      {props.canDelete ? (
                        <button
                          type="button"
                          className="btn btnSmall"
                          disabled={deleteM.isPending}
                          onClick={() => {
                            if (!confirm(`Удалить песочницу «${s.name}»? Все её события и связанные данные будут удалены.`)) return;
                            if (!confirm(`Подтвердите удаление «${s.name}». Это необратимо.`)) return;
                            deleteM.mutate(s.id);
                          }}
                        >
                          Удалить
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
