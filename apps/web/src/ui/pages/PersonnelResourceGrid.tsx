import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiPut } from "../../lib/api";
import { BlockHelp } from "../components/BlockHelp";
import { dateKey, mondayOfWeek } from "../../lib/personnelPlanning";
import {
  PersonnelDraftStore,
  baselineFromSheets,
  buildResourceRows,
  groupAvailabilityWrites,
  prefixOffsets,
  resourceCellKey,
  visibleRowRange,
  type ResourceGridSheet,
  type ResourceRow
} from "../../lib/personnelResourceModel";

const API = "/api/personnel-planning";
const OVERSCAN = 240;
const EMPTY_SHIFTS: ShiftMeta[] = [];

type ShiftMeta = { id: string; code: string; name: string; startMin: number; label: string };

function fmtDayMonth(value: string) {
  const [, month, day] = value.split("-");
  return day && month ? `${day}.${month}` : value;
}

function shiftLabel(shift: { code: string; name: string; startMin: number }) {
  const code = shift.code.toUpperCase();
  if (code === "DAY" || code.includes("ДЕН")) return "д";
  if (code === "NIGHT" || code.includes("НОЧ") || code.includes("EVE")) return "н";
  return shift.startMin >= 18 * 60 ? "н" : shift.startMin <= 10 * 60 ? "д" : shift.name;
}

function errorText(error: unknown) {
  return String((error as Error)?.message ?? error);
}

function sumText(store: PersonnelDraftStore, keys: readonly string[]) {
  let total = 0;
  let any = false;
  for (const key of keys) {
    const value = store.get(key);
    if (value === "") continue;
    any = true;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) total += numeric;
  }
  return any ? String(total) : "";
}

async function runPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
  if (!items.length) return;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await task(items[index]!);
    }
  }));
}

function useDraftRevision(store: PersonnelDraftStore, sheets: readonly ResourceGridSheet[]) {
  const baseline = useMemo(() => baselineFromSheets(sheets), [sheets]);
  const seen = useRef<typeof baseline | null>(null);
  const revision = useRef(0);
  if (seen.current !== baseline) {
    seen.current = baseline;
    store.applyBaseline(baseline);
    revision.current += 1;
  }
  return revision.current;
}

const InputCell = memo(function InputCell(props: {
  store: PersonnelDraftStore;
  revision: number;
  cellKey: string;
  disabled: boolean;
  label: string;
  past: boolean;
}) {
  const [value, setValue] = useState(() => props.store.get(props.cellKey));
  const [dirty, setDirty] = useState(() => props.store.isDirty(props.cellKey));
  const seen = useRef(props.revision);
  if (seen.current !== props.revision) {
    seen.current = props.revision;
    const next = props.store.get(props.cellKey);
    const nextDirty = props.store.isDirty(props.cellKey);
    if (next !== value) setValue(next);
    if (nextDirty !== dirty) setDirty(nextDirty);
  }
  useEffect(() => props.store.subscribe(props.cellKey, () => {
    setValue(props.store.get(props.cellKey));
    setDirty(props.store.isDirty(props.cellKey));
  }), [props.store, props.cellKey]);
  return (
    <td className={props.past ? "isPast" : undefined}>
      <input
        type="number"
        min={0}
        step={1}
        name={props.cellKey}
        autoComplete="off"
        className={dirty ? "isDirty" : undefined}
        value={value}
        disabled={props.disabled}
        aria-label={props.label}
        onChange={(event) => props.store.set(props.cellKey, event.target.value)}
      />
    </td>
  );
});

const AggregateRowCells = memo(function AggregateRowCells(props: {
  store: PersonnelDraftStore;
  revision: number;
  workshopId: string;
  typeIds: string[];
  tokens: string[];
  dates: string[];
  shifts: ShiftMeta[];
  today: string;
}) {
  const read = () => props.dates.flatMap((date) => props.shifts.map((shift) => {
    const keys = props.typeIds.flatMap((typeId) => props.tokens.map((token) => resourceCellKey(props.workshopId, date, shift.id, typeId, token)));
    return { key: `${date}:${shift.id}`, past: date < props.today, text: sumText(props.store, keys) };
  }));
  const [cells, setCells] = useState(read);
  const seen = useRef(props.revision);
  if (seen.current !== props.revision) {
    seen.current = props.revision;
    const next = read();
    if (next.some((cell, index) => cell.text !== cells[index]?.text)) setCells(next);
  }
  useEffect(() => props.store.subscribeAny(() => {
    setCells((old) => {
      const next = read();
      if (next.length === old.length && next.every((cell, index) => cell.text === old[index]?.text)) return old;
      return next;
    });
  }), [props.store, props.dates, props.shifts, props.typeIds, props.tokens, props.workshopId, props.today]);
  return cells.map((cell) => <td key={cell.key} className={cell.past ? "isPast" : undefined}>{cell.text}</td>);
});

