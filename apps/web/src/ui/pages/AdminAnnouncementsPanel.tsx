import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/api";
import { isValidDateTimeLocal } from "../../lib/dateInput";
import { fromInputMskOptional, MSK_OFFSET_MINUTES } from "../../lib/localDate";
import { SwitchToggle } from "../components/SwitchToggle";
import {
  announcementKindClass,
  formatAnnouncementPeriod,
  type AppAnnouncement
} from "../components/AnnouncementModal";

const KIND_OPTIONS = [
  { id: "UPDATE", label: "Обновление" },
  { id: "CHANGE", label: "Изменение" },
  { id: "MAINTENANCE", label: "Ограничение / техработы" },
  { id: "OUTAGE", label: "Приостановка" }
] as const;

type ListResponse = { ok: true; items: AppAnnouncement[] };

function toInputMsk(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = dayjs(iso).utcOffset(MSK_OFFSET_MINUTES);
  return d.isValid() ? d.format("YYYY-MM-DDTHH:mm") : "";
}

function parsePeriod(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!isValidDateTimeLocal(v)) return null;
  return fromInputMskOptional(v);
}

function statusLabel(status: AppAnnouncement["status"]): string {
  if (status === "expired") return "истекло";
  if (status === "inactive") return "скрыто";
  return "показывается";
}

const emptyForm = {
  kind: "UPDATE" as (typeof KIND_OPTIONS)[number]["id"],
  title: "",
  body: "",
  startsAt: "",
  endsAt: "",
  isActive: true
};

