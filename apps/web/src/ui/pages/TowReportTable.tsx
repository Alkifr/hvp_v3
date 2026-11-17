import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataGrid, { textEditor, type Column, type RenderEditCellProps } from "react-data-grid";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import "react-data-grid/lib/styles.css";

import { apiPatch } from "../../lib/api";
import { formatMskDateTime, fromInputMskOptional, toInputMsk } from "../../lib/localDate";
import { refreshTowLists } from "./TowPlanGrid";

export type TowReportRow = {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStatus: string;
  seq: number;
  direction: string;
  directionLabel: string;
  hangarId: string;
  hangarNumber: string;
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  fromStand: string;
  toStand: string;
  plannedStartAt: string;
  plannedStartMsk: string;
  plannedEndAt: string;
  plannedEndMsk: string;
  occupancyEndAt: string;
  occupancyEndMsk: string;
  inferredOccupancyEndAt: string;
  standOccupancy: string;
  notes: string;
  toSlotEndMsk: string;
  toSlotDuration: string;
  positionComment: string;
  startChangeReason: string;
};

type DataGridRow = TowReportRow & {
  kind: "data";
  occupancyStartLocal: string;
  occupancyEndLocal: string;
};
type HangarGridRow = { kind: "hangar"; id: string; label: string };
type GridRow = DataGridRow | HangarGridRow;

const REGISTRY_COLUMN_COUNT = 13;

function hangarBandLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Без ангара";
  if (/^ангар\b/i.test(trimmed)) return trimmed.replace(/^ангар/i, "Ангар");
  const number = trimmed.match(/(\d+)/);
  if (number) return `Ангар ${number[1]}`;
  return `Ангар ${trimmed}`;
}

function hangarSortKey(name: string): number {
  const number = name.match(/(\d+)/);
  return number ? Number(number[1]) : Number.MAX_SAFE_INTEGER;
}

function withHangarBands(items: DataGridRow[]): GridRow[] {
  const sorted = [...items].sort(
    (a, b) => hangarSortKey(a.hangarNumber) - hangarSortKey(b.hangarNumber) || a.hangarNumber.localeCompare(b.hangarNumber, "ru") || a.seq - b.seq
  );
  const rows: GridRow[] = [];
  let current = "";
  let number = 0;
  for (const row of sorted) {
    const key = row.hangarId || row.hangarNumber || "none";
    if (key !== current) {
      current = key;
      number = 0;
      rows.push({ kind: "hangar", id: `hangar:${key}`, label: hangarBandLabel(row.hangarNumber) });
    }
    number += 1;
    rows.push(row.seq === number ? row : { ...row, seq: number });
  }
  return rows;
}

function messageRowHeight(text: string): number {
  if (!text) return 42;
  return 40 + Math.ceil(text.length / 26) * 18;
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  );
}

function occupancyStartLocal(row: TowReportRow): string {
  return toInputMsk(row.plannedStartAt);
}

function occupancyEndLocal(row: TowReportRow): string {
  return toInputMsk(row.occupancyEndAt || row.inferredOccupancyEndAt);
}

function formatLocalMsk(value: string): string {
  const iso = fromInputMskOptional(value);
  return iso ? formatMskDateTime(iso) : "";
}

function occupancyLabel(row: DataGridRow): string {
  const start = formatLocalMsk(row.occupancyStartLocal);
  const end = formatLocalMsk(row.occupancyEndLocal);
  if (!start && !end) return "";
  return `${start || "—"} - ${end || "—"}`;
}

function slotLabel(row: TowReportRow): string {
  return row.toSlotEndMsk ? `Слот до ${row.toSlotEndMsk} мск` : row.toSlotDuration || "";
}

function asDataRow(row: TowReportRow, draft?: Partial<DataGridRow>): DataGridRow {
  return {
    ...row,
    kind: "data",
    occupancyStartLocal: draft?.occupancyStartLocal ?? occupancyStartLocal(row),
    occupancyEndLocal: draft?.occupancyEndLocal ?? occupancyEndLocal(row),
    notes: draft?.notes ?? row.notes,
    positionComment: draft?.positionComment ?? row.positionComment,
    startChangeReason: draft?.startChangeReason ?? row.startChangeReason
  };
}

