import dayjs from "dayjs";

import { STATUS_LABEL } from "./eventStatusCatalog";

export { STATUS_LABEL };

const LEGACY_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  PROPOSED: "Предложено",
  APPROVED: "Согласовано"
};

export const LEVEL_LABEL: Record<string, string> = {
  STRATEGIC: "Стратегический",
  OPERATIONAL: "Оперативный"
};

export const ACTIVITY_ACTION_LABEL: Record<string, string> = {
  CREATE: "Событие создано",
  UPDATE: "Данные события изменены",
  RESERVE: "Место назначено",
  UNRESERVE: "Резерв места снят",
  SANDBOX_CREATE: "Песочница создана",
  SANDBOX_DELETE: "Песочница удалена",
  CLEANUP: "Выполнена очистка"
};

export const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  level: "Уровень",
  status: "Статус",
  planningKind: "Вид планирования",
  aircraftId: "Борт",
  operatorId: "Оператор",
  label: "Обозначение борта",
  eventTypeId: "Тип события",
  startAt: "Начало",
  endAt: "Окончание",
  startAtLocal: "Начало",
  endAtLocal: "Окончание",
  budgetStartAt: "Бюджетное начало",
  budgetEndAt: "Бюджетное окончание",
  budgetStartAtLocal: "Бюджетное начало",
  budgetEndAtLocal: "Бюджетное окончание",
  actualStartAt: "Фактическое начало",
  actualEndAt: "Фактическое окончание",
  actualStartAtLocal: "Фактическое начало",
  actualEndAtLocal: "Фактическое окончание",
  notes: "Примечание",
  hangarId: "Ангар",
  layoutId: "Вариант размещения",
  standId: "Место",
  workshopId: "Цех",
  allowOverlap: "Разрешить пересечение",
  multiPlacement: "Несколько размещений",
  virtualAircraft: "Виртуальный борт",
  placements: "Этапы размещения",
  reservation: "Резерв места",
  origin: "Источник этапа",
  placed: "Результат размещения",
  draft: "Черновик",
  scheduleMode: "Режим расписания",
  spacingHours: "Интервал между событиями, ч",
  cadenceHours: "Шаг запуска, ч",
  placementMode: "Режим размещения",
  towBeforeMinutes: "Буксировка до события, мин",
  towAfterMinutes: "Буксировка после события, мин",
  towBlocksStand: "Буксировка занимает место",
  warnings: "Предупреждения",
  Operator: "Оператор",
  Aircraft: "Борт",
  AircraftType: "Тип ВС",
  Event_Title: "Название события",
  Event_name: "Тип события",
  Hangar: "Ангар",
  HangarStand: "Место",
  towStartAt: "Начало буксировки",
  towEndAt: "Окончание буксировки",
  sandbox: "Песочница",
  sandboxId: "Песочница",
  sandboxName: "Название песочницы",
  name: "Название",
  copyFrom: "Источник копирования",
  copied: "Скопировано",
  mergeFrom: "Объединены песочницы",
  totals: "Итого скопировано",
  events: "События",
  reservations: "Резервы мест",
  tows: "Буксировки",
  skippedDuplicates: "Пропущено дубликатов",
  eventCount: "Количество событий",
  updated: "Обработано событий",
  filters: "Условия отбора",
  from: "Период с",
  to: "Период по",
  cleanup: "Массовая очистка",
  mode: "Режим",
  batchSize: "Событий в группе",
  score: "Оценка размещения",
  scoreDetails: "Расчёт оценки",
  priorityRuleIds: "Применённые правила приоритета",
  sourceEventId: "Исходное событие",
  sourceSandboxId: "Исходная песочница",
  originEventId: "Корневое событие"
};

export type HistoryRefMaps = {
  hangars: Map<string, string>;
  layouts: Map<string, string>;
  stands: Map<string, string>;
  aircraft: Map<string, string>;
  aircraftTypes: Map<string, string>;
  operators?: Map<string, string>;
  eventTypes: Map<string, string>;
  workshops?: Map<string, string>;
  statuses?: Map<string, string>;
};

