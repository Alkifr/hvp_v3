import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DataGrid, { type Column } from "react-data-grid";
import { useQueryClient } from "@tanstack/react-query";
import "react-data-grid/lib/styles.css";

import { apiPatch } from "../../lib/api";
import { wrappedBlockSize } from "../../lib/towColumnLayout";
import { formatMskDateTime } from "../../lib/localDate";
import { registryAutoNote, registryNoteText } from "../../lib/towRegistryNote";
import { layoutColumn, TowColumnMenu, TowText, towHeaderContextPoint, useTowColumnLayout, type TowColumnMenuPoint, type TowColumnSpec } from "./TowColumnMenu";

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
  /** Текст «Информация для буксировки ВС» на событии, без подстановки старого комментария буксировки. */
  registryPosition?: string;
  eventType?: string;
  parkedStand?: string;
  toSlotEndMsk: string;
  toSlotDuration: string;
  positionComment: string;
  startChangeReason: string;
};

type DataGridRow = TowReportRow & { kind: "data" };
type HangarGridRow = { kind: "hangar"; id: string; label: string };
type GridRow = DataGridRow | HangarGridRow;

const EDITABLE = new Set(["notes", "positionComment", "startChangeReason"]);

type NoteDraft = { notes: string; positionComment: string; startChangeReason: string };

function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function rowHasTow(row: TowReportRow): boolean {
  return Boolean(row.plannedStartAt) && !row.id.startsWith("plan:");
}

function shownDraft(row: TowReportRow, drafts: Record<string, NoteDraft>): NoteDraft {
  return drafts[row.id] ?? {
    notes: registryNoteText(row),
    positionComment: row.positionComment,
    startChangeReason: row.startChangeReason
  };
}

function notesToSave(row: TowReportRow, notes: string): string {
  const next = notes.trim();
  if (!row.notes.trim() && next === registryAutoNote(row)) return "";
  return next;
}

function draftDirty(row: TowReportRow, draft: NoteDraft): boolean {
  return notesToSave(row, draft.notes) !== row.notes.trim()
    || draft.positionComment.trim() !== row.positionComment.trim()
    || draft.startChangeReason.trim() !== row.startChangeReason.trim();
}

const REGISTRY_COLUMNS: TowColumnSpec[] = [
  { key: "seq", label: "№", width: 48 },
  { key: "aircraftType", label: "Тип ВС", width: 100 },
  { key: "tailNumber", label: "Бортовой номер", width: 124 },
  { key: "operator", label: "Оператор", width: 116 },
  { key: "fromStand", label: "Откуда (с МС)", width: 108 },
  { key: "toStand", label: "Куда (на МС)", width: 108 },
  { key: "plannedStartMsk", label: "Плановое время начала буксировки (мск)", width: 176 },
  { key: "standOccupancy", label: "Требуемая продолжительность занятия МС", width: 210 },
  { key: "notes", label: "Примечание", width: 280 },
  { key: "toSlotDuration", label: "Продолжительность слотов ТО", width: 176 },
  { key: "positionComment", label: "Позиция", width: 160 },
  { key: "startChangeReason", label: "Причина изменения времени начала буксировки (<60 мин)", width: 220 }
];

function reportCellText(row: DataGridRow, key: string, drafts: Record<string, NoteDraft>): string {
  const draft = shownDraft(row, drafts);
  switch (key) {
    case "seq":
      return String(row.seq);
    case "aircraftType":
      return row.aircraftType || "—";
    case "tailNumber":
      return row.tailNumber || "—";
    case "operator":
      return row.operator || "—";
    case "fromStand":
      return row.fromStand || "—";
    case "toStand":
      return row.toStand || "—";
    case "plannedStartMsk":
      return row.plannedStartMsk || "—";
    case "standOccupancy":
      return occupancyText(row);
    case "notes":
      return draft.notes;
    case "toSlotDuration":
      return slotLabel(row) || "—";
    case "positionComment":
      return draft.positionComment;
    case "startChangeReason":
      return draft.startChangeReason;
    default:
      return "";
  }
}

