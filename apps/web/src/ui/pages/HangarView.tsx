import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import * as XLSX from "xlsx";

import { apiGet, apiPost, apiPut } from "../../lib/api";
import { useActiveSandbox } from "../components/SandboxSwitcher";

type BodyType = "NARROW_BODY" | "WIDE_BODY" | null;
type ViewMode = "range" | "moment";

type Hangar = { id: string; name: string; code: string };
type Layout = {
  id: string;
  name: string;
  code: string;
  hangarId: string;
  capacitySummary?: string;
};
type SummaryEvent = {
  id: string;
  title: string;
  status: string;
  aircraftLabel: string;
  aircraftTypeId: string | null;
  bodyType: BodyType;
  eventTypeName: string | null;
  startAt: string;
  endAt: string;
  reservation?: { layoutId: string; standId: string } | null;
};
type SummaryStand = {
  id: string;
  code: string;
  name: string;
  bodyType: BodyType;
  aircraftTypeIds?: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  utilizationPct: number;
  occupiedAt: SummaryEvent | null;
  reservations: SummaryEvent[];
};
type SummaryHangar = {
  hangar: Hangar;
  layout: {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    widthMeters?: number | null;
    heightMeters?: number | null;
    obstacles?: Array<{ type: string; x: number; y: number; w: number; h: number }> | null;
    capacityByBodyType: { narrow: number; wide: number; any: number };
    capacityByAircraftTypeRule?: { specific: number; any: number };
  };
  utilizationPct: number;
  timeUtilizationPct: number;
  aircraftHours: number;
  capacityHours: number;
  conflictPct: number;
  conflictSegments: number;
  efficiencyTimeline: Array<{
    startAt: string;
    endAt: string;
    layoutId: string | null;
    layoutName: string | null;
    activeLayoutIds: string[];
    occupiedCount: number;
    capacity: number;
    utilizationPct: number;
    conflict: boolean;
  }>;
  occupiedAtCount: number;
  freeAtCount: number | null;
  eventCount: number;
  standCount: number;
  stands: SummaryStand[];
};
type SummaryResponse = {
  ok: boolean;
  summary: { events: number; unplaced: number; incompatible: number };
  hangars: SummaryHangar[];
  unplaced: SummaryEvent[];
  incompatible: Array<{ event: SummaryEvent; suitableStandCount: number }>;
};
type AutoFitResponse = {
  ok: boolean;
  placements: Array<{
    event: SummaryEvent;
    hangarId: string;
    hangarName: string;
    layoutId: string;
    layoutName: string;
    standId: string;
    standCode: string;
  }>;
  unplaced: Array<{ event: SummaryEvent; reason: string }>;
  summary: { candidates: number; placed: number; unplaced: number };
};
type PlacementCandidate = {
  hangarId: string;
  hangarName: string;
  layoutId: string;
  layoutName: string;
  layoutCode: string;
  standId: string;
  standCode: string;
  score: number;
  reason: string;
};
type SuggestPlacementResponse = {
  ok: boolean;
  event: SummaryEvent | null;
  candidates: PlacementCandidate[];
  blockedLayouts: Array<{ layoutId: string; layoutName: string }>;
  summary: { candidates: number; activeLayoutIds: string[] };
};

function bodyTypeLabel(v: BodyType) {
  if (v === "NARROW_BODY") return "узкий";
  if (v === "WIDE_BODY") return "широкий";
  return "любой";
}

function occupancyColor(pct: number) {
  if (pct <= 0) return "rgba(34, 197, 94, 0.55)";
  if (pct < 35) return "rgba(34, 197, 94, 0.75)";
  if (pct < 65) return "rgba(234, 179, 8, 0.8)";
  if (pct < 90) return "rgba(249, 115, 22, 0.82)";
  return "rgba(239, 68, 68, 0.85)";
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return dayjs(aStart).valueOf() < dayjs(bEnd).valueOf() && dayjs(aEnd).valueOf() > dayjs(bStart).valueOf();
}

function standAccepts(stand: SummaryStand, event: SummaryEvent) {
  const allowed = stand.aircraftTypeIds ?? [];
  return allowed.length === 0 || !event.aircraftTypeId || allowed.includes(event.aircraftTypeId);
}

function formatEventPeriod(e: SummaryEvent) {
  return `${dayjs(e.startAt).format("DD.MM HH:mm")} – ${dayjs(e.endAt).format("DD.MM HH:mm")}`;
}

function hasLayoutLock(hangar: SummaryHangar, layoutId: string, event: SummaryEvent) {
  return hangar.efficiencyTimeline.find((segment) => {
    if (!overlaps(segment.startAt, segment.endAt, event.startAt, event.endAt)) return false;
    return segment.activeLayoutIds.some((activeLayoutId) => activeLayoutId !== layoutId);
  });
}

function timelineLeft(from: dayjs.Dayjs, to: dayjs.Dayjs, value: string) {
  const total = Math.max(1, to.valueOf() - from.valueOf());
  return Math.max(0, Math.min(100, ((dayjs(value).valueOf() - from.valueOf()) / total) * 100));
}

