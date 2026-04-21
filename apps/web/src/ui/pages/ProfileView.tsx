import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet } from "../../lib/api";
import {
  authChangePassword,
  authLogout,
  authMyActivity,
  MeResponse,
  MyActivityItem
} from "../auth/authApi";

type RefMaps = {
  hangars: Map<string, string>;
  layouts: Map<string, string>;
  stands: Map<string, string>;
  aircraft: Map<string, string>;
  aircraftTypes: Map<string, string>;
  eventTypes: Map<string, string>;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  PLANNED: "Запланировано",
  IN_PROGRESS: "В работе",
  DONE: "Завершено",
  CANCELLED: "Отменено"
};

const LEVEL_LABEL: Record<string, string> = {
  STRATEGIC: "Стратегический",
  OPERATIONAL: "Оперативный"
};

type AuthedUser = Extract<MeResponse, { ok: true }>["user"];
type ActionFilter = "" | "CREATE" | "UPDATE" | "RESERVE" | "UNRESERVE";

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Создание",
  UPDATE: "Изменение",
  RESERVE: "Резервирование",
  UNRESERVE: "Снятие резерва"
};

const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  level: "Уровень",
  status: "Статус",
  aircraftId: "Борт",
  eventTypeId: "Тип события",
  startAt: "Начало",
  endAt: "Окончание",
  notes: "Примечание",
  hangarId: "Ангар",
  layoutId: "Вариант размещения",
  standId: "Место"
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Администратор",
  PLANNER: "Планировщик",
  VIEWER: "Наблюдатель",
  PILOT: "Пилот"
};