function isDirty(source: TowReportRow, row: DataGridRow): boolean {
  return (
    row.notes !== source.notes ||
    row.positionComment !== source.positionComment ||
    row.startChangeReason !== source.startChangeReason ||
    row.occupancyStartLocal !== occupancyStartLocal(source) ||
    row.occupancyEndLocal !== occupancyEndLocal(source)
  );
}

function reportVisibleSame(local: DataGridRow, item: TowReportRow): boolean {
  return (
    local.seq === item.seq &&
    local.hangarId === item.hangarId &&
    local.hangarNumber === item.hangarNumber &&
    local.aircraftType === item.aircraftType &&
    local.tailNumber === item.tailNumber &&
    local.operator === item.operator &&
    local.fromStand === item.fromStand &&
    local.toStand === item.toStand &&
    local.plannedStartMsk === item.plannedStartMsk &&
    local.standOccupancy === item.standOccupancy &&
    local.toSlotDuration === item.toSlotDuration &&
    local.toSlotEndMsk === item.toSlotEndMsk &&
    local.notes === item.notes &&
    local.positionComment === item.positionComment &&
    local.startChangeReason === item.startChangeReason &&
    local.occupancyStartLocal === occupancyStartLocal(item) &&
    local.occupancyEndLocal === occupancyEndLocal(item)
  );
}

function OccupancyEditor({ row, onRowChange, onClose }: RenderEditCellProps<GridRow>) {
  if (row.kind !== "data") return null;
  const update = (patch: Partial<DataGridRow>, commit = false) => onRowChange({ ...row, ...patch }, commit);
  return (
    <span
      className="towOccupancyEdit"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose(true);
      }}
    >
      <input
        autoFocus
        className="towGridInput"
        type="datetime-local"
        aria-label="Начало занятия МС"
        value={row.occupancyStartLocal}
        onChange={(event) => update({ occupancyStartLocal: event.target.value })}
      />
      <span>-</span>
      <input
        className="towGridInput"
        type="datetime-local"
        aria-label="Окончание занятия МС"
        value={row.occupancyEndLocal}
        onChange={(event) => update({ occupancyEndLocal: event.target.value })}
      />
    </span>
  );
}

