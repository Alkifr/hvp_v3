import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";

import { PRESENCE_PAGE_LABEL } from "../../lib/userPrefs";
import { authMyPresence } from "../auth/authApi";

type KindFilter = "" | "LOGIN" | "PAGE";

function kindLabel(kind: string): string {
  if (kind === "LOGIN") return "Вход";
  if (kind === "PAGE") return "Раздел";
  return kind;
}

export function PresenceFeed() {
  const [kind, setKind] = useState<KindFilter>("");
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ["me", "presence", kind, limit, offset],
    queryFn: () =>
      authMyPresence({
        kind: kind || undefined,
        limit,
        offset
      }),
    staleTime: 10_000
  });

  const total = q.data?.total ?? 0;
  const items = q.data?.items ?? [];
  const byKind = q.data?.byKind ?? { LOGIN: 0, PAGE: 0 };
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <section className="card profileCard profileCardCompact">
      <header className="profileCardHeader profileActivityHeader">
        <div>
          <div className="profileCardTitle">Входы и разделы</div>
          <div className="profileCardHint">Журнал входов в систему и переходов по разделам. Правки плана — на соседней вкладке.</div>
        </div>
        <div className="profileActivityStats">
          <div className="profileActivityStat">
            <div className="profileActivityStatValue">{total}</div>
            <div className="profileActivityStatLabel">записей</div>
          </div>
          <div className="profileActivityStat">
            <div className="profileActivityStatValue">{byKind.LOGIN}</div>
            <div className="profileActivityStatLabel">входов</div>
          </div>
          <div className="profileActivityStat">
            <div className="profileActivityStatValue">{byKind.PAGE}</div>
            <div className="profileActivityStatLabel">разделов</div>
          </div>
        </div>
      </header>
      <div className="profileActivityToolbar">
        <div className="profileActivityTabs" role="tablist">
          {(
            [
              ["", "Все"],
              ["LOGIN", "Входы"],
              ["PAGE", "Разделы"]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id || "all"}
              type="button"
              className={`profileActivityTab${kind === id ? " profileActivityTabActive" : ""}`}
              onClick={() => {
                setKind(id);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="profileActivityBody">
        {q.isLoading ? (
          <div className="muted">Загрузка…</div>
        ) : items.length === 0 ? (
          <div className="profileEmpty">
            <div className="profileEmptyTitle">Пока нет записей</div>
            <div className="muted">Входы появятся после следующего логина.</div>
          </div>
        ) : (
          <ol className="profileTimeline">
            {items.map((row) => (
              <li key={row.id} className={`profileTimelineItem profileTimelineItem_${row.kind}`}>
                <span className="profileTimelineDot" aria-hidden="true" />
                <div className="profileTimelineBody">
                  <div className="profileTimelineHead">
                    <span className={`profileActionBadge profileActionBadge_${row.kind}`}>{kindLabel(row.kind)}</span>
                    <span className="profileTimelineMeta">{dayjs(row.createdAt).format("DD.MM.YYYY HH:mm")}</span>
                  </div>
                  <div className="profileTimelineMeta">
                    {row.kind === "PAGE"
                      ? PRESENCE_PAGE_LABEL[row.page ?? ""] ?? row.page ?? "Раздел"
                      : "Вход в систему"}
                    {row.detail ? ` · ${row.detail}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {total > limit ? (
          <div className="profileActivityPager">
            <button type="button" className="btn" disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Назад
            </button>
            <span className="muted">
              {offset + 1}–{Math.min(offset + limit, total)} из {total}
            </span>
            <button type="button" className="btn" disabled={!hasNext} onClick={() => setOffset(offset + limit)}>
              Дальше
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