const ResourceTableRow = memo(function ResourceTableRow(props: {
  row: ResourceRow;
  colSpan: number;
  dates: string[];
  shifts: ShiftMeta[];
  store: PersonnelDraftStore;
  revision: number;
  today: string;
  canWrite: boolean;
  lockedWeeks: string;
}) {
  const { row } = props;
  const locked = useMemo(() => new Set(props.lockedWeeks.split(",").filter(Boolean)), [props.lockedWeeks]);
  if (row.kind === "banner") {
    return (
      <tr className="personnelWorkshopBanner personnelRowBanner" style={{ height: row.height }}>
        <th colSpan={props.colSpan}><span className="personnelWorkshopBannerLabel">{row.label}</span></th>
      </tr>
    );
  }
  if (row.kind === "note") {
    return (
      <tr className="personnelRowNote" style={{ height: row.height }}>
        <td className="personnelWorkshopNote" colSpan={props.colSpan}>{row.text}</td>
      </tr>
    );
  }
  if (row.kind === "input") {
    return (
      <tr className="personnelRowInput" style={{ height: row.height }}>
        <th><b>{row.title}</b></th>
        <td>{row.typeLabel}</td>
        {props.dates.flatMap((date) => props.shifts.map((shift) => {
          const key = resourceCellKey(row.workshopId, date, shift.id, row.typeId, row.token);
          const past = date < props.today;
          return (
            <InputCell
              key={key}
              store={props.store}
              revision={props.revision}
              cellKey={key}
              past={past}
              disabled={!props.canWrite || past || locked.has(mondayOfWeek(date))}
              label={`${row.workshopLabel} ${row.categoryCode} ${row.typeLabel} ${date} ${shift.label}`}
            />
          );
        }))}
      </tr>
    );
  }
  return (
    <tr className={`${row.className} personnelRowSum`} style={{ height: row.height }}>
      <th><b>{row.title}</b><small>{row.hint}</small></th>
      <td>{row.typeLabel}</td>
      <AggregateRowCells
        store={props.store}
        revision={props.revision}
        workshopId={row.workshopId}
        typeIds={row.typeIds}
        tokens={row.tokens}
        dates={props.dates}
        shifts={props.shifts}
        today={props.today}
      />
    </tr>
  );
});

