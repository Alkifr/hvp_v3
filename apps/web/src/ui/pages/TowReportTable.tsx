import { useCallback, useEffect, useMemo, useState } from "react";
import DataGrid, { type Column } from "react-data-grid";
import "react-data-grid/lib/styles.css";

import { wrappedBlockSize } from "../../lib/towColumnLayout";
import { formatMskDateTime } from "../../lib/localDate";
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
  toSlotEndMsk: string;
  toSlotDuration: string;
  positionComment: string;
  startChangeReason: string;
};

type DataGridRow = TowReportRow & { kind: "data" };
type HangarGridRow = { kind: "hangar"; id: string; label: string };
type GridRow = DataGridRow | HangarGridRow;

const REGISTRY_COLUMNS: TowColumnSpec[] = [
  { key: "seq", label: "№", width: 48 },
  { key: "aircraftType", label: "Тип ВС", width: 100 },
  { key: "tailNumber", label: "Бортовой номер", width: 124 },
  { key: "operator", label: "Оператор", width: 116 },
  { key: "fromStand", label: "Откуда (с МС)", width: 108 },
  { key: "toStand", label: "Куда (на МС)", width: 108 },
  { key: "plannedStartMsk", label: "Плановое время начала буксировки (мск)", width: 176 },
  { key: "standOccupancy", label: "Требуемая продолжительность занятия МС", width: 210 },
  { key: "notes", label: "Примечание", width: 160 },
  { key: "toSlotDuration", label: "Продолжительность слотов ТО", width: 176 },
  { key: "positionComment", label: "Позиция", width: 140 },
  { key: "startChangeReason", label: "Причина изменения времени начала буксировки (<60 мин)", width: 200 }
];

function reportCellText(row: DataGridRow, key: string): string {
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
      return row.notes;
    case "toSlotDuration":
      return slotLabel(row) || "—";
    case "positionComment":
      return row.positionComment;
    case "startChangeReason":
      return row.startChangeReason;
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
  onDirtyChange
}: {
  items: TowReportRow[];
  canWrite: boolean;
  canGantt?: boolean;
  onOpenEvent?: (eventId: string) => void;
  onDirtyChange: (count: number) => void;
}) {
  const layout = useTowColumnLayout("hangarPlanning:towsRegistryColumns:v2", REGISTRY_COLUMNS);
  const [columnMenu, setColumnMenu] = useState<TowColumnMenuPoint | null>(null);
  const closeColumnMenu = useCallback(() => setColumnMenu(null), []);
  const rows = useMemo(() => items.map(asDataRow), [items]);

  useEffect(() => {
    onDirtyChange(0);
  }, [onDirtyChange]);

  const grouped = useMemo(() => withHangarBands(rows), [rows]);
  const lockedClass = (row: GridRow) => (row.kind === "hangar" ? "towHangarBand" : canWrite ? undefined : "towGridReadonly");
  const columns = useMemo<Column<GridRow>[]>(() => {
    const text = (row: GridRow, value: string) => (row.kind === "data" ? <TowText>{value}</TowText> : null);
    const built: Column<GridRow>[] = [
      {
        key: "seq",
        name: "№",
        width: 48,
        cellClass: lockedClass,
        renderCell: ({ row }) => text(row, String(row.kind === "data" ? row.seq : ""))
      },
      { key: "aircraftType", name: "Тип ВС", width: 100, cellClass: lockedClass, renderCell: ({ row }) => text(row, row.kind === "data" ? row.aircraftType || "—" : "") },
      { key: "tailNumber", name: "Бортовой номер", width: 124, cellClass: lockedClass, renderCell: ({ row }) => text(row, row.kind === "data" ? row.tailNumber || "—" : "") },
      { key: "operator", name: "Оператор", width: 116, cellClass: lockedClass, renderCell: ({ row }) => text(row, row.kind === "data" ? row.operator || "—" : "") },
      { key: "fromStand", name: "Откуда (с МС)", width: 108, cellClass: lockedClass, renderCell: ({ row }) => text(row, row.kind === "data" ? row.fromStand || "—" : "") },
      { key: "toStand", name: "Куда (на МС)", width: 108, cellClass: lockedClass, renderCell: ({ row }) => text(row, row.kind === "data" ? row.toStand || "—" : "") },
      { key: "plannedStartMsk", name: "Плановое время начала буксировки (мск)", width: 176, cellClass: lockedClass, renderCell: ({ row }) => text(row, row.kind === "data" ? row.plannedStartMsk || "—" : "") },
      {
        key: "standOccupancy",
        name: "Требуемая продолжительность занятия МС",
        width: 210,
        cellClass: lockedClass,
        renderCell: ({ row }) => text(row, row.kind === "data" ? occupancyText(row) : "")
      },
      {
        key: "notes",
        name: "Примечание",
        width: 160,
        cellClass: lockedClass,
        renderCell: ({ row }) => text(row, row.kind === "data" ? row.notes : "")
      },
      { key: "toSlotDuration", name: "Продолжительность слотов ТО", width: 176, cellClass: lockedClass, renderCell: ({ row }) => text(row, row.kind === "data" ? slotLabel(row) || "—" : "") },
      {
        key: "positionComment",
        name: "Позиция",
        width: 140,
        cellClass: lockedClass,
        renderCell: ({ row }) => text(row, row.kind === "data" ? row.positionComment : "")
      },
      {
        key: "startChangeReason",
        name: "Причина изменения времени начала буксировки (<60 мин)",
        width: 200,
        cellClass: lockedClass,
        renderCell: ({ row }) => text(row, row.kind === "data" ? row.startChangeReason : "")
      }
    ];
    const visible = new Set(layout.visibleKeys);
    return withHangarBand(
      built
        .filter((column) => visible.has(column.key))
        .map((column) => layoutColumn(column, layout.widthOf(column.key, typeof column.width === "number" ? column.width : 120)))
    );
  }, [canWrite, layout.visibleKeys, layout.widthOf]);
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
        columns.map((column) => ({ text: row.kind === "data" ? reportCellText(row, column.key) : "", width: typeof column.width === "number" ? column.width : 120 }))
      );
    },
    [columns]
  );

  return (
    <>
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
