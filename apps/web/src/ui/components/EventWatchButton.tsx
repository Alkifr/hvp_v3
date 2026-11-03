import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiGet, apiPost } from "../../lib/api";

type WatchList = { eventIds: string[] };

const QUERY_KEY = ["subscriptions", "events"] as const;

function BellIcon(props: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3.1a4.1 4.1 0 0 0-4.1 4.1v1.7c0 .7-.23 1.38-.66 1.94L4.1 12.7h11.8l-1.14-1.86a3.2 3.2 0 0 1-.66-1.94V7.2A4.1 4.1 0 0 0 10 3.1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill={props.filled ? "currentColor" : "none"}
      />
      <path d="M8.1 14.6a1.9 1.9 0 0 0 3.8 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function EventWatchButton(props: { eventId: string; variant?: "drawer" | "table" | "inline" }) {
  const qc = useQueryClient();
  const variant = props.variant ?? "inline";
  const listQ = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<WatchList>("/api/subscriptions/events"),
    staleTime: 30_000
  });
  const watched = (listQ.data?.eventIds ?? []).includes(props.eventId);

  const toggleM = useMutation({
    mutationFn: async (subscribe: boolean) => {
      if (subscribe) return apiPost(`/api/subscriptions/events/${props.eventId}`, {});
      return apiDelete(`/api/subscriptions/events/${props.eventId}`);
    },
    onMutate: async (subscribe) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev = qc.getQueryData<WatchList>(QUERY_KEY);
      const next = new Set(prev?.eventIds ?? []);
      if (subscribe) next.add(props.eventId);
      else next.delete(props.eventId);
      qc.setQueryData<WatchList>(QUERY_KEY, { eventIds: [...next] });
      return { prev };
    },
    onError: (_err, _subscribe, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["subscriptions"] });
    }
  });

  const label = watched ? "Вы подписаны на изменения" : "Подписаться на изменения";
  const className = [
    variant === "drawer" ? "drawerShareBtn" : "",
    variant === "table" ? "ganttTableIconBtn" : "",
    variant === "inline" ? "eventWatchInlineBtn" : "",
    watched ? "eventWatchBtnOn" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      aria-pressed={watched}
      aria-label={label}
      title={`${label}. Письмо придёт на вашу почту, если SMTP настроен.`}
      disabled={toggleM.isPending}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleM.mutate(!watched);
      }}
    >
      <BellIcon filled={watched} />
    </button>
  );
}