function overlapHours(aStart: string | dayjs.Dayjs, aEnd: string | dayjs.Dayjs, bStart: string | dayjs.Dayjs, bEnd: string | dayjs.Dayjs) {
  const s = Math.max(dayjs(aStart).valueOf(), dayjs(bStart).valueOf());
  const e = Math.min(dayjs(aEnd).valueOf(), dayjs(bEnd).valueOf());
  return Math.max(0, e - s) / (60 * 60 * 1000);
}

function formatReportDate(v: string) {
  const d = dayjs(v);
  return d.isValid() ? d.format("DD.MM.YYYY HH:mm") : "—";
}

function sheetName(raw: string, used: Set<string>) {
  const base = (raw || "Лист").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Лист";
  let name = base;
  let i = 2;
  while (used.has(name)) {
    name = `${base.slice(0, 25)} ${i}`;
    i += 1;
  }
  used.add(name);
  return name;
}

function ImportLayoutsPanel(props: { onDone: () => void }) {
  const [raw, setRaw] = useState("");
  const importM = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; hangars: number; layouts: number; stands: number }>("/api/ref/layouts/import", JSON.parse(raw)),
    onSuccess: () => {
      setRaw("");
      props.onDone();
    }
  });

  const sample = `{
  "hangars": [
    {
      "code": "SVO-1",
      "name": "Шереметьево Ангар 1",
      "layouts": [
        {
          "code": "BASE",
          "name": "Базовая схема",
          "widthMeters": 80,
          "heightMeters": 50,
          "obstacles": [{ "type": "rect", "x": 38, "y": 0, "w": 4, "h": 50 }],
          "stands": [
            { "code": "S1", "name": "Место 1", "bodyType": "NARROW_BODY", "x": 5, "y": 8, "w": 20, "h": 12 },
            { "code": "S2", "name": "Место 2", "bodyType": "WIDE_BODY", "x": 48, "y": 8, "w": 26, "h": 16 }
          ]
        }
      ]
    }
  ]
}`;

  return (
    <details className="hangarImport">
      <summary>Импорт реальных схем JSON</summary>
      <div className="hangarImportBody">
        <p className="muted">
          Демо-данные можно заменить пачкой: ангары обновляются по `code`, схемы по `hangar + code`, места по `layout + code`.
        </p>
        <textarea
          className="refInput"
          rows={8}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={sample}
        />
        <div className="row">
          <button className="btn btnPrimary" type="button" disabled={!raw.trim() || importM.isPending} onClick={() => importM.mutate()}>
            {importM.isPending ? "Импорт…" : "Импортировать схемы"}
          </button>
          <button className="btn" type="button" onClick={() => setRaw(sample)}>
            Вставить пример
          </button>
          {importM.isSuccess ? <span className="muted">Импорт завершён.</span> : null}
        </div>
        {importM.error ? <div className="errorMsg">{String((importM.error as any)?.message ?? importM.error)}</div> : null}
      </div>
    </details>
  );
}

