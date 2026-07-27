import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet } from "../../lib/api";
import {
  ACTIVITY_ACTION_LABEL,
  extractDiffEntries,
  formatActionLabel,
  resolveHistoryValue,
  type HistoryRefMaps
} from "../../lib/eventHistoryFormat";
import { adminActivity, authMyActivity, MyActivityItem, MyActivityResponse } from "../auth/authApi";

export { ACTIVITY_ACTION_LABEL };

type RefMaps = HistoryRefMaps;

type ActionFilter = "" | MyActivityItem["action"];

const ACTION_FILTERS: ActionFilter[] = [
  "",
  "CREATE",
  "UPDATE",
  "RESERVE",
  "UNRESERVE",
  "SANDBOX_CREATE",
  "SANDBOX_DELETE",
  "CLEANUP"
];

function useRefMaps(): RefMaps {
  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Array<{ id: string; name: string }>>("/api/ref/hangars"),
    staleTime: 60_000
  });
  const layoutsQ = useQuery({
    queryKey: ["ref", "layouts"],
    queryFn: () => apiGet<Array<{ id: string; name: string; hangarId: string }>>("/api/ref/layouts"),
    staleTime: 60_000
  });
  const standsQ = useQuery({
    queryKey: ["ref", "stands"],
    queryFn: () => apiGet<Array<{ id: string; code: string; name?: string }>>("/api/ref/stands"),
    staleTime: 60_000
  });
  const aircraftQ = useQuery({
    queryKey: ["ref", "aircraft"],
    queryFn: () => apiGet<Array<{ id: string; tailNumber: string }>>("/api/ref/aircraft"),
    staleTime: 60_000
  });
  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<Array<{ id: string; name: string }>>("/api/ref/aircraft-types"),
    staleTime: 60_000
  });
  const eventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<Array<{ id: string; name: string }>>("/api/ref/event-types"),
    staleTime: 60_000
  });
  const operatorsQ = useQuery({
    queryKey: ["ref", "operators"],
    queryFn: () => apiGet<Array<{ id: string; name: string }>>("/api/ref/operators"),
    staleTime: 60_000
  });

  return useMemo<RefMaps>(() => {
    const m: RefMaps = {
      hangars: new Map(),
      layouts: new Map(),
      stands: new Map(),
      aircraft: new Map(),
      aircraftTypes: new Map(),
      eventTypes: new Map()
    };
    for (const h of hangarsQ.data ?? []) m.hangars.set(h.id, h.name);
    for (const l of layoutsQ.data ?? []) {
      const hangarName = m.hangars.get(l.hangarId);
      m.layouts.set(l.id, hangarName ? `${hangarName} / ${l.name}` : l.name);
    }
    for (const s of standsQ.data ?? []) m.stands.set(s.id, s.name ? `${s.code} — ${s.name}` : s.code);
    for (const a of aircraftQ.data ?? []) m.aircraft.set(a.id, a.tailNumber);
    for (const t of aircraftTypesQ.data ?? []) m.aircraftTypes.set(t.id, t.name);
    m.operators = new Map((operatorsQ.data ?? []).map((operator) => [operator.id, operator.name] as const));
    for (const e of eventTypesQ.data ?? []) m.eventTypes.set(e.id, e.name);
    return m;
  }, [
    hangarsQ.data,
    layoutsQ.data,
    standsQ.data,
    aircraftQ.data,
    aircraftTypesQ.data,
    operatorsQ.data,
    eventTypesQ.data
  ]);
}

function ActivityStat(props: { label: string; value: number }) {
  return (
    <div className="profileActivityStat">
      <div className="profileActivityStatValue">{props.value}</div>
      <div className="profileActivityStatLabel">{props.label}</div>
    </div>
  );
}