function withHangarBand(columns: Column<GridRow>[]): Column<GridRow>[] {
  if (!columns.length) return columns;
  const [first, ...rest] = columns;
  const renderCell = first.renderCell;
  return [
    {
      ...first,
      colSpan: (args) => (args.type === "ROW" && args.row.kind === "hangar" ? columns.length : undefined),
      renderCell: (props) => {
        if (props.row.kind === "hangar") return <TowText>{props.row.label}</TowText>;
        return renderCell?.(props) ?? null;
      }
    },
    ...rest
  ];
}

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

function occupancyText(row: TowReportRow): string {
  if (!row.plannedStartAt) return "";
  const start = formatMskDateTime(row.plannedStartAt);
  const endIso = row.occupancyEndAt || row.inferredOccupancyEndAt;
  const end = endIso ? formatMskDateTime(endIso) : "";
  if (!start && !end) return "";
  return `${start || "—"} - ${end || "—"}`;
}

function slotLabel(row: TowReportRow): string {
  return row.toSlotEndMsk ? `Слот до ${row.toSlotEndMsk} мск` : row.toSlotDuration || "";
}

function asDataRow(row: TowReportRow): DataGridRow {
  return { ...row, kind: "data" };
}

export function TowReportTable({
  items,
  canWrite,
  onDirtyChange,
  barExtra,
  belowBar
}: {
  items: TowReportRow[];
  canWrite: boolean;
  canGantt?: boolean;
  onOpenEvent?: (eventId: string) => void;
  onDirtyChange: (count: number) => void;
  barExtra?: ReactNode;
  belowBar?: ReactNode;
}) {
  const qc = useQueryClient();
  const layout = useTowColumnLayout("hangarPlanning:towsRegistryColumns:v2", REGISTRY_COLUMNS);
  const [columnMenu, setColumnMenu] = useState<TowColumnMenuPoint | null>(null);
  const [drafts, setDrafts] = useState<Record<string, NoteDraft>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const closeColumnMenu = useCallback(() => setColumnMenu(null), []);
  const rows = useMemo(() => items.map(asDataRow), [items]);
  const dirtyCount = useMemo(
    () => items.reduce((count, row) => count + (drafts[row.id] && draftDirty(row, drafts[row.id]) ? 1 : 0), 0),
    [items, drafts]
  );

  useEffect(() => {
    onDirtyChange(dirtyCount);
  }, [dirtyCount, onDirtyChange]);

  const setField = useCallback((row: TowReportRow, field: keyof NoteDraft, value: string) => {
    setDrafts((prev) => {
      const next = { ...shownDraft(row, prev), [field]: value };
      if (!draftDirty(row, next)) {
        if (!prev[row.id]) return prev;
        const rest = { ...prev };
        delete rest[row.id];
        return rest;
      }
      return { ...prev, [row.id]: next };
    });
  }, []);

  const undo = () => {
    if (pending) return;
    setDrafts({});
    setError("");
  };

  const save = async () => {
    const dirty = items.filter((row) => drafts[row.id] && draftDirty(row, drafts[row.id]));
    if (!dirty.length || pending) return;
    setPending(true);
    setError("");
    const saved: string[] = [];
    try {
      for (const row of dirty) {
        const draft = drafts[row.id];
        if (!draft) continue;
        const notes = notesToSave(row, draft.notes);
        const reason = draft.startChangeReason.trim();
        const position = draft.positionComment.trim();
        const notesDirty = notes !== row.notes.trim() || reason !== row.startChangeReason.trim();
        const positionDirty = position !== (row.registryPosition ?? "").trim() || position !== row.positionComment.trim();
        if (notesDirty && rowHasTow(row)) {
          await apiPatch(`/api/tows/${row.id}`, { notes, startChangeReason: reason, changeReason: "Реестр" });
        }
        const eventBody: { notes?: string; positionComment?: string; startChangeReason?: string; changeReason: string } = {
          changeReason: "Реестр"
        };
        if (!rowHasTow(row) && notesDirty) {
          eventBody.notes = notes;
          eventBody.startChangeReason = reason;
        }
        if (positionDirty) eventBody.positionComment = position;
        if (eventBody.notes !== undefined || eventBody.positionComment !== undefined || eventBody.startChangeReason !== undefined) {
          await apiPatch(`/api/tows/events/${row.eventId}/registry`, eventBody);
        }
        saved.push(row.id);
      }
    } catch (saveError) {
      setError(String((saveError as Error).message ?? saveError));
    } finally {
      if (saved.length) {
        await Promise.all([
          qc.refetchQueries({ queryKey: ["tows-plan"] }, { cancelRefetch: true }),
          qc.refetchQueries({ queryKey: ["tows-report"] }, { cancelRefetch: true })
        ]);
        setDrafts((prev) => {
          const next = { ...prev };
          for (const id of saved) delete next[id];
          return next;
        });
      }
      setPending(false);
    }
  };

  const grouped = useMemo(() => withHangarBands(rows), [rows, drafts]);
  const cellClass = (key: string) => (row: GridRow) => {
    if (row.kind === "hangar") return "towHangarBand";
    if (!canWrite || !EDITABLE.has(key)) return "towGridReadonly";
    return undefined;
  };
  const columns = useMemo<Column<GridRow>[]>(() => {
    const text = (row: GridRow, value: string) => (row.kind === "data" ? <TowText>{value}</TowText> : null);
    const editor = (row: GridRow, field: keyof NoteDraft, label: string) => {
      if (row.kind !== "data") return null;
      const value = shownDraft(row, draftsRef.current)[field];
      if (!canWrite) return <TowText>{value}</TowText>;
      return (
        <textarea
          className="towGridInput"
          value={value}
          disabled={pending}
          aria-label={label}
          rows={1}
          onChange={(event) => setField(row, field, event.target.value)}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        />
      );
    };
    const built: Column<GridRow>[] = [
      {
        key: "seq",
        name: "№",
        width: 48,
        cellClass: cellClass("seq"),
        renderCell: ({ row }) => text(row, String(row.kind === "data" ? row.seq : ""))
      },
      { key: "aircraftType", name: "Тип ВС", width: 100, cellClass: cellClass("aircraftType"), renderCell: ({ row }) => text(row, row.kind === "data" ? row.aircraftType || "—" : "") },
      { key: "tailNumber", name: "Бортовой номер", width: 124, cellClass: cellClass("tailNumber"), renderCell: ({ row }) => text(row, row.kind === "data" ? row.tailNumber || "—" : "") },
      { key: "operator", name: "Оператор", width: 116, cellClass: cellClass("operator"), renderCell: ({ row }) => text(row, row.kind === "data" ? row.operator || "—" : "") },
      { key: "fromStand", name: "Откуда (с МС)", width: 108, cellClass: cellClass("fromStand"), renderCell: ({ row }) => text(row, row.kind === "data" ? row.fromStand || "—" : "") },
      { key: "toStand", name: "Куда (на МС)", width: 108, cellClass: cellClass("toStand"), renderCell: ({ row }) => text(row, row.kind === "data" ? row.toStand || "—" : "") },
      { key: "plannedStartMsk", name: "Плановое время начала буксировки (мск)", width: 176, cellClass: cellClass("plannedStartMsk"), renderCell: ({ row }) => text(row, row.kind === "data" ? row.plannedStartMsk || "—" : "") },
      {
        key: "standOccupancy",
        name: "Требуемая продолжительность занятия МС",
        width: 210,
        cellClass: cellClass("standOccupancy"),
        renderCell: ({ row }) => text(row, row.kind === "data" ? occupancyText(row) : "")
      },
      {
        key: "notes",
        name: "Примечание",
        width: 280,
        cellClass: cellClass("notes"),
        renderCell: ({ row }) => editor(row, "notes", "Примечание")
      },
      { key: "toSlotDuration", name: "Продолжительность слотов ТО", width: 176, cellClass: cellClass("toSlotDuration"), renderCell: ({ row }) => text(row, row.kind === "data" ? slotLabel(row) || "—" : "") },
      {
        key: "positionComment",
        name: "Позиция",
        width: 160,
        cellClass: cellClass("positionComment"),
        renderCell: ({ row }) => editor(row, "positionComment", "Позиция")
      },
      {
        key: "startChangeReason",
        name: "Причина изменения времени начала буксировки (<60 мин)",
        width: 220,
        cellClass: cellClass("startChangeReason"),
        renderCell: ({ row }) => editor(row, "startChangeReason", "Причина изменения")
      }
    ];
    const visible = new Set(layout.visibleKeys);
    return withHangarBand(
      built
        .filter((column) => visible.has(column.key))
        .map((column) => layoutColumn(column, layout.widthOf(column.key, typeof column.width === "number" ? column.width : 120)))
    );
  }, [canWrite, layout.visibleKeys, layout.widthOf, pending, setField]);
  const headerRowHeight = useMemo(
    () =>
      wrappedBlockSize(
        columns
          .filter((column) => typeof column.name === "string" && column.name)
          .map((column) => ({ text: String(column.name), width: typeof column.width === "number" ? column.width : 120 })),
        44,
        132
      ),
    [columns]
  );
  const rowHeight = useCallback(
    (row: GridRow) => {
      if (row.kind === "hangar") return 36;
      return wrappedBlockSize(
        columns.map((column) => ({ text: row.kind === "data" ? reportCellText(row, column.key, draftsRef.current) : "", width: typeof column.width === "number" ? column.width : 120 }))
      );
    },
    [columns, drafts]
  );

  return (
    <>
      {canWrite || barExtra ? (
        <div className="towGridActionBar">
          {canWrite ? (
            <>
              <button className="btn btnPrimary towGridIconBtn" type="button" disabled={pending || dirtyCount === 0} onClick={() => void save()} aria-label="Сохранить" title="Сохранить">
                <ActionIcon><path d="M5 12.5 10 17l9-10" /></ActionIcon>
              </button>
              <button className="btn towGridIconBtn" type="button" disabled={pending || dirtyCount === 0} onClick={undo} aria-label="Отменить" title="Отменить">
                <ActionIcon>
                  <path d="M8 7H4v4" />
                  <path d="M4 11a8 8 0 1 0 2.2-5.5L4 8" />
                </ActionIcon>
              </button>
            </>
          ) : null}
          {barExtra ? <span className="towsFixBeside">{barExtra}</span> : null}
          {canWrite && dirtyCount > 0 ? <span className="muted">Несохранённых строк: {dirtyCount}</span> : null}
        </div>
      ) : null}
      {belowBar}
      {error ? <div className="error">{error}</div> : null}
      <div onContextMenu={(event) => {
        const point = towHeaderContextPoint(event);
        if (point) setColumnMenu(point);
      }}>
        <DataGrid
          className="rdg-light towGrid"
          columns={columns}
          rows={grouped}
          rowKeyGetter={(row) => row.id}
          onColumnResize={(idx, width) => {
            const key = columns[idx]?.key;
            if (key) layout.resize(key, width);
          }}
          rowClass={(row) => (row.kind === "hangar" ? "towHangarBand" : undefined)}
          headerRowHeight={headerRowHeight}
          rowHeight={rowHeight}
          style={{ blockSize: "max(360px, calc(100vh - 340px))" }}
        />
      </div>
      <TowColumnMenu specs={REGISTRY_COLUMNS} hidden={layout.hidden} onShown={layout.setShown} point={columnMenu} onClose={closeColumnMenu} />
      {rows.length === 0 ? <div className="muted towGridEmpty">В этом периоде нет событий. Отмеченные «Не требуется» скрыты.</div> : null}
    </>
  );
}