export type DiffEntry = {
  field: string;
  rawKey?: string;
  from?: unknown;
  to?: unknown;
  note?: string;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function looksLikeIsoDate(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
}

function isUuidLike(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function formatHistoryValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (looksLikeIsoDate(v)) {
    const d = dayjs(v as string);
    if (d.isValid()) return d.format("DD.MM.YYYY HH:mm");
  }
  if (typeof v === "string") {
    if (v === "PLANNED") return "Плановое";
    if (v === "UNPLANNED") return "Внеплановое";
    if (STATUS_LABEL[v] || LEGACY_STATUS_LABEL[v]) return STATUS_LABEL[v] ?? LEGACY_STATUS_LABEL[v]!;
    if (LEVEL_LABEL[v]) return LEVEL_LABEL[v];
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

function labelFor(key: string): string {
  return FIELD_LABEL[key] ?? key;
}

function pluralStages(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "этап";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "этапа";
  return "этапов";
}

function formatPeriod(startAt: unknown, endAt: unknown): string {
  if (!startAt && !endAt) return "";
  const start = formatHistoryValue(startAt);
  const end = formatHistoryValue(endAt);
  return startAt && endAt ? `${start} — ${end}` : startAt ? `с ${start}` : `до ${end}`;
}

function resolveRef(rawKey: string, value: unknown, maps?: HistoryRefMaps): string {
  if (typeof value !== "string" || !maps) return formatHistoryValue(value);
  switch (rawKey) {
    case "aircraftId":
      return maps.aircraft.get(value) ?? formatHistoryValue(value);
    case "eventTypeId":
      return maps.eventTypes.get(value) ?? formatHistoryValue(value);
    case "hangarId":
      return maps.hangars.get(value) ?? formatHistoryValue(value);
    case "layoutId":
      return maps.layouts.get(value) ?? formatHistoryValue(value);
    case "standId":
      return maps.stands.get(value) ?? formatHistoryValue(value);
    case "workshopId":
      return maps.workshops?.get(value) ?? formatHistoryValue(value);
    case "typeId":
    case "aircraftTypeId":
      return maps.aircraftTypes.get(value) ?? formatHistoryValue(value);
    case "operatorId":
      return maps.operators?.get(value) ?? formatHistoryValue(value);
    default:
      return formatHistoryValue(value);
  }
}

function formatPlacement(placement: unknown, index: number, maps?: HistoryRefMaps): string {
  if (!isPlainObject(placement)) return formatHistoryValue(placement);
  const period = formatPeriod(placement.startAt ?? placement.startAtLocal, placement.endAt ?? placement.endAtLocal);
  const origin = placement.origin === "AUTO_GAP";
  const layout = placement.layoutId ? resolveRef("layoutId", placement.layoutId, maps) : "";
  const hangar = placement.hangarId ? resolveRef("hangarId", placement.hangarId, maps) : "";
  const stand = placement.standId ? resolveRef("standId", placement.standId, maps) : "";
  const location = origin
    ? "Без ангара (создано автоматически)"
    : layout
      ? `${layout}${stand ? `, место ${stand}` : ", без места"}`
      : hangar
        ? `${hangar}${stand ? `, место ${stand}` : ", без места"}`
        : "Без ангара";
  return `${index + 1}. ${period ? `${period} · ` : ""}${location}`;
}

function formatPlacements(value: unknown, maps?: HistoryRefMaps): string {
  if (!Array.isArray(value) || value.length === 0) return "Этапов нет";
  return `${value.length} ${pluralStages(value.length)}: ${value.map((placement, index) => formatPlacement(placement, index, maps)).join("; ")}`;
}

function formatReservation(value: unknown, maps?: HistoryRefMaps): string {
  if (!isPlainObject(value)) return value == null ? "Резерв отсутствует" : formatHistoryValue(value);
  const layout = value.layoutId ? resolveRef("layoutId", value.layoutId, maps) : "";
  const stand = value.standId ? resolveRef("standId", value.standId, maps) : "";
  const period = formatPeriod(value.startAt, value.endAt);
  return [layout, stand ? `место ${stand}` : "", period].filter(Boolean).join(" · ") || "Резерв отсутствует";
}

function comparableHistoryValue(value: unknown): unknown {
  if (looksLikeIsoDate(value)) {
    const timestamp = new Date(value as string).getTime();
    return Number.isFinite(timestamp) ? timestamp : value;
  }
  if (Array.isArray(value)) return value.map(comparableHistoryValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, comparableHistoryValue(value[key])])
    );
  }
  return value;
}

function historyValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(comparableHistoryValue(left)) === JSON.stringify(comparableHistoryValue(right));
}

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
    if (historyValuesEqual(fv, tv)) continue;
    out.push({
      field: prefix ? `${prefix} › ${labelFor(k)}` : labelFor(k),
      rawKey: k,
      from: fv,
      to: tv
    });
  }
  return out;
}

