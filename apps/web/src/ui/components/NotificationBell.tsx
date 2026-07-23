import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet, apiPost } from "../../lib/api";

export type OpenEventFromNotification = {
  eventId: string;
  sandboxId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
};

export const OPEN_EVENT_FROM_NOTIFICATION = "hangarPlanning:openEventFromNotification";

export function requestOpenEventFromNotification(detail: OpenEventFromNotification) {
  try {
    sessionStorage.setItem("hangarPlanning:openEventId", detail.eventId);
    if (detail.startAt) sessionStorage.setItem("hangarPlanning:openEventStartAt", detail.startAt);
    if (detail.endAt) sessionStorage.setItem("hangarPlanning:openEventEndAt", detail.endAt);
    if (detail.sandboxId != null) {
      sessionStorage.setItem("hangarPlanning:openEventSandboxId", detail.sandboxId || "");
    }
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT_FROM_NOTIFICATION, { detail }));
  } catch {
    // ignore
  }
}

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  eventId?: string | null;
  sandboxId?: string | null;
  createdAt: string;
  readAt?: string | null;
  event?: {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    status: string;
    sandboxId?: string | null;
    aircraftTail?: string | null;
  } | null;
};

type NotificationsResponse = {
  ok: true;
  unreadCount: number;
  items: NotificationItem[];
};

const KIND_LABEL: Record<string, string> = {
  EVENT_OVERDUE_NO_FACT: "Просрочка"
};

export function NotificationBell(props: {
  enabled: boolean;
  onOpenEvent?: (detail: OpenEventFromNotification) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<NotificationsResponse>("/api/notifications?limit=40"),
    enabled: props.enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true
  });

  const readOneM = useMutation({
    mutationFn: (id: string) => apiPost(`/api/notifications/${id}/read`, {}),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  });

  const readAllM = useMutation({
    mutationFn: () => apiPost("/api/notifications/read-all", {}),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      qc.setQueryData<NotificationsResponse>(["notifications"], (prev) =>
        prev ? { ...prev, items: [], unreadCount: 0 } : prev
      );
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = q.data?.unreadCount ?? 0;
  const items = q.data?.items ?? [];
  const badge = useMemo(() => (unread > 99 ? "99+" : unread > 0 ? String(unread) : null), [unread]);

  if (!props.enabled) return null;

  return (
    <div className={`navNotify${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`navIcon navNotifyBtn${unread > 0 ? " hasUnread" : ""}`}
        aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"}
        title="Уведомления"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="navIconGlyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
        </span>
        {badge ? <span className="navNotifyBadge">{badge}</span> : null}
        <span className="navTooltip">Уведомления</span>
      </button>

      {open ? (
        <div className="navNotifyPanel" role="dialog" aria-label="Уведомления">
          <div className="navNotifyHead">
            <strong>Уведомления</strong>
            <button
              type="button"
              className="btn btnGhost"
              disabled={unread === 0 || readAllM.isPending}
              onClick={() => readAllM.mutate()}
            >
              Прочитать все
            </button>
          </div>
          <div className="navNotifyList">
            {q.isLoading ? <div className="muted navNotifyEmpty">Загрузка…</div> : null}
            {!q.isLoading && items.length === 0 ? (
              <div className="muted navNotifyEmpty">Нет новых уведомлений</div>
            ) : null}
            {items.map((n) => {
              const canOpen = Boolean(n.eventId);
              return (
                <button
                  key={n.id}
                  type="button"
                  className="navNotifyItem unread"
                  title={canOpen ? "Открыть карточку события" : "Отметить прочитанным"}
                  onClick={() => {
                    // Сразу убираем из списка (оптимистично), затем помечаем прочитанным на сервере
                    qc.setQueryData<NotificationsResponse>(["notifications"], (prev) => {
                      if (!prev) return prev;
                      const nextItems = prev.items.filter((x) => x.id !== n.id);
                      return { ...prev, items: nextItems, unreadCount: nextItems.length };
                    });
                    readOneM.mutate(n.id);
                    if (!n.eventId) return;
                    const detail: OpenEventFromNotification = {
                      eventId: n.eventId,
                      sandboxId: n.sandboxId ?? n.event?.sandboxId ?? null,
                      startAt: n.event?.startAt ?? null,
                      endAt: n.event?.endAt ?? null
                    };
                    requestOpenEventFromNotification(detail);
                    props.onOpenEvent?.(detail);
                    setOpen(false);
                  }}
                >
                  <div className="navNotifyItemMeta">
                    <span className="navNotifyKind">{KIND_LABEL[n.kind] ?? n.kind}</span>
                    <span className="muted">{dayjs(n.createdAt).format("DD.MM HH:mm")}</span>
                  </div>
                  <div className="navNotifyTitle">{n.title}</div>
                  {n.body ? <div className="navNotifyBody">{n.body}</div> : null}
                  {canOpen ? <div className="navNotifyHint">Открыть карточку →</div> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
