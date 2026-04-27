import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";

import { apiGet, apiPost } from "../../lib/api";
import { useActiveSandbox } from "../components/SandboxSwitcher";

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
    scheduledBy: "compact" | "sequential" | "fixedCadence";
    warnings: string[];
    towBeforeStartAt?: string;
    towBeforeEndAt?: string;
    towAfterStartAt?: string;
    towAfterEndAt?: string;
  }>;
  unplaced: Array<{ index: number; title: string; label: string; intendedStartAt?: string; warnings?: string[] }>;
  summary: {
    total: number;
    placed: number;
    unplaced: number;
    createdTowsBefore?: number;
    createdTowsAfter?: number;
    draftOnConflict?: boolean;
  };
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
    towBeforeStartAt?: string;
    towBeforeEndAt?: string;
    towAfterStartAt?: string;
    towAfterEndAt?: string;
  }>;
  createdTowsBefore?: number;
  createdTowsAfter?: number;
};

export function MassPlanView() {
  const qc = useQueryClient();
  const { active: activeSandbox } = useActiveSandbox();
  const [tatHours, setTatHours] = useState(72);
  const [operatorId, setOperatorId] = useState("");
  const [aircraftTypeId, setAircraftTypeId] = useState("");
  const [eventTypeId, setEventTypeId] = useState("");
  const [count, setCount] = useState(5);
  const [startFrom, setStartFrom] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [endTo, setEndTo] = useState(() => dayjs().add(30, "day").format("YYYY-MM-DD"));
  const [hangarPriority, setHangarPriority] = useState<string[]>([]);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"compact" | "sequential" | "fixedCadence">("compact");
  const [spacingHours, setSpacingHours] = useState(0);
  const [cadenceHours, setCadenceHours] = useState(168);
  const [placementMode, setPlacementMode] = useState<"auto" | "preferredHangars" | "draftOnConflict">("auto");
  const [towBeforeMinutes, setTowBeforeMinutes] = useState(0);
  const [towAfterMinutes, setTowAfterMinutes] = useState(0);
  const [towBlocksStand, setTowBlocksStand] = useState(false);
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
    titleTemplate: titleTemplate.trim() || undefined,
    scheduleMode,
    spacingHours: Math.max(0, Number(spacingHours) || 0),
    cadenceHours: scheduleMode === "fixedCadence" ? Math.max(1, Number(cadenceHours) || 1) : undefined,
    placementMode,
    towBeforeMinutes: Math.max(0, Math.min(24 * 60, Number(towBeforeMinutes) || 0)),
    towAfterMinutes: Math.max(0, Math.min(24 * 60, Number(towAfterMinutes) || 0)),
    towBlocksStand
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
      await qc.invalidateQueries({ queryKey: ["sandboxes"] });
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

  const scheduleLabel = (mode: "compact" | "sequential" | "fixedCadence") =>
    mode === "compact" ? "Компактно" : mode === "sequential" ? "Последовательно" : "Фиксированный шаг";

  const formatRange = (from?: string, to?: string) =>
    from && to ? `${dayjs(from).format("DD.MM HH:mm")} → ${dayjs(to).format("DD.MM HH:mm")}` : "—";

  return (
    <div className="massPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Планирование серий событий</div>
          <h1>Массовое планирование</h1>
          <p>
            Создавайте пачки виртуальных бортов, проверяйте размещение в предпросмотре и переносите результат в текущий контур.
            Непоместившиеся события будут сохранены черновиками без места.
          </p>
        </div>
        <div className="massHeroStats" aria-label="Текущие параметры">
          <span><b>{count}</b> событий</span>
          <span><b>{tatHours}</b> ч TAT</span>
          <span><b>{scheduleLabel(scheduleMode)}</b></span>
        </div>
      </section>

      <div className="massCard">
        <div className={activeSandbox ? "contextNotice contextNoticeSandbox" : "contextNotice"}>
          {activeSandbox ? (
            <>
              <strong>Режим песочницы:</strong> массовое планирование создаст события только в песочнице
              {" "}
              <b>{activeSandbox.name}</b>. Рабочий контур не изменится, а занятость мест проверяется только внутри этой песочницы.
            </>
          ) : (
            <>
              <strong>Рабочий контур:</strong> массовое планирование создаст события в основном плане.
            </>
          )}
        </div>

        <form onSubmit={handlePreview} className="massForm">
          <section className="massSection">
            <div className="massSectionHead">
              <div>
                <h2>Основные параметры</h2>
                <p>Определяют тип события, период планирования и количество создаваемых строк.</p>
              </div>
            </div>

            <div className="massFormGrid">
            <label className="massField">
              <span className="muted">TAT одного события, ч</span>
              <input
                type="number"
                min={1}
                max={8760}
                value={tatHours}
                onChange={(e) => setTatHours(Number(e.target.value) || 72)}
              />
            </label>
            <label className="massField">
              <span className="muted">Оператор</span>
              <select
                value={operatorId}
                onChange={(e) => { setOperatorId(e.target.value); setPreview(null); setResult(null); }}
                required
              >
                <option value="">— выберите —</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <label className="massField">
              <span className="muted">Тип ВС</span>
              <select
                value={aircraftTypeId}
                onChange={(e) => setAircraftTypeId(e.target.value)}
                required
              >
                <option value="">— выберите —</option>
                {aircraftTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.icaoType ? ` (${t.icaoType})` : ""}</option>
                ))}
              </select>
            </label>
            <label className="massField">
              <span className="muted">Вид события</span>
              <select
                value={eventTypeId}
                onChange={(e) => setEventTypeId(e.target.value)}
                required
              >
                <option value="">— выберите —</option>
                {eventTypes.map((et) => (
                  <option key={et.id} value={et.id}>{et.name}</option>
                ))}
              </select>
            </label>
            <label className="massField">
              <span className="muted">Количество</span>
              <input
                type="number"
                min={1}
                max={200}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
              />
            </label>
            <label className="massField">
              <span className="muted">Начало периода</span>
              <input
                type="date"
                value={startFrom}
                onChange={(e) => setStartFrom(e.target.value)}
              />
            </label>
            <label className="massField">
              <span className="muted">Конец периода</span>
              <input
                type="date"
                value={endTo}
                onChange={(e) => setEndTo(e.target.value)}
              />
            </label>
            <label className="massField massFieldWide">
              <span className="muted">Шаблон названия (опц., % = номер)</span>
              <input
                type="text"
                placeholder="Например: A-check %"
                value={titleTemplate}
                onChange={(e) => setTitleTemplate(e.target.value)}
              />
            </label>
          </div>
          </section>

          <details className="massAdvanced massSection" open>
            <summary>Расширенные настройки</summary>
            <div className="massAdvancedGrid">
              <label className="massField">
                <span className="muted">Режим расписания</span>
                <select
                  value={scheduleMode}
                  onChange={(e) => {
                    setScheduleMode(e.target.value as "compact" | "sequential" | "fixedCadence");
                    setPreview(null);
                    setResult(null);
                  }}
                >
                  <option value="compact">Компактно: первый свободный слот</option>
                  <option value="sequential">Последовательно: событие за событием</option>
                  <option value="fixedCadence">Фиксированный шаг от начала периода</option>
                </select>
              </label>

              <label className="massField">
                <span className="muted">Пауза между событиями, ч</span>
                <input
                  type="number"
                  min={0}
                  max={8760}
                  value={spacingHours}
                  onChange={(e) => setSpacingHours(Number(e.target.value) || 0)}
                />
              </label>

              {scheduleMode === "fixedCadence" ? (
                <label className="massField">
                  <span className="muted">Фиксированный шаг, ч</span>
                  <input
                    type="number"
                    min={1}
                    max={8760}
                    value={cadenceHours}
                    onChange={(e) => setCadenceHours(Number(e.target.value) || 1)}
                  />
                </label>
              ) : null}

              <label className="massField">
                <span className="muted">Поведение при конфликте</span>
                <select
                  value={placementMode}
                  onChange={(e) => {
                    setPlacementMode(e.target.value as "auto" | "preferredHangars" | "draftOnConflict");
                    setPreview(null);
                    setResult(null);
                  }}
                >
                  <option value="auto">Искать ближайшее свободное место</option>
                  <option value="preferredHangars">Искать по приоритету ангаров</option>
                  <option value="draftOnConflict">Создавать черновик, если целевой слот занят</option>
                </select>
              </label>

              <label className="massField">
                <span className="muted">Буксировка до, мин</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={towBeforeMinutes}
                  onChange={(e) => setTowBeforeMinutes(Number(e.target.value) || 0)}
                />
              </label>

              <label className="massField">
                <span className="muted">Буксировка после, мин</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={towAfterMinutes}
                  onChange={(e) => setTowAfterMinutes(Number(e.target.value) || 0)}
                />
              </label>

              <label className="massCheckbox">
                <input
                  type="checkbox"
                  checked={towBlocksStand}
                  onChange={(e) => setTowBlocksStand(e.target.checked)}
                />
                <span>Учитывать буксировки как занятость места</span>
              </label>
            </div>
          </details>

          <section className="massSection">
            <div className="massSectionHead">
              <div>
                <h2>Приоритет ангаров</h2>
                <p>Если список не задан, система перебирает активные ангары по имени.</p>
              </div>
            </div>
            <div className="massHangarPriority">
              {hangarPriority.map((id, index) => (
                <span key={id} className="massHangarChip">
                  <span className="massHangarOrder">{index + 1}</span>
                  <span>{hangarById.get(id)?.name ?? id}</span>
                  <button type="button" onClick={() => moveHangar(index, -1)} disabled={index === 0} title="Выше">↑</button>
                  <button type="button" onClick={() => moveHangar(index, 1)} disabled={index === hangarPriority.length - 1} title="Ниже">↓</button>
                  <button type="button" onClick={() => setHangarPriority((p) => p.filter((x) => x !== id))} title="Убрать">✕</button>
                </span>
              ))}
              {availableHangarIds.length > 0 && (
                <select
                  className="massHangarSelect"
                  value=""
                  onChange={(e) => { const v = e.target.value; if (v) setHangarPriority((p) => [...p, v]); }}
                >
                  <option value="">+ ангар</option>
                  {availableHangarIds.map((id) => (
                    <option key={id} value={id}>{hangarById.get(id)?.name ?? id}</option>
                  ))}
                </select>
              )}
            </div>
            {hangarPriority.length === 0 && <div className="massEmptyHint">Приоритет не задан. Будет использован порядок по имени ангара.</div>}
          </section>

          <div className="massActions">
            <button
              type="submit"
              className="btn btnPrimary"
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
        <section className="massCard">
          <div className="massResultHeader">
            <div>
              <h2>Предпросмотр</h2>
              <p>Проверьте размещение перед созданием событий.</p>
            </div>
            <div className="massSummaryChips">
              <span><b>{preview.summary.placed}</b> размещено</span>
              <span><b>{preview.summary.unplaced}</b> черновиков</span>
              <span><b>{(preview.summary.createdTowsBefore ?? 0) + (preview.summary.createdTowsAfter ?? 0)}</b> буксировок</span>
            </div>
          </div>
          {preview.placements.length > 0 && (
            <div className="massTableWrap">
              <table className="massTable">
                <thead>
                  <tr>
                    <th>Вирт. борт</th>
                    <th>Название</th>
                    <th>Начало</th>
                    <th>Окончание</th>
                    <th>Ангар</th>
                    <th>Режим</th>
                    <th>Буксировка до</th>
                    <th>Буксировка после</th>
                    <th>Предупреждения</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.placements.map((p) => (
                    <tr key={p.index}>
                      <td>{p.label}</td>
                      <td>{p.title}</td>
                      <td>{dayjs(p.startAt).format("DD.MM.YYYY HH:mm")}</td>
                      <td>{dayjs(p.endAt).format("DD.MM.YYYY HH:mm")}</td>
                      <td>{hangarById.get(p.hangarId)?.name ?? p.hangarId}</td>
                      <td><span className="massModeBadge">{scheduleLabel(p.scheduledBy)}</span></td>
                      <td>{formatRange(p.towBeforeStartAt, p.towBeforeEndAt)}</td>
                      <td>{formatRange(p.towAfterStartAt, p.towAfterEndAt)}</td>
                      <td>
                        {p.warnings.length > 0 ? p.warnings.join("; ") : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.unplaced.length > 0 && (
            <div className="massDraftBox">
              <strong>Черновики без места</strong>
              <div>
                {preview.unplaced
                  .map((u) =>
                    `${u.label}${u.intendedStartAt ? ` (${dayjs(u.intendedStartAt).format("DD.MM HH:mm")})` : ""}${
                      u.warnings?.length ? ` — ${u.warnings.join("; ")}` : ""
                    }`
                  )
                  .join(", ")}
              </div>
            </div>
          )}
          <div className="massActions">
            <button
              type="button"
              className="btn btnPrimary"
              disabled={applyM.isPending || !operatorId || !aircraftTypeId || !eventTypeId}
              onClick={handleApply}
            >
              {applyM.isPending ? "Создание…" : activeSandbox ? "Создать в песочнице" : "Перенести в план"}
            </button>
          </div>
        </section>
      )}

      {result?.ok && !result.dryRun && result.events && result.events.length > 0 && (
        <section className="massCard">
          <div className="massResultHeader">
            <div>
              <h2>Результат создания</h2>
              <p>События созданы в текущем контуре.</p>
            </div>
            <div className="massSummaryChips">
              <span><b>{result.placed}</b> в плане</span>
              <span><b>{result.unplaced}</b> черновиков</span>
              <span><b>{(result.createdTowsBefore ?? 0) + (result.createdTowsAfter ?? 0)}</b> буксировок</span>
            </div>
          </div>
          <div className="massTableWrap">
            <table className="massTable">
              <thead>
                <tr>
                  <th>Борт</th>
                  <th>Название</th>
                  <th>Начало</th>
                  <th>Окончание</th>
                  <th>Ангар / статус</th>
                  <th>Буксировки</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((ev) => (
                  <tr key={ev.eventId}>
                    <td>{ev.label}</td>
                    <td>{ev.title}</td>
                    <td>{dayjs(ev.startAt).format("DD.MM.YYYY HH:mm")}</td>
                    <td>{dayjs(ev.endAt).format("DD.MM.YYYY HH:mm")}</td>
                    <td>
                      {ev.hangarId ? (hangarById.get(ev.hangarId)?.name ?? ev.hangarId) : <span className="muted">Черновик (без места)</span>}
                    </td>
                    <td>
                      <div>{formatRange(ev.towBeforeStartAt, ev.towBeforeEndAt)}</div>
                      <div>{formatRange(ev.towAfterStartAt, ev.towAfterEndAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