export function extractDiffEntries(changes: unknown): DiffEntry[] {
  if (!changes || typeof changes !== "object") return [];
  const out: DiffEntry[] = [];
  const ch = changes as Record<string, unknown>;
  const topFrom = isPlainObject(ch.from) ? (ch.from as Record<string, unknown>) : null;
  const topTo = isPlainObject(ch.to) ? (ch.to as Record<string, unknown>) : null;

  if (topFrom && topTo) {
    out.push(...diffSnapshots(topFrom, topTo));
  }

  for (const [k, v] of Object.entries(ch)) {
    if (k === "from" || k === "to") continue;
    if (isPlainObject(v) && "from" in v && "to" in v) {
      const vv = v as { from?: unknown; to?: unknown };
      if (historyValuesEqual(vv.from, vv.to)) continue;
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
      const added = (v as { add?: unknown }).add;
      if (isPlainObject(added)) {
        out.push({
          field: "Интервал буксировки добавлен",
          note: formatPeriod(added.startAt, added.endAt) || "Период не указан"
        });
      }
      if ((v as { delete?: unknown }).delete) out.push({ field: "Интервал буксировки удалён", note: "Удалён из события" });
      continue;
    }
    if (k === "imported" && isPlainObject(v)) {
      for (const [ik, iv] of Object.entries(v)) {
        if (iv == null || iv === "") continue;
        out.push({ field: `Импортировано › ${labelFor(ik)}`, rawKey: ik, to: iv });
      }
      continue;
    }
    if (k === "dnd" && isPlainObject(v)) {
      const parts: string[] = [];
      const mode = (v as { mode?: unknown }).mode;
      if (mode === "hangar-auto-placement") parts.push("автоматически подобраны схема и место");
      if (mode === "hangar-auto-placement-batch") parts.push("автоматически размещено в составе группы");
      if ("bumpOnConflict" in v && (v as { bumpOnConflict?: unknown }).bumpOnConflict) {
        parts.push("разрешено вытеснение при конфликте");
      }
      const bumped = (v as { bumpedEventIds?: unknown }).bumpedEventIds;
      if (Array.isArray(bumped) && bumped.length > 0) parts.push(`освобождено конфликтующих событий: ${bumped.length}`);
      if ((v as { bumpedByEventId?: unknown }).bumpedByEventId) {
        parts.push("событие вытеснено другим событием, ангар и место сняты");
      }
      const statusTo = (v as { statusTo?: unknown }).statusTo;
      if (statusTo) parts.push(`новый статус: ${formatHistoryValue(statusTo)}`);
      if (parts.length > 0) out.push({ field: "Перемещение на диаграмме", note: parts.join("; ") });
      continue;
    }
    if (k === "massPlan" && isPlainObject(v)) {
      const placed = (v as { placed?: unknown }).placed;
      out.push({
        field: "Результат массового планирования",
        note: placed ? "Событие создано и размещено" : "Создан черновик без назначенного места"
      });
      for (const key of [
        "hangarId",
        "layoutId",
        "standId",
        "scheduleMode",
        "spacingHours",
        "cadenceHours",
        "placementMode",
        "towBeforeMinutes",
        "towAfterMinutes",
        "towBlocksStand",
        "budgetStartAt",
        "budgetEndAt",
        "actualStartAt",
        "actualEndAt",
        "score",
        "scoreDetails",
        "warnings"
      ]) {
        const value = v[key];
        if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
        out.push({ field: labelFor(key), rawKey: key, to: value });
      }
      continue;
    }
    if (k === "copiedFrom" && isPlainObject(v)) {
      out.push({
        field: "Источник события",
        note: v.sourceSandboxId ? "Скопировано из другой песочницы" : "Скопировано из рабочего контура"
      });
      continue;
    }
    if (k === "promotedFrom" && isPlainObject(v)) {
      out.push({ field: "Источник события", note: "Перенесено из песочницы в рабочий контур" });
      continue;
    }
    if (k === "cleanup" && isPlainObject(v)) {
      out.push({ field: "Массовая очистка", note: "Событие логически удалено при очистке контура" });
      continue;
    }
    if (k === "sandbox" && isPlainObject(v)) {
      out.push({ field: "Песочница", note: v.name ? `«${String(v.name)}»` : "Операция с песочницей" });
      continue;
    }
    if (k === "mergeFrom" && Array.isArray(v)) {
      out.push({ field: "Слияние песочниц", note: `Объединено источников: ${v.length}` });
      continue;
    }
    if (k === "copyFrom") {
      const note =
        v === "empty"
          ? "Создана пустая песочница"
          : isPlainObject(v)
            ? `Скопирован план за период ${formatPeriod(v.from, v.to)}`
            : "Скопирован текущий план";
      out.push({ field: "Источник данных", note });
      continue;
    }
    if (!isPlainObject(v) && !Array.isArray(v)) {
      out.push({ field: labelFor(k), rawKey: k, note: formatHistoryValue(v) });
    } else if (Array.isArray(v)) {
      out.push({ field: labelFor(k), rawKey: k, to: v });
    } else if (isPlainObject(v)) {
      for (const [nk, nv] of Object.entries(v)) {
        if (nv == null || nv === "") continue;
        out.push({ field: `${labelFor(k)} › ${labelFor(nk)}`, rawKey: nk, to: nv });
      }
    }
  }

  return out;
}