function initialsFromUser(u: AuthedUser): string {
  const base = (u.displayName ?? u.email).trim();
  if (!base) return "?";
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function looksLikeIsoDate(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
}

function isUuidLike(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function formatValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (looksLikeIsoDate(v)) {
    const d = dayjs(v as string);
    if (d.isValid()) return d.format("DD.MM.YYYY HH:mm");
  }
  if (typeof v === "string") {
    if (isUuidLike(v)) return v.slice(0, 8) + "…";
    return v.length > 80 ? v.slice(0, 77) + "…" : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return `[${v.length}]`;
  }
  if (isPlainObject(v)) return "{…}";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

type DiffEntry = {
  field: string;
  rawKey?: string; // ключ исходного поля, по нему резолвим id в имя
  from?: unknown;
  to?: unknown;
  note?: string;
};

function labelFor(key: string): string {
  return FIELD_LABEL[key] ?? key;
}

// Плоское сравнение двух снимков {field -> value} — добавляет только изменившиеся поля
function diffSnapshots(from: Record<string, unknown>, to: Record<string, unknown>, prefix = ""): DiffEntry[] {
  const out: DiffEntry[] = [];
  const keys = new Set<string>([...Object.keys(from ?? {}), ...Object.keys(to ?? {})]);
  for (const k of keys) {
    const fv = from?.[k];
    const tv = to?.[k];
    if (isPlainObject(fv) || isPlainObject(tv)) {
      const nestedFrom = isPlainObject(fv) ? fv : {};
      const nestedTo = isPlainObject(tv) ? tv : {};
      out.push(...diffSnapshots(nestedFrom, nestedTo, prefix ? `${prefix} › ${labelFor(k)}` : labelFor(k)));
      continue;
    }
    const a = looksLikeIsoDate(fv) ? new Date(fv as string).getTime() : fv;
    const b = looksLikeIsoDate(tv) ? new Date(tv as string).getTime() : tv;
    if (a === b) continue;
    out.push({
      field: prefix ? `${prefix} › ${labelFor(k)}` : labelFor(k),
      rawKey: k,
      from: fv,
      to: tv
    });
  }
  return out;
}

function extractDiffEntries(changes: any): DiffEntry[] {
  if (!changes || typeof changes !== "object") return [];
  const out: DiffEntry[] = [];
  const topFrom = isPlainObject(changes.from) ? (changes.from as Record<string, unknown>) : null;
  const topTo = isPlainObject(changes.to) ? (changes.to as Record<string, unknown>) : null;

  if (topFrom && topTo) {
    out.push(...diffSnapshots(topFrom, topTo));
  }

  for (const [k, v] of Object.entries(changes as Record<string, unknown>)) {
    if (k === "from" || k === "to") continue;
    if (isPlainObject(v) && "from" in v && "to" in v) {
      const vv = v as { from?: unknown; to?: unknown };
      if (isPlainObject(vv.from) || isPlainObject(vv.to)) {
        out.push(
          ...diffSnapshots(
            (isPlainObject(vv.from) ? vv.from : {}) as Record<string, unknown>,
            (isPlainObject(vv.to) ? vv.to : {}) as Record<string, unknown>,
            labelFor(k)
          )
        );
      } else {
        out.push({ field: labelFor(k), rawKey: k, from: vv.from, to: vv.to });
      }
      continue;
    }
    if (k === "created" && isPlainObject(v)) {
      for (const [ck, cv] of Object.entries(v)) {
        if (cv == null || cv === "") continue;
        out.push({ field: `Создано › ${labelFor(ck)}`, rawKey: ck, to: cv });
      }
      continue;
    }
    if (k === "tow" && isPlainObject(v)) {
      if ((v as any).add) out.push({ field: "Буксировка", note: "добавлена" });
      if ((v as any).delete) out.push({ field: "Буксировка", note: "удалена" });
      continue;
    }
    if (k === "imported" && isPlainObject(v)) {
      for (const [ik, iv] of Object.entries(v)) {
        if (iv == null || iv === "") continue;
        out.push({ field: `Импорт › ${ik}`, note: formatValue(iv) });
      }
      continue;
    }
    if (k === "dnd" && isPlainObject(v)) {
      const parts: string[] = [];
      if ("bumpOnConflict" in v && (v as any).bumpOnConflict) parts.push("вытеснение при конфликте");
      const bumped = (v as any).bumpedEventIds;
      if (Array.isArray(bumped) && bumped.length > 0) parts.push(`вытеснено: ${bumped.length}`);
      if ((v as any).bumpedByEventId) parts.push("событие вытеснено другим");
      if (parts.length > 0) out.push({ field: "Перенос", note: parts.join(", ") });
      continue;
    }
    if (k === "massPlan" && isPlainObject(v)) {
      const placed = (v as any).placed;
      out.push({ field: "Массовое планирование", note: placed ? "размещено" : "черновик" });
      continue;
    }
    if (!isPlainObject(v) && !Array.isArray(v)) {
      out.push({ field: labelFor(k), rawKey: k, note: formatValue(v) });
    } else if (isPlainObject(v)) {
      for (const [nk, nv] of Object.entries(v)) {
        out.push({ field: `${labelFor(k)} › ${labelFor(nk)}`, rawKey: nk, note: formatValue(nv) });
      }
    }
  }

  return out;
}

// разрешает id → человеко-читаемое имя через справочники,
// для дат/других типов — через formatValue
function resolveValue(rawKey: string | undefined, v: unknown, maps: RefMaps): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string") {
    switch (rawKey) {
      case "aircraftId":
        return maps.aircraft.get(v) ?? formatValue(v);
      case "eventTypeId":
        return maps.eventTypes.get(v) ?? formatValue(v);
      case "hangarId":
        return maps.hangars.get(v) ?? formatValue(v);
      case "layoutId":
        return maps.layouts.get(v) ?? formatValue(v);
      case "standId":
        return maps.stands.get(v) ?? formatValue(v);
      case "typeId":
      case "aircraftTypeId":
        return maps.aircraftTypes.get(v) ?? formatValue(v);
      case "status":
        return STATUS_LABEL[v] ?? v;
      case "level":
        return LEVEL_LABEL[v] ?? v;
      default:
        return formatValue(v);
    }
  }
  return formatValue(v);
}