export function TowReportTable({
  items,
  canWrite,
  onDirtyChange
}: {
  items: TowReportRow[];
  canWrite: boolean;
  canGantt?: boolean;
  onOpenEvent?: (eventId: string) => void;
  onDirtyChange: (count: number) => void;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<DataGridRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [committed, setCommitted] = useState<Record<string, TowReportRow>>({});
  const itemsRef = useRef(items);
  const errorsRef = useRef(errors);
  const committedRef = useRef(committed);
  const pendingRef = useRef<string | null>(null);
  itemsRef.current = items;
  errorsRef.current = errors;
  committedRef.current = committed;

  useEffect(() => {
    setRows((prev) => {
      const byId = new Map(prev.map((row) => [row.id, row]));
      const next = items.map((item) => {
        const saved = committed[item.id];
        const local = byId.get(item.id);
        const base = saved ?? item;
        if (!local) return asDataRow(item);
        if (isDirty(base, local)) return local;
        if (saved && !reportVisibleSame(local, item)) return local;
        return reportVisibleSame(local, item) ? local : asDataRow(item);
      });
      if (next.length === prev.length && next.every((row, index) => row === prev[index])) return prev;
      return next;
    });
  }, [committed, items]);

  useEffect(() => {
    setCommitted((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, snap] of Object.entries(prev)) {
        const item = items.find((row) => row.id === id);
        const caughtUp =
          !item ||
          (item.notes === snap.notes &&
            item.positionComment === snap.positionComment &&
            item.startChangeReason === snap.startChangeReason &&
            occupancyStartLocal(item) === occupancyStartLocal(snap) &&
            occupancyEndLocal(item) === occupancyEndLocal(snap));
        if (caughtUp) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  const dirtyCount = useMemo(() => {
    const source = new Map(items.map((item) => [item.id, committed[item.id] ?? item]));
    return rows.filter((row) => {
      const item = source.get(row.id);
      return item ? isDirty(item, row) : false;
    }).length;
  }, [committed, items, rows]);

  useEffect(() => {
    onDirtyChange(dirtyCount);
  }, [dirtyCount, onDirtyChange]);

  const save = useMutation({
    mutationFn: async (row: DataGridRow) => {
      const source = items.find((item) => item.id === row.id);
      if (!source) return;
      const startIso = fromInputMskOptional(row.occupancyStartLocal);
      const endIso = fromInputMskOptional(row.occupancyEndLocal);
      const startChanged = row.occupancyStartLocal !== occupancyStartLocal(source);
      const endChanged = row.occupancyEndLocal !== occupancyEndLocal(source);
      if ((startChanged && !startIso) || (endChanged && !endIso)) throw new Error("Укажите начало и окончание занятия МС");
      if (startChanged && startIso) {
        const minutes = Math.abs(new Date(startIso).getTime() - new Date(source.plannedStartAt).getTime()) / 60_000;
        if (minutes > 0 && minutes < 60 && !row.startChangeReason.trim()) {
          throw new Error("Сдвиг начала меньше 60 минут. Укажите причину");
        }
      }
      return apiPatch(`/api/tows/${row.id}`, {
        notes: row.notes.trim() || null,
        positionComment: row.positionComment.trim() || null,
        startChangeReason: row.startChangeReason.trim() || null,
        startAt: startChanged ? startIso ?? undefined : undefined,
        occupancyEndAt: endChanged ? endIso ?? undefined : undefined,
        changeReason: "Реестр"
      });
    },
    onMutate: (row) => {
      pendingRef.current = row.id;
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item } : item)));
    },
    onSuccess: (_data, row) => {
      pendingRef.current = null;
      const source = itemsRef.current.find((item) => item.id === row.id);
      if (source) {
        const startIso = fromInputMskOptional(row.occupancyStartLocal) ?? source.plannedStartAt;
        const endIso = fromInputMskOptional(row.occupancyEndLocal) ?? source.occupancyEndAt;
        setCommitted((prev) => ({
          ...prev,
          [row.id]: {
            ...source,
            notes: row.notes,
            positionComment: row.positionComment,
            startChangeReason: row.startChangeReason,
            plannedStartAt: startIso,
            occupancyEndAt: endIso
          }
        }));
      }
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item } : item)));
      setErrors((prev) => (prev[row.id] ? { ...prev, [row.id]: "" } : prev));
      void refreshTowLists(qc);
      void qc.invalidateQueries({ queryKey: ["tows-changes", row.eventId] });
    },
    onError: (error, row) => {
      pendingRef.current = null;
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item } : item)));
      setErrors((prev) => ({ ...prev, [row.id]: String((error as Error).message ?? error) }));
    }
  });

  const grouped = useMemo(() => withHangarBands(rows), [rows]);
  const editable = (row: GridRow) => canWrite && row.kind === "data";
  const lockedClass = (row: GridRow) => (row.kind === "hangar" ? "towHangarBand" : canWrite ? undefined : "towGridReadonly");
  const resetRow = (row: DataGridRow) => {
    const source = committedRef.current[row.id] ?? itemsRef.current.find((item) => item.id === row.id);
    if (!source) return;
    setRows((current) => current.map((item) => (item.id === row.id ? asDataRow(source) : item)));
    setErrors((prev) => (prev[row.id] ? { ...prev, [row.id]: "" } : prev));
  };
  const mutateRef = useRef(save.mutate);
  mutateRef.current = save.mutate;
  const columns = useMemo<Column<GridRow>[]>(
    () => [
      {
        key: "seq",
        name: "№",
        width: 60,
        cellClass: lockedClass,
        colSpan: (args) => (args.type === "ROW" && args.row.kind === "hangar" ? REGISTRY_COLUMN_COUNT : undefined),
        renderCell: ({ row }) => (row.kind === "hangar" ? row.label : row.seq)
      },
      { key: "aircraftType", name: "Тип ВС", width: 110, cellClass: lockedClass, renderCell: ({ row }) => (row.kind === "data" ? row.aircraftType || "—" : null) },
      { key: "tailNumber", name: "Бортовой номер", width: 140, cellClass: lockedClass, renderCell: ({ row }) => (row.kind === "data" ? row.tailNumber || "—" : null) },
      { key: "operator", name: "Оператор", width: 130, cellClass: lockedClass, renderCell: ({ row }) => (row.kind === "data" ? row.operator || "—" : null) },
      { key: "fromStand", name: "Откуда (с МС)", width: 140, cellClass: lockedClass, renderCell: ({ row }) => (row.kind === "data" ? row.fromStand || "—" : null) },
      { key: "toStand", name: "Куда (на МС)", width: 140, cellClass: lockedClass, renderCell: ({ row }) => (row.kind === "data" ? row.toStand || "—" : null) },
      { key: "plannedStartMsk", name: "Плановое время начала буксировки (мск)", width: 220, cellClass: lockedClass, renderCell: ({ row }) => (row.kind === "data" ? row.plannedStartMsk || "—" : null) },
      {
        key: "standOccupancy",
        name: "Требуемая продолжительность занятия МС",
        width: 340,
        editable,
        cellClass: lockedClass,
        renderEditCell: OccupancyEditor,
        renderCell: ({ row }) => (row.kind === "data" ? occupancyLabel(row) || "—" : null)
      },
      {
        key: "notes",
        name: "Примечание",
        width: 200,
        editable,
        cellClass: lockedClass,
        renderEditCell: textEditor,
        renderCell: ({ row }) => (row.kind === "data" ? row.notes : null)
      },
      { key: "toSlotDuration", name: "Продолжительность слотов ТО", width: 240, cellClass: lockedClass, renderCell: ({ row }) => (row.kind === "data" ? slotLabel(row) || "—" : null) },
      {
        key: "positionComment",
        name: "Позиция",
        width: 160,
        editable,
        cellClass: lockedClass,
        renderEditCell: textEditor,
        renderCell: ({ row }) => (row.kind === "data" ? row.positionComment : null)
      },
      {
        key: "startChangeReason",
        name: "Причина изменения времени начала буксировки (<60 мин)",
        width: 260,
        editable,
        cellClass: lockedClass,
        renderEditCell: textEditor,
        renderCell: ({ row }) => (row.kind === "data" ? row.startChangeReason : null)
      },
      {
        key: "actions",
        name: "",
        width: 280,
        cellClass: lockedClass,
        renderCell: ({ row }) => {
          if (row.kind !== "data") return null;
          const source = committedRef.current[row.id] ?? itemsRef.current.find((item) => item.id === row.id);
          const changed = source ? isDirty(source, row) : false;
          const pending = pendingRef.current === row.id;
          return (
            <div className="towGridActions">
              {canWrite && changed ? (
                <>
                  <button className="btn btnPrimary" type="button" disabled={pending} onClick={() => mutateRef.current(row)}>
                    Сохранить
                  </button>
                  <button className="btn towIconBtn" type="button" disabled={pending} aria-label="Отменить" title="Отменить" onClick={() => resetRow(row)}>
                    <UndoIcon />
                  </button>
                </>
              ) : null}
              {errorsRef.current[row.id] ? <span className="error towGridMessage">{errorsRef.current[row.id]}</span> : null}
            </div>
          );
        }
      }
    ],
    [canWrite]
  );
  const rowHeight = useCallback((row: GridRow) => (row.kind === "hangar" ? 36 : messageRowHeight(row.kind === "data" ? errorsRef.current[row.id] || "" : "")), []);

  return (
    <>
      <DataGrid
        className="rdg-light towGrid"
        columns={columns}
        rows={grouped}
        rowKeyGetter={(row) => row.id}
        onRowsChange={(next) => setRows(next.filter((row): row is DataGridRow => row.kind === "data"))}
        rowClass={(row) => (row.kind === "hangar" ? "towHangarBand" : undefined)}
        headerRowHeight={64}
        rowHeight={rowHeight}
        style={{ blockSize: "min(70vh, 760px)" }}
      />
      {rows.length === 0 ? <div className="muted towGridEmpty">Нет назначенных буксировок в выбранном периоде. Время задаётся на вкладке «План».</div> : null}
    </>
  );
}