export function resolveHistoryValue(rawKey: string | undefined, v: unknown, maps?: HistoryRefMaps): string {
  if (v == null || v === "") return "—";

  if (rawKey === "placements") return formatPlacements(v, maps);
  if (rawKey === "reservation") return formatReservation(v, maps);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return v.map((item) => (isPlainObject(item) ? formatReservation(item, maps) : formatHistoryValue(item))).join("; ");
  }
  if (isPlainObject(v)) {
    return Object.entries(v)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => `${labelFor(key)}: ${resolveHistoryValue(key, value, maps)}`)
      .join("; ");
  }

  if (typeof v === "boolean") {
    return v ? "да" : "нет";
  }

  if (typeof v === "string") {
    if (rawKey && /AtLocal$/.test(rawKey) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = dayjs(v);
      if (d.isValid()) return d.format("DD.MM.YYYY HH:mm");
    }
    if (rawKey === "status") return maps?.statuses?.get(v) ?? STATUS_LABEL[v] ?? LEGACY_STATUS_LABEL[v] ?? formatHistoryValue(v);
    if (rawKey === "level") return LEVEL_LABEL[v] ?? formatHistoryValue(v);
    if (rawKey === "planningKind") {
      return v === "PLANNED" ? "Плановое" : v === "UNPLANNED" ? "Внеплановое" : formatHistoryValue(v);
    }
    if (rawKey === "origin") return v === "AUTO_GAP" ? "Создан системой для заполнения разрыва" : "Добавлен пользователем";
    if (rawKey === "placementMode") {
      return v === "auto"
        ? "Автоматический подбор"
        : v === "preferredHangars"
          ? "По выбранным ангарам"
          : v === "draftOnConflict"
            ? "Черновик при конфликте"
            : v;
    }
    if (rawKey === "scheduleMode") {
      return v === "compact"
        ? "Компактно"
        : v === "sequential"
          ? "Последовательно"
          : v === "fixedCadence"
            ? "С фиксированным шагом"
            : formatHistoryValue(v);
    }
    if (rawKey) return resolveRef(rawKey, v, maps);
  }

  return formatHistoryValue(v);
}

export function formatHistoryActor(actor: string | null | undefined): string {
  const a = String(actor ?? "").trim();
  if (!a || a === "system" || a === "browser") return a === "system" ? "Система" : a || "—";
  return a;
}

export function formatActionLabel(action: string, changes?: unknown): string {
  if (action === "CREATE" && isPlainObject(changes)) {
    if (isPlainObject(changes.imported)) return "Событие импортировано";
    if (isPlainObject(changes.massPlan)) return "Событие создано массовым планированием";
  }
  if (action === "UPDATE" && isPlainObject(changes)) {
    if (isPlainObject(changes.tow)) {
      return (changes.tow as { add?: unknown }).add ? "Добавлена буксировка" : "Удалена буксировка";
    }
    if (isPlainObject(changes.dnd)) {
      return (changes.dnd as { bumpedByEventId?: unknown }).bumpedByEventId
        ? "Событие вытеснено с места"
        : "Событие перемещено";
    }
    const keys = extractDiffEntries(changes)
      .map((entry) => entry.rawKey)
      .filter((key): key is string => Boolean(key));
    if (keys.includes("placements")) return "Изменены этапы размещения";
    if (keys.length === 1 && keys[0] === "status") return "Изменён статус события";
    if (keys.length === 1 && keys[0] === "title") return "Изменено название события";
    if (keys.some((key) => ["startAt", "endAt", "budgetStartAt", "budgetEndAt", "actualStartAt", "actualEndAt"].includes(key))) {
      return "Изменены сроки события";
    }
  }
  return ACTIVITY_ACTION_LABEL[action] ?? action;
}
