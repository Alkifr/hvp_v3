import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet } from "../../lib/api";

export type PresenceUserOption = {
  id: string;
  email: string;
  displayName?: string | null;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
};

type PresenceResponse = {
  ok: true;
  user: { id: string; email: string; displayName?: string | null };
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  days: Array<{ date: string; count: number; logins: number; pages: number; edits: number }>;
  hours: number[][];
  pages: Array<{ page: string; count: number }>;
  recent: Array<{ createdAt: string; kind: string; page: string | null; detail: string | null }>;
};

const PAGE_LABEL: Record<string, string> = {
  gantt: "План (Гантт)",
  hangar: "Ангар",
  import: "Импорт/План · Импорт",
  mass: "Импорт/План · Планирование",
  ref: "Справочники",
  profile: "Профиль",
  admin: "Админка",
  sandboxes: "Песочницы",
  analytics: "Аналитика",
  mail: "Рассылка",
  help: "Инструкция"
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const HOUR_TICKS = [0, 6, 12, 18, 23];

function weekdayMon0(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
  return (wd + 6) % 7;
}

function levelFor(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const t = count / max;
  if (t > 0.75) return 4;
  if (t > 0.45) return 3;
  if (t > 0.2) return 2;
  return 1;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "ещё не было";
  const d = dayjs(iso);
  if (!d.isValid()) return "ещё не было";
  const diffMin = dayjs().diff(d, "minute");
  if (diffMin < 2) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = dayjs().diff(d, "hour");
  if (diffH < 24) return `${diffH} ч назад`;
  return d.format("DD.MM.YYYY HH:mm");
}

function kindLabel(kind: string): string {
  if (kind === "LOGIN") return "Вход";
  if (kind === "PAGE") return "Раздел";
  if (kind === "ACTION") return "Действие";
  return kind;
}

export function UserPresencePanel(props: {
  users: PresenceUserOption[];
  selectedUserId: string | null;
  onSelectUser: (id: string) => void;
}) {
  const selected = props.selectedUserId || props.users[0]?.id || "";
  const q = useQuery({
    queryKey: ["admin", "presence", selected],
    queryFn: () => apiGet<PresenceResponse>(`/api/admin/users/${selected}/presence`),
    enabled: Boolean(selected)
  });

  const maxDay = useMemo(() => Math.max(1, ...(q.data?.days ?? []).map((d) => d.count)), [q.data?.days]);
  const maxHour = useMemo(() => Math.max(1, ...(q.data?.hours ?? []).flat()), [q.data?.hours]);

  const calendar = useMemo(() => {
    const days = q.data?.days ?? [];
    if (!days.length) return { weeks: [] as Array<Array<(typeof days)[0] | null>>, monthLabels: [] as string[] };
    const lead = weekdayMon0(days[0]!.date);
    const cells: Array<(typeof days)[0] | null> = [...Array(lead).fill(null), ...days];
    while (cells.length % 7 !== 0) cells.push(null);
    const weekCount = cells.length / 7;
    const weeks: Array<Array<(typeof days)[0] | null>> = [];
    for (let w = 0; w < weekCount; w++) {
      weeks.push(cells.slice(w * 7, w * 7 + 7));
    }
    const monthLabels: string[] = [];
    let lastMonth = "";
    for (const week of weeks) {
      const first = week.find(Boolean);
      if (!first) {
        monthLabels.push("");
        continue;
      }
      const label = dayjs(first.date).format("MMM");
      monthLabels.push(label !== lastMonth ? label : "");
      lastMonth = label;
    }
    return { weeks, monthLabels };
  }, [q.data?.days]);

  const hourRows = useMemo(() => {
    const src = q.data?.hours ?? [];
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.map((wd, i) => ({ label: WEEKDAYS[i]!, values: src[wd] ?? Array(24).fill(0) }));
  }, [q.data?.hours]);

  const [hoursOpen, setHoursOpen] = useState(true);

  return (
    <section className="card adminPanel adminPresencePanel">
      <div className="adminListToolbar">
        <div className="adminListTitle">
          <strong>Присутствие</strong>
          <span className="muted adminHint">17 недель · разделы и входы, не каждый клик</span>
        </div>
        <label className="adminPresenceUserPick">
          <span>Пользователь</span>
          <select value={selected} onChange={(e) => props.onSelectUser(e.target.value)}>
            {props.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading ? <div className="muted">Загружаем тепловую карту…</div> : null}
      {q.error ? <div className="error">{String((q.error as Error).message || q.error)}</div> : null}

      {q.data ? (
        <>
          <div className="adminPresenceStats">
            <div>
              <span className="muted">Последний вход</span>
              <strong>{formatWhen(q.data.lastLoginAt)}</strong>
            </div>
            <div>
              <span className="muted">Был в системе</span>
              <strong>{formatWhen(q.data.lastSeenAt)}</strong>
            </div>
            <div>
              <span className="muted">Событий за период</span>
              <strong>{q.data.days.reduce((s, d) => s + d.count, 0)}</strong>
            </div>
          </div>

          <div className="adminHeatmap" aria-label="Тепловая карта по дням">
            <div className="adminHeatmapMonths">
              <span className="adminHeatmapWeekLabel" />
              {calendar.monthLabels.map((label, i) => (
                <span key={i} className="adminHeatmapMonth">
                  {label}
                </span>
              ))}
            </div>
            <div className="adminHeatmapGrid">
              <div className="adminHeatmapWeekdays">
                {WEEKDAYS.map((d, i) => (
                  <span key={d} className={i % 2 ? "muted" : undefined}>
                    {i % 2 ? d : ""}
                  </span>
                ))}
              </div>
              <div className="adminHeatmapWeeks">
                {calendar.weeks.map((week, wi) => (
                  <div key={wi} className="adminHeatmapWeek">
                    {week.map((cell, di) => {
                      const lvl = cell ? levelFor(cell.count, maxDay) : 0;
                      const title = cell
                        ? `${dayjs(cell.date).format("DD.MM.YYYY")}: ${cell.count} (разделы ${cell.pages}, входы ${cell.logins}, правки ${cell.edits})`
                        : "";
                      return (
                        <span
                          key={`${wi}-${di}`}
                          className={`adminHeatmapCell lvl${cell ? lvl : "empty"}`}
                          title={title}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="adminHeatmapLegend">
              <span className="muted">Меньше</span>
              <span className="adminHeatmapCell lvl0" />
              <span className="adminHeatmapCell lvl1" />
              <span className="adminHeatmapCell lvl2" />
              <span className="adminHeatmapCell lvl3" />
              <span className="adminHeatmapCell lvl4" />
              <span className="muted">Больше</span>
            </div>
          </div>

          <button type="button" className="adminPresenceToggle" onClick={() => setHoursOpen((v) => !v)}>
            {hoursOpen ? "Скрыть часы недели" : "Показать часы недели"}
          </button>

          {hoursOpen ? (
            <div className="adminHourmap" aria-label="Активность по часам">
              {hourRows.map((row) => (
                <div key={row.label} className="adminHourmapRow">
                  <span className="adminHourmapLabel">{row.label}</span>
                  <div className="adminHourmapCells">
                    {row.values.map((n, h) => (
                      <span
                        key={h}
                        className={`adminHeatmapCell lvl${levelFor(n, maxHour)}`}
                        title={`${row.label} ${String(h).padStart(2, "0")}:00 — ${n}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="adminHourmapTicks">
                <span />
                <div>
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h}>{HOUR_TICKS.includes(h) ? String(h).padStart(2, "0") : ""}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="adminPresenceSplit">
            <div>
              <strong>Где бывал</strong>
              {q.data.pages.length === 0 ? (
                <div className="muted">Пока нет переходов по разделам.</div>
              ) : (
                <ul className="adminPresencePages">
                  {q.data.pages.map((p) => (
                    <li key={p.page}>
                      <span>{PAGE_LABEL[p.page] ?? p.page}</span>
                      <b>{p.count}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <strong>Последние действия</strong>
              {q.data.recent.length === 0 ? (
                <div className="muted">Журнал разделов начнёт копиться после входов пользователей.</div>
              ) : (
                <ol className="adminPresenceRecent">
                  {q.data.recent.map((r, i) => (
                    <li key={`${r.createdAt}-${i}`}>
                      <span className="muted">{dayjs(r.createdAt).format("DD.MM HH:mm")}</span>
                      <span>{kindLabel(r.kind)}</span>
                      <span>{r.page ? PAGE_LABEL[r.page] ?? r.page : r.detail || "—"}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

export { formatWhen as formatPresenceWhen };
