import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet, apiPost } from "../../lib/api";

type Hangar = { id: string; name: string; code: string };
type Operator = { id: string; name: string; code: string };
type AircraftType = { id: string; name: string; icaoType?: string | null; bodyType?: string | null };
type EventType = { id: string; name: string; code: string };

type MassPreview = {
  ok: boolean;
  dryRun: true;
  placements: Array<{
    index: number;
    title: string;
    label: string;
    startAt: string;
    endAt: string;
    hangarId: string;
    layoutId: string;
    standId: string;
  }>;
  unplaced: Array<{ index: number; title: string; label: string }>;
  summary: { total: number; placed: number; unplaced: number };
};

type MassResult = {
  ok: boolean;
  dryRun: false;
  created: number;
  placed: number;
  unplaced: number;
  events: Array<{
    eventId: string;
    label: string;
    title: string;
    startAt: string;
    endAt: string;
    hangarId: string | null;
    layoutId: string | null;
    standId: string | null;
    status: string;
  }>;
};

export function MassPlanView() {
  const qc = useQueryClient();
  const [tatHours, setTatHours] = useState(72);
  const [operatorId, setOperatorId] = useState("");
  const [aircraftTypeId, setAircraftTypeId] = useState("");
  const [eventTypeId, setEventTypeId] = useState("");
  const [count, setCount] = useState(5);
  const [startFrom, setStartFrom] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [endTo, setEndTo] = useState(() => dayjs().add(30, "day").format("YYYY-MM-DD"));
  const [hangarPriority, setHangarPriority] = useState<string[]>([]);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [preview, setPreview] = useState<MassPreview | null>(null);
  const [result, setResult] = useState<MassResult | null>(null);

  const hangarsQ = useQuery({
    queryKey: ["ref", "hangars"],
    queryFn: () => apiGet<Hangar[]>("/api/ref/hangars")
  });
  const operatorsQ = useQuery({
    queryKey: ["ref", "operators"],
    queryFn: () => apiGet<Operator[]>("/api/ref/operators")
  });
  const aircraftTypesQ = useQuery({
    queryKey: ["ref", "aircraft-types"],
    queryFn: () => apiGet<AircraftType[]>("/api/ref/aircraft-types")
  });
  const eventTypesQ = useQuery({
    queryKey: ["ref", "event-types"],
    queryFn: () => apiGet<EventType[]>("/api/ref/event-types")
  });

  const buildBody = () => ({
    tatHours: Number(tatHours) || 72,
    operatorId,
    aircraftTypeId,
    eventTypeId,
    count: Math.max(1, Math.min(200, Number(count) || 1)),
    startFrom: dayjs(startFrom).startOf("day").toISOString(),
    endTo: dayjs(endTo).endOf("day").toISOString(),
    hangarIds: hangarPriority.length > 0 ? hangarPriority : undefined,
    titleTemplate: titleTemplate.trim() || undefined
  });

  const previewM = useMutation({
    mutationFn: (body: ReturnType<typeof buildBody>) =>
      apiPost<MassPreview>("/api/mass", { ...body, dryRun: true }),
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
    }
  });

  const applyM = useMutation({
    mutationFn: (body: ReturnType<typeof buildBody>) =>
      apiPost<MassResult>("/api/mass", { ...body, dryRun: false }),
    onSuccess: async (data) => {
      setResult(data);
      setPreview(null);
      await qc.invalidateQueries({ queryKey: ["events"] });
      await qc.invalidateQueries({ queryKey: ["reservations"] });
    }
  });

  const hangars = hangarsQ.data ?? [];
  const operators = operatorsQ.data ?? [];
  const aircraftTypes = aircraftTypesQ.data ?? [];
  const eventTypes = eventTypesQ.data ?? [];
  const hangarById = new Map(hangars.map((h) => [h.id, h]));
  const availableHangarIds = hangars.map((h) => h.id).filter((id) => !hangarPriority.includes(id));

  const handlePreview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorId || !aircraftTypeId || !eventTypeId) return;
    previewM.mutate(buildBody());
  };

  const handleApply = () => {
    if (!operatorId || !aircraftTypeId || !eventTypeId) return;
    applyM.mutate(buildBody());
  };

  const moveHangar = (index: number, dir: -1 | 1) => {
    const next = [...hangarPriority];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    setHangarPriority(next);
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div className="row">
          <strong>Массовое планирование</strong>
          <span className="muted">
            Борта виртуальные (появятся при закрытии события). Укажите период и параметры — сначала предпросмотр, затем перенос в план. Непоместившиеся в период создаются черновиком без ангара/места.
          </span>
        </div>

        <form onSubmit={handlePreview} style={{ display: "grid", gap: 14 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
            <label className="row" style={{ gap: 4 }}>
              <span className="muted">TAT одного события, ч</span>
              <input
                type="number"
                min={1}
                max={8760}
                value={tatHours}
                onChange={(e) => setTatHours(Number(e.target.value) || 72)}
                style={{ width: 100 }}
              />
            </label>
            <label className="row" style={{ gap: 4 }}>
              <span className="muted">Оператор</span>
              <select
                value={operatorId}
                onChange={(e) => { setOperatorId(e.target.value); setPreview(null); setResult(null); }}
                style={{ minWidth: 180 }}
                required
              >
                <option value="">— выберите —</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <label className="row" style={{ gap: 4 }}>
              <span className="muted">Тип ВС</span>
              <select
                value={aircraftTypeId}
                onChange={(e) => setAircraftTypeId(e.target.value)}
                style={{ minWidth: 180 }}
                required
              >
                <option value="">— выберите —</option>
                {aircraftTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.icaoType ? ` (${t.icaoType})` : ""}</option>
                ))}
              </select>
            </label>
            <label className="row" style={{ gap: 4 }}>
              <span className="muted">Вид события</span>
              <select
                value={eventTypeId}
                onChange={(e) => setEventTypeId(e.target.value)}
                style={{ minWidth: 160 }}
                required
              >
                <option value="">— выберите —</option>
                {eventTypes.map((et) => (
                  <option key={et.id} value={et.id}>{et.name}</option>
                ))}
              </select>
            </label>
            <label className="row" style={{ gap: 4 }}>
              <span className="muted">Количество</span>
              <input
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
                style={{ width: 80 }}
              />
            </label>
            <label className="row" style={{ gap: 4 }}>
              <span className="muted">Начало периода</span>
              <input
                type="date"
                value={startFrom}
                onChange={(e) => setStartFrom(e.target.value)}
                style={{ width: 140 }}
              />
            </label>
            <label className="row" style={{ gap: 4 }}>
              <span className="muted">Конец периода</span>
              <input
                type="date"
                value={endTo}
                onChange={(e) => setEndTo(e.target.value)}
                style={{ width: 140 }}
              />
            </label>
          </div>

          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <label className="row" style={{ gap: 4 }}>
              <span className="muted">Шаблон названия (опц., % = номер)</span>
              <input
                type="text"
                placeholder="Например: A-check %"
                value={titleTemplate}
                onChange={(e) => setTitleTemplate(e.target.value)}
                style={{ width: 220 }}
              />
            </label>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span className="muted">Приоритет ангаров (сверху вниз)</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {hangarPriority.map((id, index) => (
                <span key={id} className="row" style={{ alignItems: "center", gap: 4 }}>
                  <span style={{ fontWeight: 600 }}>{hangarById.get(id)?.name ?? id}</span>
                  <button type="button" className="btn" onClick={() => moveHangar(index, -1)} disabled={index === 0}>↑</button>
                  <button type="button" className="btn" onClick={() => moveHangar(index, 1)} disabled={index === hangarPriority.length - 1}>↓</button>
                  <button type="button" className="btn" onClick={() => setHangarPriority((p) => p.filter((x) => x !== id))}>✕</button>
                </span>
              ))}
              {availableHangarIds.length > 0 && (
                <select
                  value=""
                  onChange={(e) => { const v = e.target.value; if (v) setHangarPriority((p) => [...p, v]); }}
                  style={{ width: 180 }}
                >
                  <option value="">+ ангар</option>
                  {availableHangarIds.map((id) => (
                    <option key={id} value={id}>{hangarById.get(id)?.name ?? id}</option>
                  ))}
                </select>
              )}
            </div>
            {hangarPriority.length === 0 && <span className="muted">Если не задано — по имени ангара.</span>}
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button
              type="submit"
              className="btn"
              disabled={previewM.isPending || !operatorId || !aircraftTypeId || !eventTypeId}
            >
              {previewM.isPending ? "Загрузка…" : "Предпросмотр"}
            </button>
            {(previewM.error || applyM.error) && (
              <span className="error">{String((previewM.error as Error)?.message ?? (applyM.error as Error)?.message)}</span>
            )}
          </div>
        </form>
      </div>

      {preview?.ok && preview.dryRun && (
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <strong>Предпросмотр</strong>
          <p className="muted" style={{ margin: 0 }}>
            Размещено в период: {preview.summary.placed} из {preview.summary.total}.
            {preview.summary.unplaced > 0 && ` Не поместилось (будут созданы черновиком): ${preview.summary.unplaced}.`}
          </p>
          {preview.placements.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Вирт. борт</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Название</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Начало</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Окончание</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Ангар</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.placements.map((p) => (
                    <tr key={p.index}>
                      <td style={{ padding: "6px 8px" }}>{p.label}</td>
                      <td style={{ padding: "6px 8px" }}>{p.title}</td>
                      <td style={{ padding: "6px 8px" }}>{dayjs(p.startAt).format("DD.MM.YYYY HH:mm")}</td>
                      <td style={{ padding: "6px 8px" }}>{dayjs(p.endAt).format("DD.MM.YYYY HH:mm")}</td>
                      <td style={{ padding: "6px 8px" }}>{hangarById.get(p.hangarId)?.name ?? p.hangarId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.unplaced.length > 0 && (
            <div>
              <strong className="muted">Черновик (без места):</strong>{" "}
              {preview.unplaced.map((u) => u.label).join(", ")}
            </div>
          )}
          <div className="row">
            <button
              type="button"
              className="btn btnPrimary"
              disabled={applyM.isPending || !operatorId || !aircraftTypeId || !eventTypeId}
              onClick={handleApply}
            >
              {applyM.isPending ? "Создание…" : "Перенести в план"}
            </button>
          </div>
        </div>
      )}

      {result?.ok && !result.dryRun && result.events && result.events.length > 0 && (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <strong>Создано: {result.placed} в плане, {result.unplaced} черновиком</strong>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Борт</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Название</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Начало</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Окончание</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Ангар / статус</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((ev) => (
                  <tr key={ev.eventId}>
                    <td style={{ padding: "6px 8px" }}>{ev.label}</td>
                    <td style={{ padding: "6px 8px" }}>{ev.title}</td>
                    <td style={{ padding: "6px 8px" }}>{dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")}</td>
                    <td style={{ padding: "6px 8px" }}>{dayjs(ev.endAt).format("DD.MM.YYYY HH:mm")}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {ev.hangarId ? (hangarById.get(ev.hangarId)?.name ?? ev.hangarId) : <span className="muted">Черновик (без места)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