export function HangarView() {
  const qc = useQueryClient();
  const { active: activeSandbox } = useActiveSandbox();
  const [viewMode, setViewMode] = useState<ViewMode>("range");
  const [fromDate, setFromDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState(() => dayjs().add(14, "day").format("YYYY-MM-DD"));
  const [minuteOffset, setMinuteOffset] = useState(12 * 60);
  const [expandedHangarId, setExpandedHangarId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [layoutIdByHangarId, setLayoutIdByHangarId] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Map<string, { layoutId: string; standId: string }>>(new Map());
  const [fitResult, setFitResult] = useState<AutoFitResponse | null>(null);
  const [suggestResult, setSuggestResult] = useState<SuggestPlacementResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const from = useMemo(() => dayjs(fromDate).startOf("day"), [fromDate]);
  const to = useMemo(() => dayjs(toDate).endOf("day"), [toDate]);
  const totalMinutes = Math.max(0, to.diff(from, "minute"));
  const effectiveMinuteOffset = Math.min(minuteOffset, totalMinutes);
  const at = useMemo(() => from.add(effectiveMinuteOffset, "minute"), [from, effectiveMinuteOffset]);

  const hangarsQ = useQuery({ queryKey: ["ref", "hangars"], queryFn: () => apiGet<Hangar[]>("/api/ref/hangars") });
  const layoutsAllQ = useQuery({ queryKey: ["ref", "layouts", "all"], queryFn: () => apiGet<Layout[]>("/api/ref/layouts") });

  const hangars = hangarsQ.data ?? [];
  const layoutsByHangar = useMemo(() => {
    const map: Record<string, Layout[]> = {};
    for (const layout of layoutsAllQ.data ?? []) {
      if (!map[layout.hangarId]) map[layout.hangarId] = [];
      map[layout.hangarId]!.push(layout);
    }
    for (const key of Object.keys(map)) map[key]!.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return map;
  }, [layoutsAllQ.data]);

  const layoutIdPerHangar = useMemo(() => {
    const out: Record<string, string> = {};
    for (const h of hangars) {
      const list = layoutsByHangar[h.id] ?? [];
      const preferred = layoutIdByHangarId[h.id];
      out[h.id] = preferred && list.some((l) => l.id === preferred) ? preferred : list[0]?.id ?? "";
    }
    return out;
  }, [hangars, layoutsByHangar, layoutIdByHangarId]);

  const selectedLayoutIds = useMemo(() => Object.values(layoutIdPerHangar).filter(Boolean), [layoutIdPerHangar]);
  const summaryQ = useQuery({
    queryKey: ["hangar-planning", "summary", from.toISOString(), to.toISOString(), selectedLayoutIds.join(",")],
    enabled: selectedLayoutIds.length > 0,
    queryFn: () => {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        layoutIds: selectedLayoutIds.join(",")
      });
      return apiGet<SummaryResponse>(`/api/hangar-planning/summary?${params.toString()}`);
    },
    placeholderData: (prev) => prev
  });

  const summary = useMemo<SummaryResponse | undefined>(() => {
    const data = summaryQ.data;
    if (!data) return data;
    if (viewMode !== "moment") return data;

    const atMs = at.valueOf();
    return {
      ...data,
      hangars: data.hangars.map((h) => {
        let occupiedAtCount = 0;
        const stands = h.stands.map((s) => {
          const occupiedAt =
            s.reservations.find((r) => dayjs(r.startAt).valueOf() <= atMs && dayjs(r.endAt).valueOf() > atMs) ?? null;
          if (occupiedAt) occupiedAtCount += 1;
          return { ...s, occupiedAt };
        });
        return {
          ...h,
          occupiedAtCount,
          freeAtCount: Math.max(0, h.standCount - occupiedAtCount),
          stands
        };
      })
    };
  }, [summaryQ.data, viewMode, at]);
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    const all = [...(summary?.unplaced ?? []), ...(summary?.hangars ?? []).flatMap((h) => h.stands.flatMap((s) => s.reservations))];
    return all.find((e) => e.id === selectedEventId) ?? null;
  }, [summary, selectedEventId]);

  const efficiencyReport = useMemo(() => {
    const dailyRows: Array<Record<string, string | number>> = [];
    const eventRows: Array<Record<string, string | number>> = [];
    const pivotRows: Array<Record<string, string | number>> = [];
    for (const hangar of summary?.hangars ?? []) {
      const reservations = hangar.stands.flatMap((stand) =>
        stand.reservations.map((event) => ({
          stand,
          event
        }))
      );

      for (let cursor = from.startOf("day"); cursor.valueOf() < to.valueOf(); cursor = cursor.add(1, "day")) {
        const dayStart = cursor;
        const dayEnd = dayjs(Math.min(cursor.add(1, "day").valueOf(), to.valueOf()));
        const dayHours = Math.max(0, dayEnd.diff(dayStart, "minute")) / 60;
        const selectedCapacity = hangar.standCount;
        const activeSegments = (hangar.efficiencyTimeline ?? []).filter((segment) =>
          overlaps(segment.startAt, segment.endAt, dayStart.toISOString(), dayEnd.toISOString())
        );

        let occupiedTimeHours = 0;
        let conflictHours = 0;
        let activeCapacityHours = 0;
        const activeLayoutNames = new Set<string>();
        const activeLayoutIds = new Set<string>();

        for (const segment of activeSegments) {
          const hours = overlapHours(segment.startAt, segment.endAt, dayStart, dayEnd);
          occupiedTimeHours += hours;
          if (segment.conflict) conflictHours += hours;
          const capacity = segment.conflict || segment.capacity <= 0 ? selectedCapacity : segment.capacity;
          activeCapacityHours += capacity * hours;
          if (segment.layoutName) activeLayoutNames.add(segment.layoutName);
          for (const id of segment.activeLayoutIds) activeLayoutIds.add(id);
        }

        const emptyHours = Math.max(0, dayHours - occupiedTimeHours);
        const availablePlaceHours = activeCapacityHours + selectedCapacity * emptyHours;
        const occupiedAircraftHours = reservations.reduce(
          (sum, x) => sum + overlapHours(x.event.startAt, x.event.endAt, dayStart, dayEnd),
          0
        );
        const freePlaceHours = Math.max(0, availablePlaceHours - occupiedAircraftHours);

        const dailyBase = {
          "Ангар": hangar.hangar.name,
          "Код ангара": hangar.hangar.code,
          "Дата": dayStart.format("YYYY-MM-DD"),
          "Выбранная схема в UI": hangar.layout.name,
          "Активные схемы в дне": activeLayoutNames.size ? Array.from(activeLayoutNames).join(", ") : "—",
          "ID активных схем": activeLayoutIds.size ? Array.from(activeLayoutIds).join(", ") : "—",
          "Ёмкость выбранной схемы, мест": selectedCapacity,
          "Часов в периоде даты": Number(dayHours.toFixed(2)),
          "Доступные место-часы": Number(availablePlaceHours.toFixed(2)),
          "Занятые ВС-часы": Number(occupiedAircraftHours.toFixed(2)),
          "Свободные место-часы": Number(freePlaceHours.toFixed(2)),
          "Занятость по времени, ч": Number(occupiedTimeHours.toFixed(2)),
          "Занятость по времени, %": dayHours > 0 ? Number(((occupiedTimeHours / dayHours) * 100).toFixed(2)) : 0,
          "Эффективность по месту-часам, %": availablePlaceHours > 0 ? Number(((occupiedAircraftHours / availablePlaceHours) * 100).toFixed(2)) : 0,
          "Конфликт схем, ч": Number(conflictHours.toFixed(2)),
          "Конфликт схем": conflictHours > 0 ? "Да" : "Нет"
        };

        dailyRows.push(dailyBase);
        pivotRows.push({
          ...dailyBase,
          "Признак строки": "Доступно",
          "Часы строки": Number(availablePlaceHours.toFixed(2)),
          "Борт": "—",
          "Событие": "—",
          "Тип события": "—",
          "Тип ВС": "—",
          "МС": "—",
          "Период события": "—",
          "ID события": "—"
        });

        if (freePlaceHours > 0) {
          pivotRows.push({
            ...dailyBase,
            "Признак строки": "Свободно",
            "Часы строки": Number(freePlaceHours.toFixed(2)),
            "Борт": "—",
            "Событие": "Свободная мощность",
            "Тип события": "—",
            "Тип ВС": "—",
            "МС": "—",
            "Период события": "—",
            "ID события": "—"
          });
        }

        if (conflictHours > 0) {
          pivotRows.push({
            ...dailyBase,
            "Признак строки": "Конфликт схем",
            "Часы строки": Number(conflictHours.toFixed(2)),
            "Борт": "—",
            "Событие": "Одновременно активны разные схемы ангара",
            "Тип события": "—",
            "Тип ВС": "—",
            "МС": "—",
            "Период события": "—",
            "ID события": "—"
          });
        }

        for (const { stand, event } of reservations) {
          const eventHours = overlapHours(event.startAt, event.endAt, dayStart, dayEnd);
          if (eventHours <= 0) continue;
          const eventBase = {
            "Ангар": hangar.hangar.name,
            "Код ангара": hangar.hangar.code,
            "Дата": dayStart.format("YYYY-MM-DD"),
            "Схема": hangar.layout.name,
            "МС": stand.code,
            "Борт": event.aircraftLabel,
            "Событие": event.title,
            "Тип события": event.eventTypeName ?? "—",
            "Тип ВС": bodyTypeLabel(event.bodyType),
            "Занятые ВС-часы": Number(eventHours.toFixed(2)),
            "Период события": `${formatReportDate(event.startAt)} – ${formatReportDate(event.endAt)}`,
            "ID события": event.id
          };
          eventRows.push(eventBase);
          pivotRows.push({
            ...dailyBase,
            "Признак строки": "Занято",
            "Часы строки": Number(eventHours.toFixed(2)),
            "Борт": event.aircraftLabel,
            "Событие": event.title,
            "Тип события": event.eventTypeName ?? "—",
            "Тип ВС": bodyTypeLabel(event.bodyType),
            "МС": stand.code,
            "Период события": `${formatReportDate(event.startAt)} – ${formatReportDate(event.endAt)}`,
            "ID события": event.id
          });
        }
      }
    }
    return { dailyRows, eventRows, pivotRows };
  }, [from, summary, to]);

  const exportEfficiencyXlsx = () => {
    if (efficiencyReport.pivotRows.length === 0) return;
    const wb = XLSX.utils.book_new();
    const appendSheet = (name: string, rows: Array<Record<string, string | number>>, used: Set<string>) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = Object.keys(rows[0] ?? {}).map((key) => ({ wch: Math.min(44, Math.max(12, key.length + 4)) }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName(name, used));
    };

    const used = new Set<string>();
    appendSheet("Для сводной", efficiencyReport.pivotRows, used);
    appendSheet("По датам все ангары", efficiencyReport.dailyRows, used);
    for (const hangar of summary?.hangars ?? []) {
      const rows = efficiencyReport.pivotRows.filter((row) => row["Код ангара"] === hangar.hangar.code);
      if (rows.length > 0) appendSheet(hangar.hangar.name, rows, used);
    }
    if (efficiencyReport.eventRows.length > 0) appendSheet("Детализация событий", efficiencyReport.eventRows, used);
    XLSX.writeFile(wb, `hangar-efficiency-${fromDate}-${toDate}.xlsx`);
  };

  const reserveM = useMutation({
    mutationFn: async (payload: { eventId: string; layoutId: string; standId: string }) =>
      apiPut(`/api/reservations/by-event/${payload.eventId}`, {
        layoutId: payload.layoutId,
        standId: payload.standId,
        changeReason: activeSandbox ? "Сценарное размещение в песочнице" : "Сценарное размещение ангара"
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["hangar-planning"] });
      await qc.invalidateQueries({ queryKey: ["events"] });
      await qc.invalidateQueries({ queryKey: ["reservations"] });
    }
  });

  const autoFitM = useMutation({
    mutationFn: () =>
      apiPost<AutoFitResponse>("/api/hangar-planning/auto-fit", {
        from: from.toISOString(),
        to: to.toISOString(),
        layouts: hangars
          .map((h) => ({ hangarId: h.id, layoutId: layoutIdPerHangar[h.id] }))
          .filter((x) => x.layoutId)
      }),
    onSuccess: (res) => {
      setFitResult(res);
      const next = new Map(draft);
      for (const p of res.placements) next.set(p.event.id, { layoutId: p.layoutId, standId: p.standId });
      setDraft(next);
      setNotice(`Автоподбор: размещено ${res.summary.placed} из ${res.summary.candidates}.`);
    }
  });

  const applyCandidateToDraft = (eventId: string, candidate: PlacementCandidate) => {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(eventId, { layoutId: candidate.layoutId, standId: candidate.standId });
      return next;
    });
    setLayoutIdByHangarId((prev) => ({ ...prev, [candidate.hangarId]: candidate.layoutId }));
    setExpandedHangarId(candidate.hangarId);
    setSuggestResult(null);
    setNotice(`В draft: ${candidate.hangarName} · ${candidate.layoutName} · ${candidate.standCode}.`);
  };

  const suggestM = useMutation({
    mutationFn: (payload: { eventId: string; hangarId: string }) =>
      apiPost<SuggestPlacementResponse>("/api/hangar-planning/suggest-placement", payload),
    onSuccess: (res, variables) => {
      if (res.candidates.length === 0) {
        setSuggestResult(res);
        setNotice("Для выбранного события нет свободного подходящего места в этом ангаре.");
        return;
      }
      if (res.candidates.length === 1) {
        applyCandidateToDraft(variables.eventId, res.candidates[0]!);
        return;
      }
      setSuggestResult(res);
      setNotice(`Найдено вариантов: ${res.candidates.length}. Выберите место.`);
    },
    onError: (err) => setNotice(`Подбор места не выполнен: ${String((err as any)?.message ?? err)}`)
  });

  const applyDraft = async () => {
    const entries = Array.from(draft.entries());
    for (const [eventId, placement] of entries) {
      await reserveM.mutateAsync({ eventId, ...placement });
    }
    setDraft(new Map());
    setSelectedEventId(null);
    setFitResult(null);
    setSuggestResult(null);
    setNotice(`Применено размещений: ${entries.length}.`);
  };

  const placeInHangar = (hangar: SummaryHangar, eventId = selectedEventId) => {
    if (!eventId) {
      setNotice("Сначала выберите или перетащите событие.");
      return;
    }
    setSelectedEventId(eventId);
    setNotice(null);
    suggestM.mutate({ eventId, hangarId: hangar.hangar.id });
  };

  const placeOnStand = (hangar: SummaryHangar, stand: SummaryStand) => {
    if (!selectedEvent) return;
    setNotice(null);
    if (!standAccepts(stand, selectedEvent)) {
      setNotice(`Место ${stand.code} не разрешено для типа ВС выбранного события.`);
      return;
    }
    const layoutLock = hasLayoutLock(hangar, hangar.layout.id, selectedEvent);
    if (layoutLock) {
      setNotice(`Схема «${hangar.layout.name}» недоступна: в периоде уже используется «${layoutLock.layoutName ?? "другая схема"}».`);
      return;
    }
    const conflict = stand.reservations.find((r) => r.id !== selectedEvent.id && overlaps(r.startAt, r.endAt, selectedEvent.startAt, selectedEvent.endAt));
    if (conflict) {
      setNotice(`Место ${stand.code} занято: ${conflict.aircraftLabel} • ${conflict.title} (${formatEventPeriod(conflict)}).`);
      return;
    }
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(selectedEvent.id, { layoutId: hangar.layout.id, standId: stand.id });
      return next;
    });
    setSuggestResult(null);
  };

  const renderScheme = (hangar: SummaryHangar, compact: boolean) => {
    const width = hangar.layout.widthMeters ?? 80;
    const height = hangar.layout.heightMeters ?? 50;
    return (
      <svg className="hangarSchemeSvg" viewBox={`0 0 ${width} ${height}`}>
        <rect x="0" y="0" width={width} height={height} fill="#0f172a" />
        <rect x="0.5" y="0.5" width={width - 1} height={height - 1} fill="transparent" stroke="rgba(148,163,184,0.35)" strokeWidth="0.12" />
        {hangar.layout.obstacles?.map((ob, idx) =>
          ob.type === "rect" ? (
            <rect key={idx} x={ob.x} y={ob.y} width={ob.w} height={ob.h} fill="rgba(71,85,105,0.65)" stroke="rgba(226,232,240,0.3)" strokeWidth="0.08" />
          ) : null
        )}
        {hangar.stands.map((stand) => {
          const isDraft = Array.from(draft.values()).some((v) => v.layoutId === hangar.layout.id && v.standId === stand.id);
          const isBadType = Boolean(selectedEvent && !standAccepts(stand, selectedEvent));
          const layoutLock = selectedEvent ? hasLayoutLock(hangar, hangar.layout.id, selectedEvent) : null;
          const isLockedLayout = Boolean(layoutLock);
          const occupied = viewMode === "moment" ? Boolean(stand.occupiedAt) : stand.utilizationPct > 0;
          const fill = isBadType || isLockedLayout ? "rgba(100,116,139,0.65)" : viewMode === "moment" ? (occupied ? "rgba(239,68,68,0.82)" : "rgba(34,197,94,0.72)") : occupancyColor(stand.utilizationPct);
          const title = isLockedLayout
            ? `${stand.code}: схема недоступна, активна «${layoutLock?.layoutName ?? "другая схема"}»`
            : viewMode === "moment" && stand.occupiedAt
            ? `${stand.code}: ${stand.occupiedAt.aircraftLabel} • ${stand.occupiedAt.title}`
            : `${stand.code}: ${viewMode === "moment" ? "свободно" : `${stand.utilizationPct.toFixed(0)}%`}`;
          return (
            <g key={stand.id} transform={`rotate(${stand.rotate ?? 0} ${stand.x + stand.w / 2} ${stand.y + stand.h / 2})`} onClick={() => placeOnStand(hangar, stand)} style={{ cursor: selectedEvent ? "pointer" : "default" }}>
              <title>{title}</title>
              <rect
                x={stand.x + 0.08}
                y={stand.y + 0.08}
                width={stand.w - 0.16}
                height={stand.h - 0.16}
                rx="0.35"
                fill={fill}
                stroke={isDraft ? "#60a5fa" : "rgba(226,232,240,0.68)"}
                strokeWidth={isDraft ? 0.32 : 0.1}
                strokeDasharray={isDraft ? "0.45 0.25" : undefined}
              />
              <text x={stand.x + stand.w / 2} y={stand.y + stand.h / 2} fill="white" fontSize={compact ? 1.7 : 2.2} textAnchor="middle" dominantBaseline="middle" style={{ userSelect: "none", fontWeight: 700 }}>
                {stand.code}
              </text>
              {!compact ? (
                <text x={stand.x + stand.w / 2} y={stand.y + stand.h / 2 + 1.5} fill="rgba(226,232,240,0.92)" fontSize="1.15" textAnchor="middle" dominantBaseline="middle">
                  {viewMode === "moment" ? (stand.occupiedAt?.aircraftLabel ?? "free") : `${stand.utilizationPct.toFixed(0)}%`}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    );
  };

  const renderHangarCard = (hangar: SummaryHangar, expanded: boolean) => {
    const layouts = layoutsByHangar[hangar.hangar.id] ?? [];
    const cap = hangar.layout.capacityByAircraftTypeRule;
    const efficiencyTooltip =
      `Эффективность активной схемы за выбранный период.\n` +
      `Формула: ВС-часы / доступные место-часы активной схемы.\n` +
      `ВС-часы: ${hangar.aircraftHours.toFixed(2)}.\n` +
      `Доступные место-часы: ${hangar.capacityHours.toFixed(2)}.\n` +
      `Занятость ангара по времени: ${hangar.timeUtilizationPct.toFixed(2)}%.`;
    return (
      <section
        key={hangar.hangar.id}
        className={expanded ? "hangarPlanCard hangarPlanCardExpanded" : "hangarPlanCard"}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/plain")) e.preventDefault();
        }}
        onDrop={(e) => {
          const eventId = e.dataTransfer.getData("text/plain");
          if (!eventId) return;
          e.preventDefault();
          placeInHangar(hangar, eventId);
        }}
      >
        <header className="hangarPlanCardHead">
          <div>
            <div className="hangarPlanTitle">{hangar.hangar.name}</div>
            <div className="muted small">
              {hangar.hangar.code} · {hangar.layout.name} · мест: {hangar.standCount}
            </div>
          </div>
          <div className="hangarLoadBadge" title={efficiencyTooltip} aria-label={efficiencyTooltip}>
            {hangar.utilizationPct.toFixed(0)}%
          </div>
        </header>
        <div className="row" style={{ gap: 8, alignItems: "end" }}>
          <label className="refLabel" style={{ flex: "1 1 auto", margin: 0 }}>
            <span>Схема для просмотра</span>
            <select
              className="refInput"
              value={hangar.layout.id}
              onChange={(e) => {
                setLayoutIdByHangarId((prev) => ({ ...prev, [hangar.hangar.id]: e.target.value }));
                setDraft(new Map());
                setFitResult(null);
                setSuggestResult(null);
              }}
            >
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}{l.capacitySummary ? ` · ${l.capacitySummary}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btnPrimary"
            type="button"
            disabled={!selectedEventId || suggestM.isPending}
            onClick={() => placeInHangar(hangar)}
            title="Подобрать подходящую схему и место внутри ангара"
          >
            {suggestM.isPending ? "Подбор…" : "Разместить в ангар"}
          </button>
        </div>
        <div className="hangarMetrics">
          <span>Событий: <b>{hangar.eventCount}</b></span>
          <span>{viewMode === "moment" ? <>Свободно сейчас: <b>{hangar.freeAtCount ?? "—"}</b></> : <>Занят по времени: <b>{hangar.timeUtilizationPct.toFixed(0)}%</b></>}</span>
          <span>Типиз./люб.: <b>{cap?.specific ?? 0}/{cap?.any ?? hangar.standCount}</b></span>
          <span>ВС-часы: <b>{hangar.aircraftHours.toFixed(0)}</b></span>
        </div>
        <div className="hangarEfficiencyTimeline" aria-label={`Эффективность использования ${hangar.hangar.name}`}>
          {(hangar.efficiencyTimeline ?? []).length === 0 ? (
            <div className="hangarTimelineEmpty">Нет занятости в выбранном периоде</div>
          ) : (
            hangar.efficiencyTimeline.map((segment, idx) => {
              const left = timelineLeft(from, to, segment.startAt);
              const right = timelineLeft(from, to, segment.endAt);
              const width = Math.max(0.6, right - left);
              return (
                <div
                  key={`${segment.startAt}-${idx}`}
                  className={segment.conflict ? "hangarTimelineSegment hangarTimelineSegmentConflict" : "hangarTimelineSegment"}
                  style={{ left: `${left}%`, width: `${width}%`, opacity: Math.min(1, Math.max(0.35, segment.utilizationPct / 100)) }}
                  title={`${dayjs(segment.startAt).format("DD.MM HH:mm")} – ${dayjs(segment.endAt).format("DD.MM HH:mm")} · ${segment.layoutName ?? "без схемы"} · ${segment.occupiedCount}/${segment.capacity || "?"}`}
                />
              );
            })
          )}
        </div>
        <div className="hangarTimelineLegend">
          <span>Эффективность: <b>{hangar.utilizationPct.toFixed(0)}%</b></span>
          {hangar.conflictSegments > 0 ? <span className="hangarTimelineConflictText">конфликты схем: {hangar.conflictSegments}</span> : null}
        </div>
        <div className="hangarSchemeWrap">{renderScheme(hangar, !expanded)}</div>
      </section>
    );
  };

  const expanded = expandedHangarId ? summary?.hangars.find((h) => h.hangar.id === expandedHangarId) ?? null : null;
  const draftCount = draft.size;

  return (
    <div className="hangarPlanPage">
      <section className="hangarHero">
        <div>
          <div className="massEyebrow">Сценарное планирование</div>
          <h1>Ангары и схемы расстановки</h1>
          <p>
            Выберите схемы для ангаров, оцените загрузку за период или в конкретный момент и подготовьте размещение
            событий. {activeSandbox ? <>Активна песочница <b>{activeSandbox.name}</b>.</> : <>Рабочий контур.</>}
          </p>
        </div>
        <div className="hangarHeroStats">
          <span>Событий: <b>{summary?.summary.events ?? 0}</b></span>
          <span>Без выбранной схемы/места: <b>{summary?.summary.unplaced ?? 0}</b></span>
          <span>Не подходят по типу: <b>{summary?.summary.incompatible ?? 0}</b></span>
        </div>
      </section>

      <section className="hangarControls">
        <label className="refLabel">
          <span>Режим</span>
          <select className="refInput" value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)}>
            <option value="range">Диапазон</option>
            <option value="moment">Момент времени</option>
          </select>
        </label>
        <label className="refLabel">
          <span>С</span>
          <input className="refInput" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="refLabel">
          <span>По</span>
          <input className="refInput" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <div className="hangarPresetRow">
          {[
            ["сутки", 1],
            ["неделя", 7],
            ["месяц", 30],
            ["квартал", 90],
            ["год", 365]
          ].map(([label, days]) => (
            <button
              key={String(label)}
              className="btn btnSmall"
              type="button"
              onClick={() => {
                const start = dayjs();
                setFromDate(start.format("YYYY-MM-DD"));
                setToDate(start.add(Number(days) - 1, "day").format("YYYY-MM-DD"));
                setMinuteOffset(12 * 60);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn" type="button" onClick={() => autoFitM.mutate()} disabled={!summary || autoFitM.isPending}>
          {autoFitM.isPending ? "Подбор…" : "Подобрать схемы"}
        </button>
        <button
          className="btn"
          type="button"
          onClick={exportEfficiencyXlsx}
          disabled={efficiencyReport.pivotRows.length === 0}
          title="Выгрузить детальный расчёт эффективности использования ангаров в Excel"
        >
          Эффективность XLSX
        </button>
        <button className="btn btnPrimary" type="button" onClick={applyDraft} disabled={draftCount === 0 || reserveM.isPending}>
          Применить draft ({draftCount})
        </button>
        <button className="btn" type="button" onClick={() => { setDraft(new Map()); setFitResult(null); setSuggestResult(null); }} disabled={draftCount === 0}>
          Очистить draft
        </button>
      </section>

      {viewMode === "moment" ? (
        <section className="hangarSliderCard">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{at.format("DD.MM.YYYY HH:mm")}</strong>
            <span className="muted">Шаг 30 минут: прибывают и выбывают самолёты на схеме</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, totalMinutes)}
            step={30}
            value={effectiveMinuteOffset}
            onChange={(e) => setMinuteOffset(Number(e.target.value))}
          />
        </section>
      ) : null}

      <ImportLayoutsPanel onDone={() => { void qc.invalidateQueries({ queryKey: ["ref"] }); void qc.invalidateQueries({ queryKey: ["hangar-planning"] }); }} />

      {notice ? <div className="contextNotice">{notice}</div> : null}
      {summaryQ.error ? <div className="errorMsg">{String((summaryQ.error as any)?.message ?? summaryQ.error)}</div> : null}
      {autoFitM.error ? <div className="errorMsg">{String((autoFitM.error as any)?.message ?? autoFitM.error)}</div> : null}
      {suggestM.error ? <div className="errorMsg">{String((suggestM.error as any)?.message ?? suggestM.error)}</div> : null}

      <div className="hangarWorkspace">
        <aside className="hangarSidePanel">
          <h3>События для размещения</h3>
          <div className="muted small">Перетащите событие на ангар или выберите его и нажмите «Разместить в ангар».</div>
          <div className="hangarEventList">
            {(summary?.unplaced ?? []).length === 0 ? <div className="muted">Нет неразмещённых событий.</div> : null}
            {(summary?.unplaced ?? []).map((event) => (
              <button
                key={event.id}
                className={selectedEventId === event.id ? "hangarEventItem active" : "hangarEventItem"}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", event.id);
                  e.dataTransfer.effectAllowed = "copy";
                  setSelectedEventId(event.id);
                }}
                onClick={() => setSelectedEventId(event.id)}
              >
                <b>{event.aircraftLabel}</b>
                <span>{event.title}</span>
                <small>{formatEventPeriod(event)} · {bodyTypeLabel(event.bodyType)}</small>
              </button>
            ))}
          </div>

          {suggestResult ? (
            <div className="hangarFitBox">
              <div className="hangarFitHead">
                <b>Варианты в ангаре</b>
                <span>{suggestResult.candidates.length}</span>
              </div>
              {suggestResult.event ? (
                <div className="muted small" style={{ marginBottom: 8 }}>
                  {suggestResult.event.aircraftLabel} · {suggestResult.event.title}
                </div>
              ) : null}
              {suggestResult.candidates.length === 0 ? (
                <div className="muted small">Подходящих свободных мест не найдено.</div>
              ) : (
                <div className="hangarFitList">
                  {suggestResult.candidates.map((candidate) => (
                    <button
                      key={`${candidate.layoutId}-${candidate.standId}`}
                      className="hangarFitItem"
                      type="button"
                      onClick={() => {
                        if (!suggestResult.event) return;
                        applyCandidateToDraft(suggestResult.event.id, candidate);
                      }}
                    >
                      <span>
                        <b>{candidate.standCode}</b> · {candidate.layoutName}
                      </span>
                      <small>{candidate.hangarName} · {candidate.layoutCode}</small>
                      <small>{candidate.reason}</small>
                    </button>
                  ))}
                </div>
              )}
              {suggestResult.blockedLayouts.length > 0 ? (
                <details className="hangarFitUnplaced">
                  <summary>Недоступные схемы периода: {suggestResult.blockedLayouts.length}</summary>
                  <div className="muted small">
                    В этот период в ангаре уже используется другая схема, поэтому переключение схемы требует отдельного перепланирования.
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          {fitResult ? (
            <div className="hangarFitBox">
              <div className="hangarFitHead">
                <b>Предложенные размещения</b>
                <span>{fitResult.summary.placed}/{fitResult.summary.candidates}</span>
              </div>
              {fitResult.placements.length === 0 ? (
                <div className="muted small">Подходящих свободных мест не найдено.</div>
              ) : (
                <div className="hangarFitList">
                  {fitResult.placements.map((p) => (
                    <button
                      key={p.event.id}
                      className="hangarFitItem"
                      type="button"
                      onClick={() => {
                        setSelectedEventId(p.event.id);
                        setExpandedHangarId(p.hangarId);
                      }}
                      title="Открыть ангар с предложенным местом"
                    >
                      <span>
                        <b>{p.event.aircraftLabel}</b> · {p.event.title}
                      </span>
                      <small>
                        {p.hangarName} · {p.layoutName} · место {p.standCode}
                      </small>
                      <small>{formatEventPeriod(p.event)} · {bodyTypeLabel(p.event.bodyType)}</small>
                    </button>
                  ))}
                </div>
              )}
              {fitResult.unplaced.length > 0 ? (
                <details className="hangarFitUnplaced">
                  <summary>Не размещено: {fitResult.unplaced.length}</summary>
                  <div className="hangarFitList">
                    {fitResult.unplaced.map((x) => (
                      <div key={x.event.id} className="hangarFitMiss">
                        <b>{x.event.aircraftLabel} · {x.event.title}</b>
                        <small>{x.reason}</small>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </aside>

        <main className="hangarMainPanel">
          {expanded ? (
            <>
              <button className="btn" type="button" onClick={() => setExpandedHangarId(null)}>Назад к карточкам</button>
              {renderHangarCard(expanded, true)}
            </>
          ) : (
            <div className="hangarCardsGrid">
              {(summary?.hangars ?? []).map((h) => (
                <div key={h.hangar.id} onDoubleClick={() => setExpandedHangarId(h.hangar.id)}>
                  {renderHangarCard(h, false)}
                </div>
              ))}
            </div>
          )}

          {!summaryQ.isLoading && (summary?.hangars ?? []).length === 0 ? (
            <div className="sandboxesEmpty">Нет активных схем. Добавьте или импортируйте реальные варианты расстановок.</div>
          ) : null}
          {summaryQ.isLoading ? <div className="muted">Загрузка аналитики ангаров…</div> : null}
        </main>
      </div>
    </div>
  );
}