export function AdminAnnouncementsPanel() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "announcements"],
    queryFn: () => apiGet<ListResponse>("/api/admin/announcements")
  });

  const items = listQ.data?.items ?? [];

  const periodError = useMemo(() => {
    const from = form.startsAt.trim() ? parsePeriod(form.startsAt) : null;
    const to = form.endsAt.trim() ? parsePeriod(form.endsAt) : null;
    if (form.startsAt.trim() && !from) return "Укажите корректную дату начала";
    if (form.endsAt.trim() && !to) return "Укажите корректную дату окончания";
    if (from && to && new Date(to) <= new Date(from)) return "Окончание периода должно быть позже начала";
    return null;
  }, [form.startsAt, form.endsAt]);

  const payload = () => ({
    kind: form.kind,
    title: form.title.trim(),
    body: form.body.trim(),
    startsAt: form.startsAt.trim() ? parsePeriod(form.startsAt) : null,
    endsAt: form.endsAt.trim() ? parsePeriod(form.endsAt) : null,
    isActive: form.isActive
  });

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const saveM = useMutation({
    mutationFn: () => {
      const body = payload();
      return editingId
        ? apiPatch<AppAnnouncement>(`/api/admin/announcements/${editingId}`, body)
        : apiPost<AppAnnouncement>("/api/admin/announcements", body);
    },
    onSuccess: async () => {
      resetForm();
      await qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
      await qc.invalidateQueries({ queryKey: ["announcements", "active"] });
    }
  });

  const toggleM = useMutation({
    mutationFn: (row: AppAnnouncement) =>
      apiPatch<AppAnnouncement>(`/api/admin/announcements/${row.id}`, { isActive: !row.isActive }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
      await qc.invalidateQueries({ queryKey: ["announcements", "active"] });
    }
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/announcements/${id}`),
    onSuccess: async (_res, id) => {
      if (editingId === id) resetForm();
      await qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
      await qc.invalidateQueries({ queryKey: ["announcements", "active"] });
    }
  });

  const canSave = Boolean(form.title.trim() && form.body.trim() && !periodError);

  return (
    <section className="card adminPanel">
      <div className="adminSectionHead">
        <div>
          <strong>{editingId ? "Редактировать объявление" : "Новое объявление"}</strong>
          <div className="muted adminHint">
            Все пользователи увидят всплывающее окно по центру экрана. Закрытие скрывает объявление только у этого
            человека. Если изменить текст или период — окно покажется снова. После даты окончания объявление скрывается
            само.
          </div>
        </div>
      </div>

      <div className="adminFormRow adminFormRowWrap">
        <label className="adminField">
          <span className="muted">Тип</span>
          <select
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as typeof form.kind }))}
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="adminField adminFieldGrow">
          <span className="muted">Заголовок</span>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Кратко, что происходит"
            maxLength={200}
          />
        </label>
      </div>

      <label className="adminField" style={{ marginTop: 10 }}>
        <span className="muted">Текст</span>
        <textarea
          className="announceAdminTextarea"
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          placeholder="Подробности: что изменилось, какие ограничения и что делать пользователям"
          maxLength={4000}
          rows={5}
        />
      </label>

      <div className="adminFormRow adminFormRowWrap" style={{ marginTop: 10 }}>
        <label className="adminField">
          <span className="muted">Период с (МСК)</span>
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
          />
        </label>
        <label className="adminField">
          <span className="muted">по (МСК)</span>
          <input
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
          />
        </label>
        <label className="adminField">
          <span className="muted">Показывать</span>
          <div style={{ paddingTop: 6 }}>
            <SwitchToggle
              compact
              checked={form.isActive}
              onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              label={form.isActive ? "Да" : "Нет"}
            />
          </div>
        </label>
      </div>
      {periodError ? <div className="error" style={{ marginTop: 8 }}>{periodError}</div> : null}

      <div className="adminFormRow" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btnPrimary"
          disabled={!canSave || saveM.isPending}
          onClick={() => saveM.mutate()}
        >
          {editingId ? "Сохранить" : "Опубликовать"}
        </button>
        {editingId ? (
          <button type="button" className="btn" onClick={resetForm}>
            Отмена
          </button>
        ) : null}
      </div>
      {saveM.error ? <div className="error">{String((saveM.error as Error).message || saveM.error)}</div> : null}

      <div className="adminSectionHead" style={{ marginTop: 22 }}>
        <strong>Опубликованные</strong>
        <span className="muted">{items.length ? `${items.length}` : "пока нет"}</span>
      </div>

      {listQ.isLoading ? <div className="muted">Загрузка…</div> : null}
      {listQ.error ? <div className="error">{String((listQ.error as Error).message || listQ.error)}</div> : null}

      {!listQ.isLoading && items.length === 0 ? (
        <div className="muted">Объявлений ещё нет — опубликуйте первое, и его увидят все, кто откроет приложение.</div>
      ) : null}

      {items.length > 0 ? (
        <div className="adminTableWrap">
          <table className="adminTable">
            <thead>
              <tr>
                <th>Объявление</th>
                <th>Период</th>
                <th>Статус</th>
                <th>Закрыли</th>
                <th className="adminThActions">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const period = formatAnnouncementPeriod(row.startsAt, row.endsAt);
                const author = row.createdBy?.displayName || row.createdBy?.email;
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="announceAdminTitleCell">
                        <span className={`announceKindBadge ${announcementKindClass(row.kind)}`}>{row.kindLabel}</span>
                        <div>
                          <div className="announceAdminRowTitle">{row.title}</div>
                          <div className="muted adminHint">
                            {dayjs(row.createdAt).format("DD.MM.YYYY HH:mm")}
                            {author ? ` · ${author}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{period ?? <span className="muted">без срока</span>}</td>
                    <td>
                      <span className={`gpChip${row.status === "active" ? " gpChipInfo" : row.status === "expired" ? "" : ""}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td>{row.dismissalCount ?? 0}</td>
                    <td className="adminTdActions">
                      <div className="adminIconActions">
                        <button
                          type="button"
                          className="btn btnGhost"
                          onClick={() => {
                            setEditingId(row.id);
                            setForm({
                              kind: (KIND_OPTIONS.find((k) => k.id === row.kind)?.id ?? "UPDATE") as typeof form.kind,
                              title: row.title,
                              body: row.body,
                              startsAt: toInputMsk(row.startsAt),
                              endsAt: toInputMsk(row.endsAt),
                              isActive: row.isActive
                            });
                          }}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn btnGhost"
                          disabled={toggleM.isPending}
                          onClick={() => toggleM.mutate(row)}
                        >
                          {row.isActive ? "Скрыть" : "Показать"}
                        </button>
                        <button
                          type="button"
                          className="btn btnGhost"
                          disabled={deleteM.isPending}
                          onClick={() => {
                            if (window.confirm("Удалить объявление? Окно больше не появится ни у кого.")) {
                              deleteM.mutate(row.id);
                            }
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {toggleM.error ? <div className="error">{String((toggleM.error as Error).message || toggleM.error)}</div> : null}
      {deleteM.error ? <div className="error">{String((deleteM.error as Error).message || deleteM.error)}</div> : null}
    </section>
  );
}
