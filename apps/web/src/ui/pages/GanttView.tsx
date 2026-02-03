import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import { EventResourcesPanel } from "../components/EventResourcesPanel";

dayjs.extend(utc);

const GANTT_UI_LS_KEY = "hangarPlanning:ganttUi:v1";

function safeReadGanttUi(): any | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(GANTT_UI_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeWriteGanttUi(v: any) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GANTT_UI_LS_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

type EventRow = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  level: "STRATEGIC" | "OPERATIONAL";
  status: string;
  aircraft: { id?: string; tailNumber: string };
  eventType: { id?: string; name: string; color?: string | null };
  hangar?: { id?: string; name: string } | null;
  layout?: { id?: string; name: string; hangarId?: string } | null;
  reservation?: { stand?: { id?: string; code: string } | null } | null;
};

type Aircraft = { id: string; tailNumber: string };
type AircraftTypeRef = { id: string; icaoType?: string | null; name: string };
type EventType = { id: string; code: string; name: string; color?: string | null };
type Hangar = { id: string; name: string };
type Layout = { id: string; name: string; hangarId: string; code?: string };
type Stand = { id: string; code: string; name: string };

type GroupMode = "AIRCRAFT" | "HANGAR_STAND";

type EditorDraft = {
  id?: string;
  title: string;
  level: "STRATEGIC" | "OPERATIONAL";
  status: "DRAFT" | "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  aircraftId: string;
  eventTypeId: string;
  startAtLocal: string; // YYYY-MM-DDTHH:mm
  endAtLocal: string; // YYYY-MM-DDTHH:mm
  notes: string;
  hangarId: string; // optional, "" means null
  layoutId: string; // optional, "" means null
  standId: string; // optional, "" means no reservation
};

type EventAudit = {
  id: string;
  eventId: string;
  action: "CREATE" | "UPDATE" | "RESERVE" | "UNRESERVE";
  actor: string;
  reason?: string | null;
  changes?: any;
  createdAt: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatRowLabel(ev: EventRow) {
  const bits = [ev.eventType?.name];
  if (ev.hangar?.name) bits.push(ev.hangar.name);
  if (ev.reservation?.stand?.code) bits.push(ev.reservation.stand.code);
  return bits.filter(Boolean).join(" • ");
}

function isValidDateInput(v: string) {
  // Для <input type="date"> значение либо "" (в процессе ввода), либо "YYYY-MM-DD"
  if (!v) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = dayjs.utc(v);
  return d.isValid();
}

function barVisualStyle(status: string, baseColor: string) {
  // Статусы:
  // DRAFT / PLANNED => штриховка под цветом события
  // CANCELLED => серая заливка
  // CONFIRMED / IN_PROGRESS => как сейчас (сплошная)
  // DONE => зелёная граница
  if (status === "CANCELLED") {
    return {
      background: "rgba(148, 163, 184, 0.85)",
      border: "1px solid rgba(100, 116, 139, 0.9)"
    } as const;
  }

  if (status === "DRAFT" || status === "PLANNED") {
    return {
      backgroundColor: baseColor,
      backgroundImage:
        "repeating-linear-gradient(135deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0.35) 6px, rgba(255,255,255,0) 6px, rgba(255,255,255,0) 12px)",
      border: "1px solid rgba(15, 23, 42, 0.18)"
    } as const;
  }

  if (status === "DONE") {
    return {
      background: baseColor,
      border: "2px solid rgba(34, 197, 94, 0.95)"
    } as const;
  }

  // CONFIRMED / IN_PROGRESS (и прочие) — обычная заливка
  return {
    background: baseColor,
    border: "1px solid rgba(15, 23, 42, 0.12)"
  } as const;
}

function TodayLine(props: { from: dayjs.Dayjs; to: dayjs.Dayjs; canvasWidth: number }) {
  const today = dayjs.utc().startOf("day");
  if (today.valueOf() < props.from.valueOf() || today.valueOf() >= props.to.valueOf()) return null;
  const totalDays = Math.max(1, props.to.diff(props.from, "day"));
  const x = (today.diff(props.from, "day") / totalDays) * props.canvasWidth;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: x,
        width: 2,
        background: "rgba(220, 38, 38, 0.35)",
        zIndex: 5,
        pointerEvents: "none"
      }}
      title="Сегодня"
    />
  );
}