function ActivityItem({
  item,
  maps,
  showActor
}: {
  item: MyActivityItem;
  maps: RefMaps;
  showActor?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const diffs = useMemo(() => extractDiffEntries(item.changes), [item.changes]);
  const when = dayjs(item.createdAt);
  const isSandboxOp = item.action === "SANDBOX_CREATE" || item.action === "SANDBOX_DELETE" || item.action === "CLEANUP";
  const eventLabel = item.event
    ? `${item.event.title}${item.event.tailNumber ? ` • ${item.event.tailNumber}` : ""}`
    : isSandboxOp
      ? item.source.sandboxName
        ? `Песочница «${item.source.sandboxName}»`
        : "Операция с контуром"
      : "Событие удалено";
  const sourceLabel =
    item.source.kind === "sandbox"
      ? item.source.sandboxName
        ? `Песочница «${item.source.sandboxName}»`
        : "Песочница"
      : "Рабочий контур";

  return (
    <li className={`profileTimelineItem profileTimelineItem_${item.action}`}>
      <div className="profileTimelineDot" aria-hidden="true" />
      <div className="profileTimelineBody">
        <div className="profileTimelineHead">
          <span className={`profileActionBadge profileActionBadge_${item.action}`}>
            {formatActionLabel(item.action, item.changes)}
          </span>
          <span className="profileTimelineTitle">{eventLabel}</span>
          <span className="muted profileTimelineTime" title={when.format("DD.MM.YYYY HH:mm:ss")}>
            {when.format("DD.MM.YYYY HH:mm")}
          </span>
        </div>
        <div className="profileTimelineMeta">
          {showActor && item.actor ? (
            <div className="profileTimelineSource">
              <span className="muted">Пользователь: </span>
              <span className="profileTimelineActor">{item.actor}</span>
            </div>
          ) : null}
          <div className="profileTimelineSource">
            <span className="muted">Источник: </span>
            <span className={item.source.kind === "sandbox" ? "profileSourceSandbox" : "profileSourceProd"}>
              {sourceLabel}
            </span>
          </div>
          {item.reason ? (
            <div className="profileTimelineReason">
              <span className="muted">Комментарий: </span>
              {item.reason}
            </div>
          ) : null}
        </div>
        {diffs.length > 0 ? (
          <div className="profileDiffList">
            {(open ? diffs : diffs.slice(0, 3)).map((d, i) => {
              const hasFrom = "from" in d;
              const hasTo = "to" in d;
              return (
                <div key={`${d.field}-${i}`} className="profileDiffItem">
                  <span className="profileDiffField">{d.field}</span>
                  {hasFrom || hasTo ? (
                    <span className="profileDiffValues">
                      {hasFrom ? (
                        <span className="profileDiffFrom">{resolveHistoryValue(d.rawKey, d.from, maps)}</span>
                      ) : null}
                      {hasFrom && hasTo ? (
                        <span className="profileDiffArrow" aria-hidden="true">
                          →
                        </span>
                      ) : null}
                      {hasTo ? <span className="profileDiffTo">{resolveHistoryValue(d.rawKey, d.to, maps)}</span> : null}
                    </span>
                  ) : (
                    <span className="muted">{d.note}</span>
                  )}
                </div>
              );
            })}
            {diffs.length > 3 ? (
              <button type="button" className="profileDiffMore" onClick={() => setOpen((v) => !v)}>
                {open ? "свернуть" : `ещё ${diffs.length - 3}`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export type ActivityFeedProps = {
  mode: "self" | "admin";
  title?: string;
  hint?: string;
  /** Список email для фильтра (админка). Пустой actor = все. */
  actors?: Array<{ email: string; label: string }>;
  compact?: boolean;
};

export function ActivityFeed(props: ActivityFeedProps) {
  const { mode, actors } = props;
  const [actionFilter, setActionFilter] = useState<ActionFilter>("");
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("");
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const maps = useRefMaps();

  const activityQ = useQuery({
    queryKey: [mode === "admin" ? "admin" : "me", "activity", actionFilter, search, actor, limit, offset],
    queryFn: (): Promise<MyActivityResponse> => {
      const params = {
        action: actionFilter || undefined,
        q: search.trim() || undefined,
        limit,
        offset,
        ...(mode === "admin" && actor ? { actor } : {})
      };
      return mode === "admin" ? adminActivity(params) : authMyActivity(params);
    },
    staleTime: 10_000
  });

  const total = activityQ.data?.total ?? 0;
  const items = activityQ.data?.items ?? [];
  const byAction = activityQ.data?.byAction ?? {
    CREATE: 0,
    UPDATE: 0,
    RESERVE: 0,
    UNRESERVE: 0,
    SANDBOX_CREATE: 0,
    SANDBOX_DELETE: 0,
    CLEANUP: 0
  };
  const sandboxOps = (byAction.SANDBOX_CREATE ?? 0) + (byAction.SANDBOX_DELETE ?? 0) + (byAction.CLEANUP ?? 0);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  const title = props.title ?? (mode === "admin" ? "Журнал активности" : "Моя активность");
  const hint =
    props.hint ??
    (mode === "admin"
      ? "Все изменения событий и операции с песочницами по всем пользователям."
      : "Изменения событий и операции с песочницами — по всем контурам.");

  return (
    <section className={`card profileCard${props.compact ? " profileCardCompact" : ""}`}>
      <header className="profileCardHeader profileActivityHeader">
        <div>
          <div className="profileCardTitle">{title}</div>
          <div className="profileCardHint">{hint}</div>
        </div>
        <div className="profileActivityStats">
          <ActivityStat label="всего" value={total} />
          <ActivityStat label="создано" value={byAction.CREATE} />
          <ActivityStat label="изменено" value={byAction.UPDATE} />
          <ActivityStat label="резервы" value={byAction.RESERVE + byAction.UNRESERVE} />
          <ActivityStat label="песочницы" value={sandboxOps} />
        </div>
      </header>

      <div className="profileActivityToolbar">
        {mode === "admin" && actors && actors.length > 0 ? (
          <label className="profileActivityActor">
            <span className="muted">Пользователь</span>
            <select
              className="profileInput profileInputCompact"
              value={actor}
              onChange={(e) => {
                setActor(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Все</option>
              {actors.map((a) => (
                <option key={a.email} value={a.email}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="profileActivityTabs" role="tablist">
          {ACTION_FILTERS.map((a) => (
            <button
              key={a || "ALL"}
              type="button"
              role="tab"
              className={`profileActivityTab${actionFilter === a ? " profileActivityTabActive" : ""}`}
              onClick={() => {
                setActionFilter(a);
                setOffset(0);
              }}
            >
              {a === "" ? "Все" : ACTIVITY_ACTION_LABEL[a]}
              <span className="profileActivityTabCount">
                {a === "" ? total : (byAction[a as keyof typeof byAction] ?? 0)}
              </span>
            </button>
          ))}
        </div>
        <div className="profileActivitySearch">
          <input
            className="profileInput"
            type="search"
            placeholder={mode === "admin" ? "Поиск по событию, причине, email…" : "Поиск по названию или причине…"}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
      </div>

      <div className="profileActivityBody">
        {activityQ.isLoading ? (
          <div className="muted">Загружаем…</div>
        ) : activityQ.error ? (
          <div className="error">Не удалось загрузить активность.</div>
        ) : items.length === 0 ? (
          <div className="profileEmpty">
            <div className="profileEmptyTitle">Пока ничего нет</div>
            <div className="muted">
              {actionFilter || search.trim() || actor
                ? "По заданному фильтру записей нет — попробуйте сбросить."
                : mode === "admin"
                  ? "Как только пользователи изменят события, здесь появятся записи."
                  : "Как только вы измените событие, здесь появится запись."}
            </div>
          </div>
        ) : (
          <ol className="profileTimeline">
            {items.map((it) => (
              <ActivityItem key={it.id} item={it} maps={maps} showActor={mode === "admin"} />
            ))}
          </ol>
        )}
      </div>

      <footer className="profileActivityFooter">
        <div className="muted">
          {total === 0 ? "—" : `${offset + 1}–${Math.min(offset + limit, total)} из ${total}`}
        </div>
        <div className="profileActivityPager">
          <label className="profilePagerSize">
            <span className="muted">на странице</span>
            <select
              className="profileInput profileInputCompact"
              value={String(limit)}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <button className="btn" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={!hasPrev}>
            Назад
          </button>
          <button className="btn" onClick={() => setOffset(offset + limit)} disabled={!hasNext}>
            Далее
          </button>
        </div>
      </footer>
    </section>
  );
}