export function ProfileView(props: { me: AuthedUser }) {
  const qc = useQueryClient();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNew, setShowNew] = useState(false);

  const [actionFilter, setActionFilter] = useState<ActionFilter>("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  const logoutM = useMutation({
    mutationFn: () => authLogout(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });

  const changeM = useMutation({
    mutationFn: () => authChangePassword(oldPassword, newPassword),
    onSuccess: async (r) => {
      if (r.ok) {
        setOldPassword("");
        setNewPassword("");
        await qc.invalidateQueries({ queryKey: ["auth", "me"] });
      }
    }
  });

  const activityQ = useQuery({
    queryKey: ["me", "activity", actionFilter, search, limit, offset],
    queryFn: () =>
      authMyActivity({
        action: actionFilter || undefined,
        q: search.trim() || undefined,
        limit,
        offset
      }),
    staleTime: 10_000
  });

  // Справочники для «расшифровки» id в именах (ангары, варианты размещения,
  // места, борта, типы ВС, типы событий).
  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Array<{ id: string; name: string }>>("/api/ref/hangars"),
    staleTime: 60_000
  });
  const layoutsQ = useQuery({
    queryKey: ["ref", "layouts"],
    queryFn: () => apiGet<Array<{ id: string; name: string }>>("/api/ref/layouts"),
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

  const refMaps = useMemo<RefMaps>(() => {
    const m: RefMaps = {
      hangars: new Map(),
      layouts: new Map(),
      stands: new Map(),
      aircraft: new Map(),
      aircraftTypes: new Map(),
      eventTypes: new Map()
    };
    for (const h of hangarsQ.data ?? []) m.hangars.set(h.id, h.name);
    for (const l of layoutsQ.data ?? []) m.layouts.set(l.id, l.name);
    for (const s of standsQ.data ?? []) m.stands.set(s.id, s.name ? `${s.code} — ${s.name}` : s.code);
    for (const a of aircraftQ.data ?? []) m.aircraft.set(a.id, a.tailNumber);
    for (const t of aircraftTypesQ.data ?? []) m.aircraftTypes.set(t.id, t.name);
    for (const e of eventTypesQ.data ?? []) m.eventTypes.set(e.id, e.name);
    return m;
  }, [
    hangarsQ.data,
    layoutsQ.data,
    standsQ.data,
    aircraftQ.data,
    aircraftTypesQ.data,
    eventTypesQ.data
  ]);

  const pwStrength = useMemo(() => {
    const pw = newPassword;
    if (!pw) return { score: 0, label: "" };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const label = ["очень слабый", "слабый", "средний", "хороший", "надёжный", "отличный"][score] ?? "";
    return { score, label };
  }, [newPassword]);

  const initials = initialsFromUser(props.me);
  const total = activityQ.data?.total ?? 0;
  const items = activityQ.data?.items ?? [];
  const byAction = activityQ.data?.byAction ?? { CREATE: 0, UPDATE: 0, RESERVE: 0, UNRESERVE: 0 };

  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div className="profilePage">
      <section className="card profileHero">
        <div className="profileAvatar" aria-hidden="true">
          {initials}
        </div>
        <div className="profileHeroText">
          <div className="profileHeroName">{props.me.displayName ?? props.me.email}</div>
          <div className="profileHeroEmail">{props.me.email}</div>
          <div className="profileHeroRoles">
            {props.me.roles.length === 0 ? (
              <span className="profileRoleBadge profileRoleBadgeMuted">нет ролей</span>
            ) : (
              props.me.roles.map((r) => (
                <span key={r} className={`profileRoleBadge profileRoleBadge_${r}`}>
                  {ROLE_LABEL[r] ?? r}
                </span>
              ))
            )}
            {props.me.mustChangePassword ? (
              <span className="profileRoleBadge profileRoleBadgeWarn" title="Требуется сменить пароль">
                сменить пароль
              </span>
            ) : null}
          </div>
        </div>
        <div className="profileHeroActions">
          <button
            className="btn"
            onClick={() => logoutM.mutate()}
            disabled={logoutM.isPending}
            title="Выйти из системы"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 6, verticalAlign: "-2px" }}>
              <path d="M12 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7" />
              <path d="M9 10h9m0 0-3-3m3 3-3 3" />
            </svg>
            Выйти
          </button>
        </div>
      </section>

      <div className="profileGrid">
        <section className="card profileCard">
          <header className="profileCardHeader">
            <div className="profileCardTitle">Учётная запись</div>
            <div className="profileCardHint">Базовые данные и права доступа.</div>
          </header>
          <div className="profileCardBody">
            <div className="profileKv">
              <div className="profileKvKey">Имя</div>
              <div className="profileKvVal">{props.me.displayName ?? "—"}</div>
            </div>
            <div className="profileKv">
              <div className="profileKvKey">Email</div>
              <div className="profileKvVal">{props.me.email}</div>
            </div>
            <div className="profileKv">
              <div className="profileKvKey">Роли</div>
              <div className="profileKvVal">
                {props.me.roles.length === 0
                  ? "—"
                  : props.me.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}
              </div>
            </div>
            <div className="profileKv">
              <div className="profileKvKey">Разрешения</div>
              <div className="profileKvVal profileKvPerms">
                {props.me.permissions.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  props.me.permissions.map((p) => (
                    <code key={p} className="profilePerm">
                      {p}
                    </code>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="card profileCard">
          <header className="profileCardHeader">
            <div className="profileCardTitle">Безопасность</div>
            <div className="profileCardHint">Смена пароля. Минимум 8 символов.</div>
          </header>
          <div className="profileCardBody">
            <label className="profileField">
              <span className="profileFieldLabel">Текущий пароль</span>
              <input
                className="profileInput"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="profileField">
              <span className="profileFieldLabel">Новый пароль</span>
              <div className="profilePwRow">
                <input
                  className="profileInput"
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                />
                <button
                  type="button"
                  className="profilePwToggle"
                  onClick={() => setShowNew((v) => !v)}
                  title={showNew ? "Скрыть пароль" : "Показать пароль"}
                >
                  {showNew ? "скрыть" : "показать"}
                </button>
              </div>
              {newPassword ? (
                <div className={`profilePwMeter profilePwMeter_${Math.min(5, pwStrength.score)}`}>
                  <div className="profilePwMeterBar" />
                  <span className="profilePwMeterLabel">{pwStrength.label}</span>
                </div>
              ) : null}
            </label>
            <div className="profileActions">
              <button
                className="btn btnPrimary"
                onClick={() => changeM.mutate()}
                disabled={changeM.isPending || oldPassword.length === 0 || newPassword.length < 8}
              >
                Сохранить пароль
              </button>
              {changeM.data?.ok ? (
                <span className="muted">Пароль обновлён.</span>
              ) : changeM.data && !changeM.data.ok ? (
                <span className="error">
                  Ошибка: {changeM.data.error === "OLD_PASSWORD_INVALID" ? "неверный текущий пароль" : changeM.data.error}
                </span>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <section className="card profileCard">
        <header className="profileCardHeader profileActivityHeader">
          <div>
            <div className="profileCardTitle">Моя активность</div>
            <div className="profileCardHint">Все изменения, сделанные вами в событиях ТО.</div>
          </div>
          <div className="profileActivityStats">
            <ActivityStat label="всего" value={total} />
            <ActivityStat label="создано" value={byAction.CREATE} />
            <ActivityStat label="изменено" value={byAction.UPDATE} />
            <ActivityStat label="резервы" value={byAction.RESERVE + byAction.UNRESERVE} />
          </div>
        </header>

        <div className="profileActivityToolbar">
          <div className="profileActivityTabs" role="tablist">
            {(["", "CREATE", "UPDATE", "RESERVE", "UNRESERVE"] as ActionFilter[]).map((a) => (
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
                {a === "" ? "Все" : ACTION_LABEL[a]}
                <span className="profileActivityTabCount">
                  {a === ""
                    ? total
                    : (byAction[a as "CREATE" | "UPDATE" | "RESERVE" | "UNRESERVE"] ?? 0)}
                </span>
              </button>
            ))}
          </div>
          <div className="profileActivitySearch">
            <input
              className="profileInput"
              type="search"
              placeholder="Поиск по названию события или причине…"
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
                {actionFilter || search.trim()
                  ? "По заданному фильтру записей нет — попробуйте сбросить."
                  : "Как только вы измените событие, здесь появится запись."}
              </div>
            </div>
          ) : (
            <ol className="profileTimeline">
              {items.map((it) => (
                <ActivityItem key={it.id} item={it} maps={refMaps} />
              ))}
            </ol>
          )}
        </div>

        <footer className="profileActivityFooter">
          <div className="muted">
            {total === 0
              ? "—"
              : `${offset + 1}–${Math.min(offset + limit, total)} из ${total}`}
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
            <button
              className="btn"
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={!hasPrev}
            >
              Назад
            </button>
            <button
              className="btn"
              onClick={() => setOffset(offset + limit)}
              disabled={!hasNext}
            >
              Далее
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ActivityStat(props: { label: string; value: number }) {
  return (
    <div className="profileActivityStat">
      <div className="profileActivityStatValue">{props.value}</div>
      <div className="profileActivityStatLabel">{props.label}</div>
    </div>
  );
}

function ActivityItem({ item, maps }: { item: MyActivityItem; maps: RefMaps }) {
  const [open, setOpen] = useState(false);
  const diffs = useMemo(() => extractDiffEntries(item.changes), [item.changes]);
  const when = dayjs(item.createdAt);
  const eventLabel = item.event
    ? `${item.event.title}${item.event.tailNumber ? ` • ${item.event.tailNumber}` : ""}`
    : "Событие удалено";

  return (
    <li className={`profileTimelineItem profileTimelineItem_${item.action}`}>
      <div className="profileTimelineDot" aria-hidden="true" />
      <div className="profileTimelineBody">
        <div className="profileTimelineHead">
          <span className={`profileActionBadge profileActionBadge_${item.action}`}>
            {ACTION_LABEL[item.action] ?? item.action}
          </span>
          <span className="profileTimelineTitle">{eventLabel}</span>
          <span className="muted profileTimelineTime" title={when.format("DD.MM.YYYY HH:mm:ss")}>
            {when.format("DD.MM.YYYY HH:mm")}
          </span>
        </div>
        {item.reason ? (
          <div className="profileTimelineReason">
            <span className="muted">Причина: </span>
            {item.reason}
          </div>
        ) : null}
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
                        <span className="profileDiffFrom">{resolveValue(d.rawKey, d.from, maps)}</span>
                      ) : null}
                      {hasFrom && hasTo ? (
                        <span className="profileDiffArrow" aria-hidden="true">→</span>
                      ) : null}
                      {hasTo ? (
                        <span className="profileDiffTo">{resolveValue(d.rawKey, d.to, maps)}</span>
                      ) : null}
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