function Drawer(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div
      className="drawerBackdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="drawer">
        <div className="row" style={{ marginBottom: 12 }}>
          <strong>{props.title}</strong>
          <span style={{ flex: "1 1 auto" }} />
          <button className="btn" onClick={props.onClose}>
            Закрыть
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function GanttView() {
  const qc = useQueryClient();
  const initialFrom = useMemo(() => dayjs().add(-10, "day").format("YYYY-MM-DD"), []);
  const initialTo = useMemo(() => dayjs().add(50, "day").format("YYYY-MM-DD"), []);
  const savedUi = useMemo(() => safeReadGanttUi(), []);

  // input* — то, что пользователь вводит (может быть временно невалидным)
  // applied* — последнее валидное значение, которое используется в вычислениях/запросах
  const [rangeFromApplied, setRangeFromApplied] = useState<string>(() => String(savedUi?.rangeFromApplied ?? initialFrom));
  const [rangeToApplied, setRangeToApplied] = useState<string>(() => String(savedUi?.rangeToApplied ?? initialTo));
  const [rangeFromInput, setRangeFromInput] = useState<string>(() => String(savedUi?.rangeFromInput ?? savedUi?.rangeFromApplied ?? initialFrom));
  const [rangeToInput, setRangeToInput] = useState<string>(() => String(savedUi?.rangeToInput ?? savedUi?.rangeToApplied ?? initialTo));
  const [rangeError, setRangeError] = useState<string | null>(null);

  const from = useMemo(() => dayjs.utc(rangeFromApplied).startOf("day"), [rangeFromApplied]);
  // полузакрытый интервал [from, to)
  const to = useMemo(() => dayjs.utc(rangeToApplied).add(1, "day").startOf("day"), [rangeToApplied]);
  const days = useMemo(() => {
    const d = to.diff(from, "day");
    if (!Number.isFinite(d) || d <= 0) return 1;
    return d;
  }, [from, to]);

  const [groupMode, setGroupMode] = useState<GroupMode>(() => (savedUi?.groupMode === "HANGAR_STAND" ? "HANGAR_STAND" : "AIRCRAFT"));

  const [filterAircraftTypeId, setFilterAircraftTypeId] = useState<string>(() => String(savedUi?.filterAircraftTypeId ?? ""));
  const [filterAircraftId, setFilterAircraftId] = useState<string>(() => String(savedUi?.filterAircraftId ?? ""));

  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftTypeRef[]>("/api/ref/aircraft-types")
  });

  const q = useQuery({
    queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId],
    queryFn: () =>
      apiGet<EventRow[]>(
        `/api/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${
          filterAircraftTypeId ? `&aircraftTypeId=${encodeURIComponent(filterAircraftTypeId)}` : ""
        }${filterAircraftId ? `&aircraftId=${encodeURIComponent(filterAircraftId)}` : ""}`
      ),
    // чтобы полосы не "пропадали" на время refetch при больших диапазонах
    placeholderData: (prev) => prev ?? []
  });

  const aircraftQ = useQuery({
    queryKey: ["ref", "aircraft"],
    queryFn: () => apiGet<Aircraft[]>("/api/ref/aircraft")
  });

  const eventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<EventType[]>("/api/ref/event-types")
  });

  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Hangar[]>("/api/ref/hangars")
  });

  // В режиме HANGAR_STAND: либо все ангары, либо один выбранный.
  // Важно: строки не строим заранее — только по событиям в диапазоне (без "пустых" строк).
  const [selectedHangarId, setSelectedHangarId] = useState<string>(() => String(savedUi?.selectedHangarId ?? "ALL"));

  useEffect(() => {
    safeWriteGanttUi({
      rangeFromApplied,
      rangeToApplied,
      rangeFromInput,
      rangeToInput,
      groupMode,
      selectedHangarId,
      filterAircraftTypeId,
      filterAircraftId
    });
  }, [
    rangeFromApplied,
    rangeToApplied,
    rangeFromInput,
    rangeToInput,
    groupMode,
    selectedHangarId,
    filterAircraftTypeId,
    filterAircraftId
  ]);

  const events = q.data ?? [];
  const dayWidth = 24; // px per day
  const canvasWidth = days * dayWidth;

  // редактор
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [original, setOriginal] = useState<EditorDraft | null>(null);

  // подтверждение изменения
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState<"event" | "reserve" | null>(null);
  const [changeReason, setChangeReason] = useState("");

  const openEditorForNew = () => {
    const defaultAircraft = aircraftQ.data?.[0]?.id ?? "";
    const defaultEventType = eventTypesQ.data?.[0]?.id ?? "";
    const d: EditorDraft = {
      title: "ТО",
      level: "OPERATIONAL",
      status: "PLANNED",
      aircraftId: defaultAircraft,
      eventTypeId: defaultEventType,
      startAtLocal: dayjs().add(1, "day").hour(9).minute(0).second(0).format("YYYY-MM-DDTHH:mm"),
      endAtLocal: dayjs().add(3, "day").hour(18).minute(0).second(0).format("YYYY-MM-DDTHH:mm"),
      notes: "",
      hangarId: "",
      layoutId: "",
      standId: ""
    };
    setDraft(d);
    setOriginal(d);
    setChangeReason("");
    setEditorOpen(true);
  };

  const openEditorForExisting = (ev: EventRow) => {
    const startAtLocal = dayjs(ev.startAt).format("YYYY-MM-DDTHH:mm");
    const endAtLocal = dayjs(ev.endAt).format("YYYY-MM-DDTHH:mm");
    const d: EditorDraft = {
      id: ev.id,
      title: ev.title,
      level: ev.level,
      status: (ev.status as any) ?? "PLANNED",
      aircraftId: (ev.aircraft as any)?.id ?? "",
      eventTypeId: (ev.eventType as any)?.id ?? (ev as any)?.eventTypeId ?? "",
      startAtLocal,
      endAtLocal,
      notes: (ev as any)?.notes ?? "",
      hangarId: (ev.hangar as any)?.id ?? "",
      layoutId: (ev.layout as any)?.id ?? "",
      standId: (ev.reservation?.stand as any)?.id ?? ""
    };
    setDraft(d);
    setOriginal(d);
    setChangeReason("");
    setEditorOpen(true);
  };

  const layoutsForEditorQ = useQuery({
    queryKey: ["ref", "layouts", "editor", draft?.hangarId ?? ""],
    queryFn: () => apiGet<Layout[]>(`/api/ref/layouts?hangarId=${encodeURIComponent(draft!.hangarId)}`),
    enabled: !!draft?.hangarId
  });

  const standsForEditorQ = useQuery({
    queryKey: ["ref", "stands", "editor", draft?.layoutId ?? ""],
    queryFn: () => apiGet<Stand[]>(`/api/ref/stands?layoutId=${encodeURIComponent(draft!.layoutId)}`),
    enabled: !!draft?.layoutId
  });

  const historyQ = useQuery({
    queryKey: ["event-history", draft?.id ?? ""],
    queryFn: () => apiGet<EventAudit[]>(`/api/events/${draft!.id}/history`),
    enabled: !!draft?.id && editorOpen
  });

  const computeDraftDiff = (a: EditorDraft | null, b: EditorDraft | null) => {
    if (!a || !b) return [];
    const keys: Array<keyof EditorDraft> = [
      "title",
      "level",
      "status",
      "aircraftId",
      "eventTypeId",
      "startAtLocal",
      "endAtLocal",
      "notes",
      "hangarId",
      "layoutId",
      "standId"
    ];
    return keys
      .filter((k) => (a[k] ?? "") !== (b[k] ?? ""))
      .map((k) => ({ field: String(k), from: a[k] ?? "", to: b[k] ?? "" }));
  };

  const requestSaveWithReason = (what: "event" | "reserve") => {
    const diffs = computeDraftDiff(original, draft);
    const meaningfulDiffs =
      what === "reserve" ? diffs.filter((d) => ["hangarId", "layoutId", "standId"].includes(d.field)) : diffs;
    if (meaningfulDiffs.length === 0) {
      // нечего сохранять
      return;
    }
    setPendingSave(what);
    setConfirmOpen(true);
  };

  const saveEventM = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Нет данных формы");
      if (!draft.aircraftId || !draft.eventTypeId) throw new Error("Заполните борт и тип события");
      const startAt = dayjs(draft.startAtLocal).second(0).millisecond(0).toISOString();
      const endAt = dayjs(draft.endAtLocal).second(0).millisecond(0).toISOString();
      if (dayjs(endAt).valueOf() <= dayjs(startAt).valueOf()) throw new Error("Дата окончания должна быть позже начала");

      const payload = {
        level: draft.level,
        status: draft.status,
        title: draft.title,
        aircraftId: draft.aircraftId,
        eventTypeId: draft.eventTypeId,
        startAt,
        endAt,
        hangarId: draft.hangarId || null,
        layoutId: draft.layoutId || null,
        notes: draft.notes?.trim() ? draft.notes : null,
        changeReason: changeReason.trim()
      };

      if (!draft.id) {
        const created = await apiPost<EventRow>("/api/events", payload);
        return created;
      }
      const updated = await apiPatch<EventRow>(`/api/events/${draft.id}`, payload);
      return updated;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      setOriginal(draft);
      setConfirmOpen(false);
      setPendingSave(null);
      setChangeReason("");
    }
  });

  const reserveM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Сначала сохраните событие");
      if (!draft.layoutId || !draft.standId) throw new Error("Выберите вариант и место");
      return await apiPut(`/api/reservations/by-event/${draft.id}`, {
        layoutId: draft.layoutId,
        standId: draft.standId,
        changeReason: changeReason.trim()
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      await qc.invalidateQueries({ queryKey: ["event-history", draft?.id ?? ""] });
      setOriginal(draft);
      setConfirmOpen(false);
      setPendingSave(null);
      setChangeReason("");
    }
  });

  const unreserveM = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error("Нет события");
      return await apiDelete(`/api/reservations/by-event/${draft.id}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["events", from.toISOString(), to.toISOString(), filterAircraftTypeId, filterAircraftId] });
      await qc.invalidateQueries({ queryKey: ["event-history", draft?.id ?? ""] });
      setDraft((d) => (d ? { ...d, standId: "" } : d));
      setOriginal((o) => (o ? { ...o, standId: "" } : o));
    }
  });

  const legendBase = "#2563eb";
  const legendDraft = barVisualStyle("DRAFT", legendBase);
  const legendCancelled = barVisualStyle("CANCELLED", legendBase);
  const legendActive = barVisualStyle("IN_PROGRESS", legendBase);
  const legendDone = barVisualStyle("DONE", legendBase);

  // В режиме "Ангар/Место" строки строим ТОЛЬКО по фактическим событиям:
  // - "Без ангара/места" (если есть такие события)
  // - "<Ангар> / Без места" (если есть события с ангаром, но без резерва)
  // - "<Ангар> / <код места>" (если есть резервы на этом месте)
  const hangarStandRows = useMemo(() => {
    if (groupMode !== "HANGAR_STAND") return [];

    const getHangarId = (e: EventRow) => (e.hangar as any)?.id ?? (e.layout as any)?.hangarId ?? "";
    const getHangarName = (e: EventRow) => (e.hangar as any)?.name ?? "Ангар";
    const getStandId = (e: EventRow) => (e.reservation?.stand as any)?.id ?? "";
    const getStandCode = (e: EventRow) => (e.reservation?.stand as any)?.code ?? "";

    const inSelected = (e: EventRow) => {
      if (selectedHangarId === "ALL") return true;
      const hid = getHangarId(e);
      const isUnassigned = !hid && !e.reservation?.stand;
      return hid === selectedHangarId || isUnassigned;
    };

    const visible = events.filter(inSelected);

    const unassigned = visible.filter((e) => !getHangarId(e) && !e.reservation?.stand);

    const noStandByHangar = new Map<string, { hangarName: string; events: EventRow[] }>();
    const byStand = new Map<string, { label: string; events: EventRow[] }>();

    for (const e of visible) {
      const hid = getHangarId(e);
      const hname = getHangarName(e);

      if (hid && !e.reservation?.stand) {
        const key = hid;
        const rec = noStandByHangar.get(key) ?? { hangarName: hname, events: [] as EventRow[] };
        rec.events.push(e);
        noStandByHangar.set(key, rec);
        continue;
      }

      const sid = getStandId(e);
      const scode = getStandCode(e);
      if (hid && sid) {
        const key = `${hid}|${sid}`;
        const rec = byStand.get(key) ?? { label: `${hname} / ${scode}`, events: [] as EventRow[] };
        rec.events.push(e);
        byStand.set(key, rec);
      }
    }

    const rows: Array<{ key: string; label: string; events: EventRow[] }> = [];

    if (unassigned.length > 0) {
      rows.push({ key: "unassigned", label: "Без ангара/места", events: unassigned });
    }

    // Стабильная сортировка: по имени ангара, затем по коду места
    const hangarList = Array.from(noStandByHangar.entries())
      .map(([hid, v]) => ({ hid, hangarName: v.hangarName, events: v.events }))
      .sort((a, b) => a.hangarName.localeCompare(b.hangarName, "ru"));

    for (const h of hangarList) {
      rows.push({ key: `hangar:${h.hid}:no-stand`, label: `${h.hangarName} / Без места`, events: h.events });
    }

    const standList = Array.from(byStand.entries())
      .map(([key, v]) => ({ key, label: v.label, events: v.events }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    for (const s of standList) {
      rows.push({ key: `stand:${s.key}`, label: s.label, events: s.events });
    }

    return rows;
  }, [groupMode, selectedHangarId, events]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="row">
          <strong>План (диаграмма Гантта)</strong>
          <span className="muted">
            Период: {dayjs.utc(rangeFromApplied).format("DD.MM.YYYY")} – {dayjs.utc(rangeToApplied).format("DD.MM.YYYY")}
          </span>
          <span style={{ flex: "1 1 auto" }} />
          <button className="btn btnPrimary" onClick={openEditorForNew}>
            Создать событие
          </button>
        </div>

        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="row">
            <span className="muted">группировка</span>
            <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)}>
              <option value="AIRCRAFT">Борт / событие</option>
              <option value="HANGAR_STAND">Ангар / место</option>
            </select>
          </label>

          {groupMode === "HANGAR_STAND" ? (
            <label className="row">
              <span className="muted">ангар</span>
              <select value={selectedHangarId} onChange={(e) => setSelectedHangarId(e.target.value)}>
                <option value="ALL">все</option>
                {(hangarsQ.data ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="row">
            <span className="muted">тип ВС</span>
            <select
              value={filterAircraftTypeId}
              onChange={(e) => {
                setFilterAircraftTypeId(e.target.value);
                setFilterAircraftId("");
              }}
              style={{ minWidth: 240 }}
            >
              <option value="">все</option>
              {(aircraftTypesQ.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.icaoType ? `${t.icaoType} • ${t.name}` : t.name}
                </option>
              ))}
            </select>
          </label>

          <label className="row">
            <span className="muted">борт</span>
            <select value={filterAircraftId} onChange={(e) => setFilterAircraftId(e.target.value)} style={{ minWidth: 190 }}>
              <option value="">все</option>
              {(aircraftQ.data ?? [])
                .filter((a: any) => (!filterAircraftTypeId ? true : String(a.typeId ?? "") === filterAircraftTypeId))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.tailNumber}
                  </option>
                ))}
            </select>
          </label>

          <label className="row">
            <span className="muted">c</span>
            <input
              type="date"
              value={rangeFromInput}
              onChange={(e) => {
                const v = e.target.value;
                setRangeFromInput(v);
                if (!isValidDateInput(v)) return;
                if (dayjs(v).isAfter(dayjs(rangeToApplied))) {
                  setRangeToInput(v);
                  setRangeToApplied(v);
                }
                setRangeFromApplied(v);
                setRangeError(null);
              }}
              style={{ width: 180 }}
            />
          </label>

          <label className="row">
            <span className="muted">по</span>
            <input
              type="date"
              value={rangeToInput}
              onChange={(e) => {
                const v = e.target.value;
                setRangeToInput(v);
                if (!isValidDateInput(v)) return;
                if (dayjs(v).isBefore(dayjs(rangeFromApplied))) {
                  setRangeFromInput(v);
                  setRangeFromApplied(v);
                }
                setRangeToApplied(v);
                setRangeError(null);
              }}
              style={{ width: 180 }}
            />
          </label>
        </div>

        {rangeError ? (
          <div className="error" style={{ marginTop: 2 }}>
            {rangeError}
          </div>
        ) : null}
        {q.isFetching ? (
          <div className="muted" style={{ marginTop: 2 }}>
            Загрузка…
          </div>
        ) : null}
        {q.error ? (
          <div className="error" style={{ marginTop: 2 }}>
            {String(q.error.message || q.error)}
          </div>
        ) : null}

        <div className="row" style={{ gap: 14 }}>
          <span className="muted">Легенда:</span>
          <span className="row">
            <span className="legendDot" style={{ background: "#2563eb" }} />
            цвет — тип события
          </span>
          <span className="row">
            <span className="legendBar" style={{ ...legendDraft }} />
            черновик/запланировано
          </span>
          <span className="row">
            <span className="legendBar" style={{ ...legendActive }} />
            подтверждено/в работе
          </span>
          <span className="row">
            <span className="legendBar" style={{ ...legendDone }} />
            завершено
          </span>
          <span className="row">
            <span className="legendBar" style={{ ...legendCancelled }} />
            отменено
          </span>
          <span className="row">
            <span className="legendBar" style={{ background: "rgba(220, 38, 38, 0.35)", borderRadius: 2, width: 10 }} />
            сегодня
          </span>
        </div>
      </div>

      <div className="ganttGrid">
        <div className="ganttRow ganttHeader">
          <div className="ganttLabel">
            <strong>{groupMode === "AIRCRAFT" ? "Борт / событие" : "Ангар / место"}</strong>
          </div>
          <div
            className="ganttCanvas"
            style={{ width: canvasWidth, height: 44 }}
          >
            <TodayLine from={from} to={to} canvasWidth={canvasWidth} />
            {/* простая шкала по дням */}
            <div style={{ position: "absolute", inset: 0, display: "flex" }}>
              {Array.from({ length: days }).map((_, i) => {
                const d = from.add(i, "day");
                const isMonthStart = d.date() === 1;
                const showYear = i === 0 || isMonthStart;
                return (
                  <div
                    key={i}
                    style={{
                      width: dayWidth,
                      borderRight: "1px solid rgba(148,163,184,0.18)",
                      background: isMonthStart ? "rgba(37,99,235,0.06)" : "transparent",
                      padding: "2px 4px"
                    }}
                    title={d.format("DD.MM.YYYY")}
                  >
                    <div className="ganttDayCell">
                      <div className="ganttDayYear">{showYear ? d.format("YYYY") : ""}</div>
                      <div className="ganttDayMonth">{isMonthStart ? d.format("MMM") : ""}</div>
                      <div className="ganttDayNum">{d.format("D")}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {groupMode === "AIRCRAFT"
          ? events.map((ev) => {
              const s = dayjs.utc(ev.startAt);
              const e = dayjs.utc(ev.endAt);
              const leftDays = s.diff(from, "day", true);
              const rightDays = e.diff(from, "day", true);
              const left = leftDays * dayWidth;
              const right = rightDays * dayWidth;
              const x = clamp(left, 0, canvasWidth);
              const w = clamp(right - left, 6, canvasWidth - x);
              const color = ev.eventType?.color || (ev.level === "STRATEGIC" ? "#6b7280" : "#2563eb");
              const visual = barVisualStyle(ev.status, color);

              return (
                <div className="ganttRow" key={ev.id}>
                  <div className="ganttLabel">
                    <div>
                      <strong>{ev.aircraft.tailNumber}</strong> <span className="muted">({ev.level})</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {formatRowLabel(ev) || ev.title}
                    </div>
                  </div>
                  <div
                    className="ganttCanvas"
                    style={{ width: canvasWidth }}
                  >
                    <TodayLine from={from} to={to} canvasWidth={canvasWidth} />
                    <div
                      className="bar"
                      style={{
                        left: x,
                        width: w,
                        cursor: "pointer",
                        ...visual
                      }}
                      onClick={() => openEditorForExisting(ev)}
                      title={`${ev.title}\n${dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")} – ${dayjs(ev.endAt).format(
                        "DD.MM.YYYY HH:mm"
                      )}\nНажмите, чтобы редактировать`}
                    >
                      {ev.title}
                    </div>
                  </div>
                </div>
              );
            })
          : hangarStandRows.map((r) => {
              return (
                <div className="ganttRow" key={r.key}>
                  <div className="ganttLabel">
                    <div>
                      <strong>{r.label}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }} />
                  </div>
                  <div
                    className="ganttCanvas"
                    style={{ width: canvasWidth }}
                  >
                    <TodayLine from={from} to={to} canvasWidth={canvasWidth} />
                    {r.events.map((ev) => {
                      const s = dayjs.utc(ev.startAt);
                      const e = dayjs.utc(ev.endAt);
                      const leftDays = s.diff(from, "day", true);
                      const rightDays = e.diff(from, "day", true);
                      const left = leftDays * dayWidth;
                      const right = rightDays * dayWidth;
                      const x = clamp(left, 0, canvasWidth);
                      const w = clamp(right - left, 6, canvasWidth - x);
                      const color = ev.eventType?.color || (ev.level === "STRATEGIC" ? "#6b7280" : "#2563eb");
                      const visual = barVisualStyle(ev.status, color);
                      return (
                        <div
                          key={ev.id}
                          className="bar"
                          style={{
                            left: x,
                            width: w,
                            cursor: "pointer",
                            ...visual
                          }}
                          onClick={() => openEditorForExisting(ev)}
                          title={`${ev.aircraft.tailNumber} • ${ev.title}\n${dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")} – ${dayjs(
                            ev.endAt
                          ).format("DD.MM.YYYY HH:mm")}\nНажмите, чтобы редактировать`}
                        >
                          {ev.aircraft.tailNumber} • {ev.title}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

        {q.isLoading ? (
          <div style={{ padding: 16 }} className="muted">
            Загрузка…
          </div>
        ) : null}
        {!q.isLoading && events.length === 0 ? (
          <div style={{ padding: 16 }} className="muted">
            Нет событий в выбранном диапазоне.
          </div>
        ) : null}
      </div>

      <Drawer
        open={editorOpen}
        title={draft?.id ? "Редактирование события" : "Новое событие"}
        onClose={() => setEditorOpen(false)}
      >
        {!draft ? (
          <div className="muted">Нет данных формы.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Название</span>
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Уровень</span>
                <select value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value as any })}>
                  <option value="OPERATIONAL">Оперативный</option>
                  <option value="STRATEGIC">Стратегический</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Статус</span>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as any })}>
                  <option value="DRAFT">Черновик</option>
                  <option value="PLANNED">Запланировано</option>
                  <option value="CONFIRMED">Подтверждено</option>
                  <option value="IN_PROGRESS">В работе</option>
                  <option value="DONE">Завершено</option>
                  <option value="CANCELLED">Отменено</option>
                </select>
              </label>
            </div>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                <span className="muted">Борт</span>
                <select value={draft.aircraftId} onChange={(e) => setDraft({ ...draft, aircraftId: e.target.value })}>
                  <option value="">— выберите —</option>
                  {(aircraftQ.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tailNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                <span className="muted">Тип события</span>
                <select value={draft.eventTypeId} onChange={(e) => setDraft({ ...draft, eventTypeId: e.target.value })}>
                  <option value="">— выберите —</option>
                  {(eventTypesQ.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Начало (дата+время)</span>
                <input
                  type="datetime-local"
                  value={draft.startAtLocal}
                  onChange={(e) => setDraft({ ...draft, startAtLocal: e.target.value })}
                  style={{ width: 220 }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="muted">Окончание (дата+время)</span>
                <input
                  type="datetime-local"
                  value={draft.endAtLocal}
                  onChange={(e) => setDraft({ ...draft, endAtLocal: e.target.value })}
                  style={{ width: 220 }}
                />
              </label>
            </div>

            <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <strong>Ангар / место</strong>
                <span className="muted">Резервирование места делается отдельно (после сохранения события).</span>
              </div>

              <div className="row" style={{ alignItems: "flex-end" }}>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Ангар</span>
                  <select
                    value={draft.hangarId}
                    onChange={(e) => setDraft({ ...draft, hangarId: e.target.value, layoutId: "", standId: "" })}
                  >
                    <option value="">— не задан —</option>
                    {(hangarsQ.data ?? []).map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Вариант</span>
                  <select
                    value={draft.layoutId}
                    onChange={(e) => setDraft({ ...draft, layoutId: e.target.value, standId: "" })}
                    disabled={!draft.hangarId}
                  >
                    <option value="">— не задан —</option>
                    {(layoutsForEditorQ.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="row" style={{ alignItems: "flex-end", marginTop: 8 }}>
                <label style={{ display: "grid", gap: 6, flex: "1 1 auto" }}>
                  <span className="muted">Место</span>
                  <select
                    value={draft.standId}
                    onChange={(e) => setDraft({ ...draft, standId: e.target.value })}
                    disabled={!draft.layoutId}
                  >
                    <option value="">— не выбрано —</option>
                    {(standsForEditorQ.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} • {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn"
                  onClick={() => unreserveM.mutate()}
                  disabled={!draft.id || !draft.standId || unreserveM.isPending}
                >
                  Снять резерв
                </button>
                <button
                  className="btn btnPrimary"
                  onClick={() => requestSaveWithReason("reserve")}
                  disabled={!draft.id || reserveM.isPending}
                >
                  Назначить место
                </button>
              </div>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="muted">Примечание</span>
              <textarea
                rows={4}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>

            <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
              {!draft.id ? (
                <div className="muted">Сначала сохраните событие — затем можно планировать ресурсы и вносить факт.</div>
              ) : (
                <EventResourcesPanel eventId={draft.id} />
              )}
            </div>

            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn btnPrimary" onClick={() => requestSaveWithReason("event")} disabled={saveEventM.isPending}>
                Сохранить событие
              </button>
              {saveEventM.error || reserveM.error || unreserveM.error ? (
                <span className="error">
                  {String((saveEventM.error ?? reserveM.error ?? unreserveM.error)?.message ?? "")}
                </span>
              ) : null}
              {saveEventM.isSuccess ? <span className="muted">Сохранено.</span> : null}
            </div>

            <div style={{ borderTop: "1px solid rgba(148,163,184,0.35)", paddingTop: 10 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <strong>История изменений</strong>
                {historyQ.isFetching ? <span className="muted">обновление…</span> : null}
              </div>
              {historyQ.error ? <div className="error">{String(historyQ.error.message || historyQ.error)}</div> : null}
              {(historyQ.data ?? []).length === 0 ? <div className="muted">История пока пустая.</div> : null}
              <div style={{ display: "grid", gap: 8 }}>
                {(historyQ.data ?? []).map((h) => (
                  <div key={h.id} style={{ border: "1px solid rgba(148,163,184,0.35)", borderRadius: 12, padding: 10 }}>
                    <div className="row">
                      <strong>{h.action}</strong>
                      <span className="muted">{dayjs(h.createdAt).format("DD.MM.YYYY HH:mm")}</span>
                      <span className="muted">• {h.actor}</span>
                    </div>
                    {h.reason ? <div style={{ marginTop: 6 }}><strong>Причина:</strong> {h.reason}</div> : null}
                    {h.changes ? (
                      <div className="muted" style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {JSON.stringify(h.changes)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={confirmOpen}
        title="Подтверждение изменения"
        onClose={() => setConfirmOpen(false)}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div className="muted">Перед сохранением опишите, что изменилось и почему (перенос, причина, комментарий).</div>
          <textarea rows={4} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
          <div>
            <strong>Изменения:</strong>
            <div className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, marginTop: 6 }}>
              {JSON.stringify(computeDraftDiff(original, draft))}
            </div>
          </div>
          <div className="row">
            <button
              className="btn btnPrimary"
              disabled={!changeReason.trim()}
              onClick={() => {
                if (pendingSave === "event") saveEventM.mutate();
                if (pendingSave === "reserve") reserveM.mutate();
              }}
            >
              Сохранить
            </button>
            <button className="btn" onClick={() => setConfirmOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

