import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet, apiPatch } from "../../lib/api";
import { formatActionLabel } from "../../lib/eventHistoryFormat";
import { adminActivity, type MyActivityItem } from "../auth/authApi";
import type { AppAnnouncement } from "../components/AnnouncementModal";

type MailDigestSettings = {
  smtpHost: string | null;
  hasPassword: boolean;
  mailFrom: string | null;
};

type OverviewTab = "users" | "roles" | "mail" | "announce" | "activity";

export function AdminOverview(props: {
  canUsers: boolean;
  canRoles: boolean;
  canMail: boolean;
  canRuntime: boolean;
  usersCount: number;
  activeUsersCount: number;
  tempPasswordCount: number;
  rolesCount: number;
  writeBlocked: boolean;
  onGo: (tab: OverviewTab) => void;
}) {
  const qc = useQueryClient();
  const mailQ = useQuery({
    queryKey: ["admin", "mail-digest", "settings"],
    queryFn: () => apiGet<MailDigestSettings>("/api/admin/mail-digest/settings"),
    enabled: props.canMail
  });
  const announceQ = useQuery({
    queryKey: ["admin", "announcements"],
    queryFn: () => apiGet<{ ok: true; items: AppAnnouncement[] }>("/api/admin/announcements"),
    enabled: props.canUsers
  });
  const activityQ = useQuery({
    queryKey: ["admin", "activity", "overview"],
    queryFn: () => adminActivity({ limit: 8, offset: 0 }),
    enabled: props.canUsers
  });

  const runtimeM = useMutation({
    mutationFn: (writeBlocked: boolean) => apiPatch<{ ok: true; writeBlocked: boolean }>("/api/admin/runtime", { writeBlocked }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
      await qc.invalidateQueries({ queryKey: ["admin", "runtime"] });
    }
  });

  const smtpReady = Boolean(mailQ.data?.smtpHost && mailQ.data.hasPassword);
  const activeNotice = (announceQ.data?.items ?? []).find((item) => item.status === "active");

  return (
    <div className="adminOverview">
      {props.canRuntime ? (
        <section className={`card adminPanel adminOverviewRuntime${props.writeBlocked ? " adminOverviewRuntimeOn" : ""}`}>
          <div className="adminSectionHead">
            <div>
              <strong>Режим контура</strong>
              <div className="muted adminHint">
                {props.writeBlocked
                  ? "Запись в план, ангар и справочники закрыта. Админка остаётся доступна."
                  : "Рабочий контур принимает изменения."}
              </div>
            </div>
            <button
              type="button"
              className={`btn btnSmall${props.writeBlocked ? "" : " btnPrimary"}`}
              disabled={runtimeM.isPending}
              onClick={() => runtimeM.mutate(!props.writeBlocked)}
            >
              {props.writeBlocked ? "Снять техрежим" : "Включить только просмотр"}
            </button>
          </div>
          {runtimeM.error ? <div className="error">{String(runtimeM.error.message || runtimeM.error)}</div> : null}
        </section>
      ) : null}

      <div className="adminOverviewGrid">
        {props.canUsers ? (
          <button type="button" className="adminOverviewCard" onClick={() => props.onGo("users")}>
            <span className="muted">Люди</span>
            <strong>
              {props.activeUsersCount}
              <small> / {props.usersCount}</small>
            </strong>
            <span>активных пользователей</span>
            {props.tempPasswordCount > 0 ? (
              <span className="adminOverviewWarn">{props.tempPasswordCount} на временном пароле</span>
            ) : (
              <span className="muted">временных паролей нет</span>
            )}
          </button>
        ) : null}
        {props.canRoles ? (
          <button type="button" className="adminOverviewCard" onClick={() => props.onGo("roles")}>
            <span className="muted">Доступ</span>
            <strong>{props.rolesCount}</strong>
            <span>ролей</span>
          </button>
        ) : null}
        {props.canMail ? (
          <button type="button" className="adminOverviewCard" onClick={() => props.onGo("mail")}>
            <span className="muted">SMTP</span>
            <strong>{smtpReady ? "Задан" : mailQ.data?.smtpHost ? "Без пароля" : "Не задан"}</strong>
            <span>{mailQ.data?.mailFrom || mailQ.data?.smtpHost || "Настройки почты"}</span>
          </button>
        ) : null}
        {props.canUsers ? (
          <button type="button" className="adminOverviewCard" onClick={() => props.onGo("announce")}>
            <span className="muted">Объявление</span>
            <strong>{activeNotice ? activeNotice.kindLabel : "Нет"}</strong>
            <span>{activeNotice ? activeNotice.title : "Активного объявления нет"}</span>
          </button>
        ) : null}
      </div>

      {props.canUsers ? (
        <section className="card adminPanel">
          <div className="adminSectionHead">
            <strong>Последние действия</strong>
            <button type="button" className="btn btnSmall" onClick={() => props.onGo("activity")}>
              Журнал
            </button>
          </div>
          {activityQ.error ? <div className="error">{String(activityQ.error.message || activityQ.error)}</div> : null}
          <ul className="adminOverviewActivity">
            {(activityQ.data?.items ?? []).length === 0 ? (
              <li className="muted">Пока нет записей.</li>
            ) : (
              (activityQ.data?.items ?? []).map((item: MyActivityItem) => (
                <li key={item.id}>
                  <span className="adminOverviewActivityWhen">{dayjs(item.createdAt).format("DD.MM HH:mm")}</span>
                  <span>
                    {item.actor ? `${item.actor}: ` : ""}
                    {formatActionLabel(item.action, item.changes)}
                    {item.event?.title ? ` · ${item.event.title}` : ""}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
