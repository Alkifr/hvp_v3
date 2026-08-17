import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet, apiPost } from "../../lib/api";
import { MSK_OFFSET_MINUTES } from "../../lib/localDate";

export type AppAnnouncement = {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  body: string;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  status: "active" | "inactive" | "expired";
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; email: string; displayName: string | null } | null;
  dismissalCount?: number;
};

type ActiveResponse = { ok: true; items: AppAnnouncement[] };

export function formatAnnouncementPeriod(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt && !endsAt) return null;
  const fmt = (iso: string) => dayjs(iso).utcOffset(MSK_OFFSET_MINUTES).format("DD.MM.YYYY HH:mm");
  if (startsAt && endsAt) return `${fmt(startsAt)} — ${fmt(endsAt)} (МСК)`;
  if (startsAt) return `с ${fmt(startsAt)} (МСК)`;
  return `до ${fmt(endsAt!)} (МСК)`;
}

export function announcementKindClass(kind: string): string {
  if (kind === "OUTAGE") return "announceKindOutage";
  if (kind === "MAINTENANCE") return "announceKindMaintenance";
  if (kind === "CHANGE") return "announceKindChange";
  return "announceKindUpdate";
}

export function AnnouncementModal() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["announcements", "active"],
    queryFn: () => apiGet<ActiveResponse>("/api/announcements/active"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true
  });

  const current = q.data?.items[0] ?? null;

  const dismissM = useMutation({
    mutationFn: (id: string) => apiPost(`/api/announcements/${id}/dismiss`, {}),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["announcements", "active"] });
      qc.setQueryData<ActiveResponse>(["announcements", "active"], (prev) =>
        prev ? { ...prev, items: prev.items.filter((x) => x.id !== id) } : prev
      );
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["announcements", "active"] });
    }
  });

  const currentId = current?.id ?? null;

  useEffect(() => {
    if (!currentId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissM.mutate(currentId);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
    // mutate is stable; re-bind only when the shown announcement changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const period = useMemo(
    () => (current ? formatAnnouncementPeriod(current.startsAt, current.endsAt) : null),
    [current]
  );

  if (!current) return null;

  return createPortal(
    <div
      className="modalBackdrop announceBackdrop"
      onMouseDown={() => {
        if (!dismissM.isPending) dismissM.mutate(current.id);
      }}
    >
      <div
        className={`modalWindow announceModal ${announcementKindClass(current.kind)}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="announce-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modalHeader announceHeader">
          <div className="announceHeaderText">
            <span className={`announceKindBadge ${announcementKindClass(current.kind)}`}>{current.kindLabel}</span>
            <h2 className="modalTitle" id="announce-title">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            className="modalClose"
            aria-label="Закрыть"
            disabled={dismissM.isPending}
            onClick={() => dismissM.mutate(current.id)}
          >
            ×
          </button>
        </div>
        <div className="modalBody announceBody">
          {period ? <div className="announcePeriod">{period}</div> : null}
          <div className="announceText">{current.body}</div>
        </div>
        <div className="modalFooter">
          <button
            type="button"
            className="btn btnPrimary"
            disabled={dismissM.isPending}
            onClick={() => dismissM.mutate(current.id)}
          >
            Понятно
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