function SaveCluster(props: {
  store: PersonnelDraftStore;
  revision: number;
  canWrite: boolean;
  pending: boolean;
  saved: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  const [count, setCount] = useState(() => props.store.dirtyCount);
  const seen = useRef(props.revision);
  if (seen.current !== props.revision) {
    seen.current = props.revision;
    if (props.store.dirtyCount !== count) setCount(props.store.dirtyCount);
  }
  useEffect(() => props.store.subscribeDirty(() => setCount(props.store.dirtyCount)), [props.store]);
  return (
    <div className="personnelSaveRow">
      <button type="button" className="btn" disabled={count === 0 || props.pending} onClick={props.onReset}>
        Сбросить
      </button>
      <button type="button" className="btn btnPrimary" disabled={!props.canWrite || count === 0 || props.pending} onClick={props.onSave}>
        {props.pending ? "Сохранение…" : `Сохранить${count ? ` (${count})` : ""}`}
      </button>
      {props.saved ? <span className="personnelSaved" role="status">Сохранено!</span> : null}
    </div>
  );
}

export function PersonnelResourceGrid(props: {
  store: PersonnelDraftStore;
  sheets: ResourceGridSheet[];
  dates: string[];
  shifts: Array<{ id: string; code: string; name: string; startMin: number }>;
  today: string;
  canWrite: boolean;
  fetching: boolean;
}) {
  const qc = useQueryClient();
  const store = props.store;
  const revision = useDraftRevision(store, props.sheets);
  const sheetsRef = useRef(props.sheets);
  sheetsRef.current = props.sheets;
  const shifts = useMemo<ShiftMeta[]>(
    () => props.shifts.length ? props.shifts.map((shift) => ({ ...shift, label: shiftLabel(shift) })) : EMPTY_SHIFTS,
    [props.shifts]
  );
  const rows = useMemo(() => buildResourceRows(props.sheets), [props.sheets]);
  const offsets = useMemo(() => prefixOffsets(rows.map((row) => row.height)), [rows]);
  const lockedByWorkshop = useMemo(() => {
    const map = new Map<string, string>();
    for (const sheet of props.sheets) {
      map.set(sheet.workshopId, sheet.weeks.filter((week) => week.isLocked).map((week) => dateKey(week.weekStart)).sort().join(","));
    }
    return map;
  }, [props.sheets]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const metrics = useRef({ top: 0, height: 900, thead: 70 });
  const [, setScrollVersion] = useState(0);
  const range = visibleRowRange(offsets, metrics.current.top, metrics.current.height, metrics.current.thead, OVERSCAN);
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = {
        top: element.scrollTop,
        height: element.clientHeight || 900,
        thead: element.querySelector("thead")?.offsetHeight ?? 0
      };
      const nextRange = visibleRowRange(offsets, next.top, next.height, next.thead, OVERSCAN);
      const current = visibleRowRange(offsets, metrics.current.top, metrics.current.height, metrics.current.thead, OVERSCAN);
      if (current.start === nextRange.start && current.end === nextRange.end && metrics.current.thead === next.thead && metrics.current.height === next.height) return;
      metrics.current = next;
      setScrollVersion((value) => value + 1);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [offsets]);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (savedTimer.current != null) window.clearTimeout(savedTimer.current);
  }, []);
  const saveM = useMutation({
    mutationFn: async () => {
      const sheets = sheetsRef.current;
      const categories = new Map<string, { categoryCode: string; skillId?: string | null }>();
      for (const sheet of sheets) {
        for (const row of sheet.mappedCategories) {
          const token = row.skillId || row.categoryCode;
          if (token) categories.set(`${sheet.workshopId}|${token}`, row);
        }
      }
      const groups = groupAvailabilityWrites(
        store.dirtyKeys(),
        (key) => store.get(key),
        (workshopId, token) => categories.get(`${workshopId}|${token}`) ?? null
      );
      let failure: unknown = null;
      await runPool(groups, 4, async (group) => {
        try {
          const version = sheets.find((sheet) => sheet.workshopId === group.workshopId)?.weeks.find((week) => dateKey(week.weekStart) === group.weekStart)?.version ?? 0;
          await apiPut(`${API}/availability`, {
            workshopId: group.workshopId,
            weekStart: group.weekStart,
            expectedVersion: version,
            items: group.items
          });
          store.markCleanIfUnchanged(group.entries);
        } catch (error) {
          failure ??= error;
        }
      });
      if (failure) throw failure;
      void qc.invalidateQueries({ queryKey: ["personnel", "availability"] });
      void qc.invalidateQueries({ queryKey: ["personnel", "week"] });
      void qc.invalidateQueries({ queryKey: ["personnel", "balance"] });
    },
    onSuccess: () => {
      setSavedFlash(true);
      if (savedTimer.current != null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedFlash(false), 7000);
    }
  });
  const start = Math.min(range.start, rows.length);
  const end = Math.max(start, Math.min(range.end, rows.length));
  const topGap = offsets[start] ?? 0;
  const bottomGap = (offsets[rows.length] ?? 0) - (offsets[end] ?? 0);
  const colSpan = 2 + props.dates.length * shifts.length;
  const lockedDates = props.dates.some((date) => {
    const monday = mondayOfWeek(date);
    return props.sheets.some((sheet) => sheet.weeks.some((week) => week.isLocked && dateKey(week.weekStart) === monday));
  });
  const visibleRows = rows.slice(start, end);
  return (
    <section className="card personnelMatrixCard">
      <div className="personnelSectionHead">
        <div>
          <h2 className="personnelResourceTitle">
            Доступный ресурс
            <BlockHelp label="Доступный ресурс">
              <p>В ячейке — численность: сколько человек этой квалификации можно поставить на тип ВС в выбранную смену.</p>
              <ul>
                <li>Столбец — один день. Под датой «д» — дневная смена, «н» — ночная.</li>
                <li>Несколько цехов идут друг под другом. Тёмная полоса сверху — название цеха. Если у цеха нет квалификаций или типов ВС, вместо таблицы показана подсказка, что настроить в справочнике.</li>
                <li>Строка с полем — одна квалификация и один тип ВС. Число вводится с клавиатуры или стрелками поля. Пустая ячейка значит, что численность не задана.</li>
                <li>Строка категории без поля, например ME или AV, — сумма квалификаций этой категории по данному типу ВС.</li>
                <li>«Итого» напротив типа ВС — его численность за смену по всем квалификациям цеха.</li>
                <li>Нижняя строка цеха «Итого» с подписью «все типы ВС» — сумма по всем типам этого цеха.</li>
                <li>Даты раньше сегодняшней закрыты и закрашены серым. Неделя, которую зафиксировали, тоже закрыта для правки.</li>
                <li>Жёлтая ячейка — правка ещё не записана. «Сохранить» отправляет такие ячейки. «Сбросить» возвращает их к последним данным с сервера и не трогает уже сохранённые.</li>
                <li>Несохранённые правки остаются при смене периода, списка цехов и обновлении страницы, пока открыта эта вкладка браузера. После закрытия вкладки они пропадают.</li>
                <li>Период не длиннее 31 дня. Стрелки у дат сдвигают всё окно вперёд или назад на его длину.</li>
              </ul>
            </BlockHelp>
            {props.fetching ? <span className="muted"> · обновление…</span> : null}
          </h2>
        </div>
        <SaveCluster store={store} revision={revision} canWrite={props.canWrite} pending={saveM.isPending} saved={savedFlash} onSave={() => saveM.mutate()} onReset={() => store.discardUnsaved()} />
      </div>
      <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
        <div className="personnelTableScroll personnelResourceScroll" ref={scrollerRef}>
          <table className="personnelMatrix personnelMatrixRange">
            <colgroup>
              <col className="personnelColLabel" />
              <col className="personnelColType" />
              {props.dates.flatMap((date) => shifts.map((shift) => <col key={`${date}:${shift.id}`} className="personnelColShift" />))}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2}>Квалификация</th>
                <th rowSpan={2}>Тип ВС</th>
                {props.dates.map((date) => <th key={date} colSpan={shifts.length || 1} className={date < props.today ? "isPast" : undefined}>{fmtDayMonth(date)}</th>)}
              </tr>
              <tr>
                {props.dates.flatMap((date) => shifts.map((shift) => <th key={`${date}:${shift.id}`} className={date < props.today ? "isPast" : undefined} title={shift.name}>{shift.label}</th>))}
              </tr>
            </thead>
            <tbody>
              {topGap > 0 ? <tr className="personnelVirtSpacer" aria-hidden="true"><td colSpan={colSpan} style={{ height: topGap, padding: 0, border: 0 }} /></tr> : null}
              {visibleRows.map((row) => (
                <ResourceTableRow
                  key={row.key}
                  row={row}
                  colSpan={colSpan}
                  dates={props.dates}
                  shifts={shifts}
                  store={store}
                  revision={revision}
                  today={props.today}
                  canWrite={props.canWrite}
                  lockedWeeks={row.kind === "banner" || row.kind === "note" ? "" : lockedByWorkshop.get(row.workshopId) ?? ""}
                />
              ))}
              {bottomGap > 0 ? <tr className="personnelVirtSpacer" aria-hidden="true"><td colSpan={colSpan} style={{ height: bottomGap, padding: 0, border: 0 }} /></tr> : null}
            </tbody>
          </table>
        </div>
      </form>
      {lockedDates ? <div className="personnelNotice">Даты зафиксированных недель закрыты для правки.</div> : null}
      {props.dates.some((date) => date < props.today) ? <div className="personnelNotice">Даты раньше сегодняшней закрыты для правки.</div> : null}
      {saveM.error ? <div className="error">{errorText(saveM.error)}</div> : null}
    </section>
  );
}
