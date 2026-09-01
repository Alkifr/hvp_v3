import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { apiGet, apiPatch } from "../../lib/api";

type AdminReport = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  owner: { id: string; email: string; displayName: string | null; isActive: boolean };
  ownerActive: boolean;
  sharedWithAllRole: "EDITOR" | "VIEWER" | null;
  shareCount: number;
  orphan: boolean;
};

export function AdminReportsPanel(props: { search: string }) {
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["admin", "reports"],
    queryFn: () => apiGet<{ ok: true; items: AdminReport[] }>("/api/admin/reports")
  });
  const unshareM = useMutation({
    mutationFn: (id: string) => apiPatch<{ ok: true }>(`/api/admin/reports/${id}`, { sharedWithAllRole: null }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "reports"] });
    }
  });

  const q = props.search.trim().toLowerCase();
  const items = useMemo(() => {
    const list = listQ.data?.items ?? [];
    if (!q) return list;
    return list.filter((r) =>
      `${r.name} ${r.owner.email} ${r.owner.displayName ?? ""}`.toLowerCase().includes(q)
    );
  }, [listQ.data, q]);

  return (
    <section className="card adminPanel">
      <div className="adminListToolbar">
        <div className="adminListTitle">
          <strong>Отчёты «для всех» и сироты</strong>
          <span className="muted adminHint">{items.length}</span>
        </div>
      </div>
      <p className="muted adminHint">
        Здесь только отчёты, расшаренные на всех, и отчёты отключённых владельцев. Конструктор отчётов остаётся в аналитике.
      </p>
      {listQ.error ? <div className="error">{String(listQ.error.message || listQ.error)}</div> : null}
      {unshareM.error ? <div className="error">{String(unshareM.error.message || unshareM.error)}</div> : null}
      <div className="adminTableWrap">
        <table className="table adminTable">
          <thead>
            <tr>
              <th>Отчёт</th>
              <th>Владелец</th>
              <th>Для всех</th>
              <th className="adminThActions">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className="muted adminEmpty">{q ? "Ничего не найдено." : "Нет расшаренных отчётов."}</div>
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div>{r.name}</div>
                    {r.orphan ? <div className="adminUserWarn">сирота</div> : null}
                  </td>
                  <td>{r.owner.displayName ?? r.owner.email}</td>
                  <td>{r.sharedWithAllRole ? (r.sharedWithAllRole === "EDITOR" ? "Редактор" : "Наблюдатель") : "—"}</td>
                  <td className="adminTdActions">
                    {r.sharedWithAllRole ? (
                      <button
                        type="button"
                        className="btn btnSmall"
                        disabled={unshareM.isPending}
                        onClick={() => unshareM.mutate(r.id)}
                      >
                        Снять «для всех»
                      </button>
                    ) : (
                      <span className="muted">нет общего доступа</span>
                    )}
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
