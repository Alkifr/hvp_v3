import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiDelete, apiGet, setActiveSandboxId } from "../../lib/api";
import { applyEventDeepLink } from "../../lib/eventDeepLink";

type MailingRow = {
  id: string;
  name: string;
  scheduleMode: string;
  scheduleLabel: string;
  isActive: boolean;
};

type EventRow = {
  eventId: string;
  title: string;
  aircraftTail: string | null;
  startAt: string;
  endAt: string;
  sandboxId: string | null;
  sandboxName: string | null;
};

type SubscriptionsResponse = {
  mailings: MailingRow[];
  events: EventRow[];
};

function formatPeriod(startAt: string, endAt: string) {
  const start = dayjs(startAt);
  const end = dayjs(endAt);
  if (!start.isValid() || !end.isValid()) return "";
  return `${start.format("DD.MM.YYYY")} – ${end.format("DD.MM.YYYY")}`;
}

export function ProfileSubscriptions(props: { canOpenEvents: boolean; onOpenGantt: () => void }) {
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => apiGet<SubscriptionsResponse>("/api/subscriptions")
  });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["subscriptions"] }),
      qc.invalidateQueries({ queryKey: ["mail-digest"] })
    ]);
  };

  const dropMailingM = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/subscriptions/mailings/${id}`),
    onSuccess: refresh
  });
  const dropEventM = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/subscriptions/events/${id}`),
    onSuccess: refresh
  });
  const dropMailingsM = useMutation({
    mutationFn: () => apiDelete("/api/subscriptions/mailings"),
    onSuccess: refresh
  });
  const dropEventsM = useMutation({
    mutationFn: () => apiDelete("/api/subscriptions/events"),
    onSuccess: refresh
  });
  const dropAllM = useMutation({
    mutationFn: () => apiDelete("/api/subscriptions"),
    onSuccess: refresh
  });

  const mailings = listQ.data?.mailings ?? [];
  const events = listQ.data?.events ?? [];
  const busy =
    dropMailingM.isPending ||
    dropEventM.isPending ||
    dropMailingsM.isPending ||
    dropEventsM.isPending ||
    dropAllM.isPending;
  const error =
    dropMailingM.error || dropEventM.error || dropMailingsM.error || dropEventsM.error || dropAllM.error;

  const openEvent = (row: EventRow) => {
    const targetSandbox = row.sandboxId ?? null;
    setActiveSandboxId(targetSandbox);
    applyEventDeepLink({
      eventId: row.eventId,
      sandboxId: targetSandbox,
      startAt: row.startAt,
      endAt: row.endAt
    });
    const q = new URLSearchParams();
    q.set("event", row.eventId);
    if (targetSandbox) q.set("sandbox", targetSandbox);
    // hashchange → App.consumeEventDeepLinkFromHash открывает карточку.
    window.location.hash = `gantt?${q.toString()}`;
    props.onOpenGantt();
  };

  return (
    <div className="profileStack">
      <section className="card profileCard profileDashboardCard">
        <header className="profileSectionHeader">
          <div>
            <h2>Рассылки</h2>
            <p>Варианты, где ваш email указан в получателях</p>
          </div>
          {mailings.length > 1 ? (
            <button type="button" className="btn btnGhost" disabled={busy} onClick={() => dropMailingsM.mutate()}>
              Отписаться от всех
            </button>
          ) : null}
        </header>
        <div className="profileCardBody">
          {listQ.isLoading ? <div className="muted">Загрузка…</div> : null}
          {listQ.error ? <div className="error">{String((listQ.error as Error).message || listQ.error)}</div> : null}
          {!listQ.isLoading && !listQ.error && mailings.length === 0 ? (
            <div className="muted">Вы не состоите в рассылках.</div>
          ) : null}
          {mailings.length ? (
            <ul className="profileSandboxList profileSubList">
              {mailings.map((row) => (
                <li key={row.id}>
                  <span className="profileSubTitle">
                    <span className="profileSandboxName" title={row.name}>
                      {row.name}
                    </span>
                    <span className="profileSubMeta">
                      {row.scheduleLabel}
                      {row.isActive ? "" : " · на паузе"}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btnGhost"
                    disabled={busy}
                    onClick={() => dropMailingM.mutate(row.id)}
                  >
                    Отписаться
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="card profileCard profileDashboardCard">
        <header className="profileSectionHeader">
          <div>
            <h2>Изменения событий</h2>
            <p>Письмо на почту при каждом изменении, кроме ваших собственных правок</p>
          </div>
          {events.length > 1 ? (
            <button type="button" className="btn btnGhost" disabled={busy} onClick={() => dropEventsM.mutate()}>
              Отписаться от всех
            </button>
          ) : null}
        </header>
        <div className="profileCardBody">
          {!listQ.isLoading && !listQ.error && events.length === 0 ? (
            <div className="muted">Нет подписок. Колокольчик на событии включает письмо об изменениях.</div>
          ) : null}
          {events.length ? (
            <ul className="profileSandboxList profileSubList">
              {events.map((row) => {
                const caption = [row.aircraftTail, row.title].filter(Boolean).join(" · ");
                const where = row.sandboxId ? row.sandboxName || "Песочница" : "Рабочий контур";
                return (
                  <li key={row.eventId}>
                    <span className="profileSubTitle">
                      <span className="profileSandboxName" title={caption}>
                        {caption || "Событие"}
                      </span>
                      <span className="profileSubMeta">
                        {where}
                        {formatPeriod(row.startAt, row.endAt) ? ` · ${formatPeriod(row.startAt, row.endAt)}` : ""}
                      </span>
                    </span>
                    <span className="profileSubActions">
                      {props.canOpenEvents ? (
                        <button type="button" className="btn btnGhost" onClick={() => openEvent(row)}>
                          Открыть
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btnGhost"
                        disabled={busy}
                        onClick={() => dropEventM.mutate(row.eventId)}
                      >
                        Отписаться
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </section>

      {mailings.length + events.length > 0 ? (
        <div className="profileSubAll">
          <button type="button" className="btn" disabled={busy} onClick={() => dropAllM.mutate()}>
            Отписаться от всего
          </button>
          {error ? <span className="error">{String((error as Error).message || error)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
