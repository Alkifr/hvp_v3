import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataGrid, { type Column, type RenderEditCellProps } from "react-data-grid";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import "react-data-grid/lib/styles.css";

import { apiDelete, apiPatch, apiPost } from "../../lib/api";
import { formatMskDateTime, fromInputMskOptional, nextTowEndLocal, toInputMsk } from "../../lib/localDate";
import { safeRandomUuid } from "../../lib/randomId";
import { wrappedBlockSize } from "../../lib/towColumnLayout";
import { placeAddedRows } from "../../lib/towPlanCopies";
import { TowActionBar, TowCreateDialog } from "./TowActionBar";
import { layoutColumn, TowColumnMenu, TowText, towHeaderContextPoint, useTowColumnLayout, type TowColumnMenuPoint, type TowColumnSpec } from "./TowColumnMenu";
import type { TowReportRow } from "./TowReportTable";

export type TowPlanRow = {
  id: string;
  towId: string;
  eventId: string;
  locked: boolean;
  hangarId: string;
  hangars: Array<{ id: string; label: string }>;
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  eventTitle: string;
  eventType: string;
  hangarNumber: string;
  layoutName: string;
  parkedStand: string;
  fromStand: string;
  toStand: string;
  eventStartAt: string;
  eventEndAt: string;
  eventStartMsk: string;
  eventEndMsk: string;
  towStartAt: string;
  towEndAt: string;
  standOccupancy: string;
  placementId: string;
  createdAt: string;
  isNew: boolean;
  standOptions: string[];
  skipped?: boolean;
  registryNotes?: string;
  registryPosition?: string;
  registryStartReason?: string;
};

type GridRow = TowPlanRow & {
  startLocal: string;
  endLocal: string;
  reason: string;
  added?: boolean;
  copyAnchorId?: string;
};

const READONLY = "towGridReadonly";

function toGrid(row: TowPlanRow): GridRow {
  return {
    ...row,
    standOptions: row.standOptions?.length ? row.standOptions : ["МС"],
    startLocal: row.towStartAt ? toInputMsk(row.towStartAt) : "",
    endLocal: row.towEndAt ? toInputMsk(row.towEndAt) : "",
    reason: "",
    skipped: row.skipped === true
  };
}

function standChoices(row: GridRow, value: string): string[] {
  if (!value || row.standOptions.includes(value)) return row.standOptions;
  return [value, ...row.standOptions];
}

function isDirty(source: TowPlanRow, row: GridRow): boolean {
  return (
    row.fromStand !== source.fromStand ||
    row.toStand !== source.toStand ||
    row.startLocal !== (source.towStartAt ? toInputMsk(source.towStartAt) : "") ||
    row.endLocal !== (source.towEndAt ? toInputMsk(source.towEndAt) : "") ||
    row.reason.trim() !== ""
  );
}

function durationLabel(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

function occupancyOf(row: GridRow): string {
  const savedStart = row.towStartAt ? toInputMsk(row.towStartAt) : "";
  if (row.startLocal === savedStart && row.standOccupancy) return row.standOccupancy;
  const startIso = fromInputMskOptional(row.startLocal);
  if (!startIso || !row.eventEndAt) return row.standOccupancy || "";
  return durationLabel(startIso, row.eventEndAt) || row.standOccupancy || "";
}

function missingFields(row: GridRow): Array<"from" | "to" | "start" | "end"> {
  const from = row.fromStand.trim();
  const to = row.toStand.trim();
  const hasDates = Boolean(row.startLocal || row.endLocal);
  const hasRoute = Boolean(from || to);
  if (!hasDates && !hasRoute) return [];
  const missing: Array<"from" | "to" | "start" | "end"> = [];
  if (!from) missing.push("from");
  if (!to) missing.push("to");
  if (!row.startLocal) missing.push("start");
  if (!row.endLocal) missing.push("end");
  return missing;
}

export function refreshTowLists(qc: QueryClient) {
  return Promise.all([
    qc.refetchQueries({ queryKey: ["tows-plan"] }, { cancelRefetch: true }),
    qc.refetchQueries({ queryKey: ["tows-report"] }, { cancelRefetch: true })
  ]);
}

function reportRowFromPlan(row: GridRow, towId: string): TowReportRow {
  const startIso = fromInputMskOptional(row.startLocal) ?? "";
  const endIso = fromInputMskOptional(row.endLocal) ?? "";
  return {
    id: towId,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    eventStatus: "",
    seq: 0,
    direction: "",
    directionLabel: "",
    hangarId: row.hangarId,
    hangarNumber: row.hangarNumber,
    aircraftTypeId: row.aircraftTypeId,
    aircraftType: row.aircraftType,
    aircraftId: row.aircraftId,
    tailNumber: row.tailNumber,
    operatorId: row.operatorId,
    operator: row.operator,
    fromStand: row.fromStand,
    toStand: row.toStand,
    plannedStartAt: startIso,
    plannedStartMsk: startIso ? formatMskDateTime(startIso) : "",
    plannedEndAt: endIso,
    plannedEndMsk: endIso ? formatMskDateTime(endIso) : "",
    occupancyEndAt: "",
    occupancyEndMsk: "",
    inferredOccupancyEndAt: endIso,
    standOccupancy: row.standOccupancy || "",
    notes: "",
    toSlotEndMsk: "",
    toSlotDuration: "",
    positionComment: "",
    startChangeReason: row.reason.trim()
  };
}

function putReportRow(qc: QueryClient, towId: string, next: TowReportRow | null) {
  qc.setQueriesData<{ items: TowReportRow[] }>({ queryKey: ["tows-report"] }, (current) => {
    if (!current) return current;
    const rest = current.items.filter((item) => item.id !== towId);
    return { ...current, items: next ? [...rest, next] : rest };
  });
}

function visibleSame(local: GridRow, item: TowPlanRow): boolean {
  const options = item.standOptions?.length ? item.standOptions : ["МС"];
  return (
    local.towId === item.towId &&
    local.fromStand === item.fromStand &&
    local.toStand === item.toStand &&
    local.isNew === item.isNew &&
    local.locked === item.locked &&
    local.eventTitle === item.eventTitle &&
    local.eventType === item.eventType &&
    local.hangarNumber === item.hangarNumber &&
    local.layoutName === item.layoutName &&
    local.parkedStand === item.parkedStand &&
    local.standOccupancy === item.standOccupancy &&
    local.eventStartMsk === item.eventStartMsk &&
    local.eventEndMsk === item.eventEndMsk &&
    local.tailNumber === item.tailNumber &&
    local.operator === item.operator &&
    local.aircraftType === item.aircraftType &&
    local.startLocal === (item.towStartAt ? toInputMsk(item.towStartAt) : "") &&
    local.endLocal === (item.towEndAt ? toInputMsk(item.towEndAt) : "") &&
    local.reason === "" &&
    local.skipped === (item.skipped === true) &&
    local.standOptions.join("|") === options.join("|")
  );
}

function shortShift(row: GridRow): boolean {
  if (!row.towId || !row.towStartAt || !row.startLocal) return false;
  const next = fromInputMskOptional(row.startLocal);
  if (!next) return false;
  const minutes = Math.abs(new Date(next).getTime() - new Date(row.towStartAt).getTime()) / 60_000;
  return minutes > 0 && minutes < 60;
}

function messageRowHeight(text: string, extra = 0): number {
  if (!text && !extra) return 42;
  const lines = text ? Math.ceil(text.length / 26) : 0;
  return 40 + extra + lines * 18;
}

function formatLocalMsk(value: string): string {
  const iso = fromInputMskOptional(value);
  return iso ? formatMskDateTime(iso) : "";
}

const PLAN_COLUMNS: TowColumnSpec[] = [
  { key: "select", label: "Выбор", width: 44, locked: true },
  { key: "isNew", label: "Статус", width: 100 },
  { key: "aircraftType", label: "Тип ВС", width: 110 },
  { key: "tailNumber", label: "Борт", width: 120 },
  { key: "eventTitle", label: "Название события", width: 180 },
  { key: "eventType", label: "Тип события", width: 150 },
  { key: "operator", label: "Оператор", width: 130 },
  { key: "hangarNumber", label: "Номер ангара", width: 120 },
  { key: "layoutName", label: "Вариант расстановки", width: 170 },
  { key: "parkedStand", label: "Номер стоянки", width: 140 },
  { key: "fromStand", label: "Откуда (с МС)", width: 150 },
  { key: "toStand", label: "Куда (на МС)", width: 150 },
  { key: "eventStartMsk", label: "Начало события", width: 160 },
  { key: "eventEndMsk", label: "Окончание события", width: 170 },
  { key: "startLocal", label: "Начало буксировки", width: 170 },
  { key: "endLocal", label: "Окончание буксировки", width: 180, defaultHidden: true },
  { key: "standOccupancy", label: "Продолжительность занятия МС", width: 180 }
];

function planCellText(row: GridRow, key: string): string {
  switch (key) {
    case "isNew":
      return row.added ? "Добавлено" : row.skipped ? "Не требуется" : row.isNew ? "Новое" : "—";
    case "aircraftType":
      return row.aircraftType;
    case "tailNumber":
      return row.tailNumber;
    case "eventTitle":
      return row.eventTitle || "—";
    case "eventType":
      return row.eventType || "—";
    case "operator":
      return row.operator;
    case "hangarNumber":
      return row.hangarNumber || "—";
    case "layoutName":
      return row.layoutName || "—";
    case "parkedStand":
      return row.parkedStand || "—";
    case "fromStand":
      return row.fromStand || "—";
    case "toStand":
      return row.toStand || "—";
    case "eventStartMsk":
      return row.eventStartMsk || "—";
    case "eventEndMsk":
      return row.eventEndMsk || "—";
    case "startLocal":
      return formatLocalMsk(row.startLocal) || "—";
    case "endLocal":
      return formatLocalMsk(row.endLocal) || "—";
    case "standOccupancy":
      return occupancyOf(row) || "—";
    default:
      return "";
  }
}

function copyPlanRow(source: GridRow): GridRow {
  return {
    ...source,
    id: `copy-${safeRandomUuid()}`,
    towId: "",
    towStartAt: "",
    towEndAt: "",
    standOccupancy: "",
    reason: "",
    isNew: false,
    added: true,
    copyAnchorId: source.added ? source.copyAnchorId || source.id : source.id
  };
}

function copyIncomplete(row: GridRow): boolean {
  return Boolean(row.added) && (!row.fromStand.trim() || !row.toStand.trim() || !row.startLocal || !row.endLocal);
}

function withDefaultEnd(row: GridRow): GridRow {
  if (row.endLocal || !row.startLocal) return row;
  const endLocal = nextTowEndLocal("", "", row.startLocal);
  return endLocal ? { ...row, endLocal } : row;
}

function DateTimeEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<GridRow>) {
  const key = column.key as "startLocal" | "endLocal";
  return (
    <input
      autoFocus
      className="towGridInput"
      type="datetime-local"
      value={row[key]}
      onChange={(event) => {
        const value = event.target.value;
        if (key === "startLocal") {
          onRowChange({ ...row, startLocal: value, endLocal: nextTowEndLocal(row.startLocal, row.endLocal, value) });
          return;
        }
        onRowChange({ ...row, endLocal: value });
      }}
      onBlur={() => onClose(true)}
    />
  );
}

export function TowPlanGrid({
  items,
  canWrite,
  dataUpdatedAt,
  onDirtyChange
}: {
  items: TowPlanRow[];
  canWrite: boolean;
  dataUpdatedAt: number;
  onDirtyChange: (count: number) => void;
}) {
  const qc = useQueryClient();
  const layout = useTowColumnLayout("hangarPlanning:towsPlanColumns:v1", PLAN_COLUMNS);
  const [columnMenu, setColumnMenu] = useState<TowColumnMenuPoint | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const closeColumnMenu = useCallback(() => setColumnMenu(null), []);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Record<string, { kind: "save" | "delete"; row: GridRow; after: number }>>({});
  const [committed, setCommitted] = useState<Record<string, TowPlanRow>>({});
  const itemsRef = useRef(items);
  const errorsRef = useRef(errors);
  const noticesRef = useRef(notices);
  const committedRef = useRef(committed);
  const pendingRef = useRef<string | null>(null);
  itemsRef.current = items;
  errorsRef.current = errors;
  noticesRef.current = notices;
  committedRef.current = committed;

  useEffect(() => {
    const note = "Сохранено. Буксировка не входит в выбранный период, поэтому в этой строке её нет.";
    const outside: Record<string, string> = {};
    const consumed = new Set<string>();
    const fresh = (pending: { after: number }) => dataUpdatedAt !== pending.after;
    const towShown = (pending: { row: GridRow }) =>
      items.some(
        (item) =>
          item.eventId === pending.row.eventId &&
          item.towId &&
          item.fromStand === pending.row.fromStand &&
          item.toStand === pending.row.toStand &&
          (item.towStartAt ? toInputMsk(item.towStartAt) : "") === pending.row.startLocal &&
          (item.towEndAt ? toInputMsk(item.towEndAt) : "") === pending.row.endLocal
      );
    for (const [id, pending] of Object.entries(accepted)) {
      if (!fresh(pending) || items.some((item) => item.id === id)) continue;
      consumed.add(id);
      if (pending.kind !== "save" || towShown(pending)) continue;
      const blank = items.find((item) => item.eventId === pending.row.eventId && !item.towId);
      if (blank) outside[blank.id] = note;
    }
    setRows((prev) => {
      const byId = new Map(prev.map((row) => [row.id, row]));
      const next = items.map((item) => {
        const pending = accepted[item.id];
        const saved = committed[item.id];
        const local = byId.get(item.id);
          if (pending && fresh(pending)) {
            consumed.add(item.id);
            if (pending.kind === "save" && !towShown(pending)) outside[item.id] = note;
            const grid = local && visibleSame(local, item) ? local : toGrid(item);
            return outside[item.id] && grid === local ? { ...grid } : grid;
          }
        const base = saved ?? item;
        if (item.skipped) return toGrid(item);
        if (!local) return toGrid(item);
        if (isDirty(base, local)) {
          if (
            local.eventTitle === item.eventTitle &&
            local.hangarNumber === item.hangarNumber &&
            local.layoutName === item.layoutName &&
            local.parkedStand === item.parkedStand &&
            local.eventStartMsk === item.eventStartMsk &&
            local.eventEndMsk === item.eventEndMsk
          ) {
            return local;
          }
          return { ...toGrid(item), fromStand: local.fromStand, toStand: local.toStand, startLocal: local.startLocal, endLocal: local.endLocal, reason: local.reason };
        }
        if (saved && !visibleSame(local, item)) return local;
        return visibleSame(local, item) ? local : toGrid(item);
      });
      const placed = placeAddedRows(
        next,
        prev.filter((row) => row.added)
      );
      if (placed.length === prev.length && placed.every((row, index) => row === prev[index])) return prev;
      return placed;
    });
    if (Object.keys(outside).length) setNotices((prev) => ({ ...prev, ...outside }));
    if (consumed.size) {
      setAccepted((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of consumed) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [accepted, committed, dataUpdatedAt, items]);

  useEffect(() => {
    setCommitted((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, snap] of Object.entries(prev)) {
        const item = items.find((row) => row.id === id);
        const caughtUp =
          !item ||
          (item.towId === snap.towId &&
            item.fromStand === snap.fromStand &&
            item.toStand === snap.toStand &&
            (item.towStartAt ? toInputMsk(item.towStartAt) : "") === (snap.towStartAt ? toInputMsk(snap.towStartAt) : "") &&
            (item.towEndAt ? toInputMsk(item.towEndAt) : "") === (snap.towEndAt ? toInputMsk(snap.towEndAt) : ""));
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
      if (row.added) return true;
      const item = source.get(row.id);
      return item ? isDirty(item, row) : false;
    }).length;
  }, [committed, items, rows]);

  useEffect(() => {
    onDirtyChange(dirtyCount);
  }, [dirtyCount, onDirtyChange]);

  const run = useMutation({
    mutationFn: async (action: { kind: "save"; row: GridRow } | { kind: "delete"; row: GridRow }) => {
      if (action.kind === "delete") {
        const query = new URLSearchParams({ changeReason: "Снятие буксировки" });
        return apiDelete(`/api/events/${action.row.eventId}/tows/${action.row.towId}?${query.toString()}`);
      }
      const row = withDefaultEnd(action.row);
      if (copyIncomplete(row)) throw new Error("Заполните откуда, куда, начало и окончание");
      if (missingFields(row).length) return;
      const startIso = fromInputMskOptional(row.startLocal);
      const endIso = fromInputMskOptional(row.endLocal);
      if (!startIso || !endIso) throw new Error("Укажите начало и окончание буксировки");
      if (row.towId) {
        const startChanged = row.startLocal !== toInputMsk(row.towStartAt);
        if (startChanged && shortShift(row) && !row.reason.trim()) {
          throw new Error("Сдвиг начала меньше 60 минут. Укажите причину");
        }
        return apiPatch(`/api/tows/${row.towId}`, {
          fromLabel: row.fromStand.trim() || null,
          toLabel: row.toStand.trim() || null,
          startAt: startChanged ? startIso : undefined,
          endAt: row.endLocal !== toInputMsk(row.towEndAt) ? endIso : undefined,
          placementId: row.placementId || undefined,
          startChangeReason: row.reason.trim() || undefined,
          changeReason: row.reason.trim() || "План"
        });
      }
      return apiPost(`/api/events/${row.eventId}/tows`, {
        startAt: startIso,
        endAt: endIso,
        placementId: row.placementId || null,
        fromLabel: row.fromStand.trim() || null,
        toLabel: row.toStand.trim() || null,
        changeReason: "Буксировка"
      });
    },
    onMutate: (action) => {
      pendingRef.current = action.row.id;
      setRows((current) => current.map((item) => (item.id === action.row.id ? { ...item } : item)));
    },
    onSuccess: (data, action) => {
      pendingRef.current = null;
      const row = action.kind === "save" ? withDefaultEnd(action.row) : action.row;
      if (action.kind === "save" && missingFields(row).length) return;
      setErrors((prev) => ({ ...prev, [row.id]: "" }));
      setNotices((prev) => ({ ...prev, [row.id]: "" }));
      setAccepted((prev) => ({ ...prev, [row.id]: { ...action, row, after: dataUpdatedAt } }));
      if (action.kind === "delete") {
        putReportRow(qc, row.towId, null);
      } else {
        const createdId = !row.towId && data && typeof data === "object" && "id" in data ? String((data as { id?: string }).id ?? "") : "";
        const towId = row.towId || createdId;
        const startIso = fromInputMskOptional(row.startLocal) ?? "";
        const endIso = fromInputMskOptional(row.endLocal) ?? "";
        const source = itemsRef.current.find((item) => item.id === row.id);
        if (source) {
          setCommitted((prev) => ({
            ...prev,
            [row.id]: {
              ...source,
              towId: towId || source.towId,
              fromStand: row.fromStand,
              toStand: row.toStand,
              towStartAt: startIso,
              towEndAt: endIso
            }
          }));
        }
        setRows((current) =>
          current.flatMap((item) => {
            if (item.id !== row.id) return [item];
            if (row.added) return [];
            return [{ ...item, towId: towId || item.towId, towStartAt: startIso, towEndAt: endIso, endLocal: row.endLocal, reason: "" }];
          })
        );
        if (towId) putReportRow(qc, towId, reportRowFromPlan({ ...row, towId }, towId));
      }
      void refreshTowLists(qc);
    },
    onError: (error, action) => {
      pendingRef.current = null;
      setRows((current) => current.map((item) => (item.id === action.row.id ? { ...item } : item)));
      setErrors((prev) => ({ ...prev, [action.row.id]: String((error as Error).message ?? error) }));
    },
    onSettled: () => {
      pendingRef.current = null;
    }
  });

  const mutateRef = useRef(run.mutate);
  mutateRef.current = run.mutate;
  const editable = (row: GridRow) => canWrite && !row.locked && !row.skipped;
  const fieldClass = (row: GridRow, field: "from" | "to" | "start" | "end") => {
    if (row.skipped) return "towGridSkipped";
    const required = missingFields(row).includes(field) ? "towGridRequired" : "";
    const locked = editable(row) ? "" : READONLY;
    return [required, locked].filter(Boolean).join(" ") || undefined;
  };
  const setStand = (row: GridRow, field: "fromStand" | "toStand", value: string) => {
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, [field]: value } : item)));
  };
  const standSelect = (row: GridRow, field: "fromStand" | "toStand") => (
    <select
      className="towGridInput"
      disabled={!editable(row)}
      value={row[field]}
      aria-label={field === "fromStand" ? "Откуда" : "Куда"}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setStand(row, field, event.target.value)}
    >
      <option value="">—</option>
      {standChoices(row, row[field]).map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
  const resetRow = (row: GridRow) => {
    const source = committedRef.current[row.id] ?? itemsRef.current.find((item) => item.id === row.id);
    if (!source) return;
    setRows((current) => current.map((item) => (item.id === row.id ? toGrid(source) : item)));
    setErrors((prev) => (prev[row.id] ? { ...prev, [row.id]: "" } : prev));
    setNotices((prev) => (prev[row.id] ? { ...prev, [row.id]: "" } : prev));
  };
  const columns = useMemo<Column<GridRow>[]>(() => {
    const rowIds = rows.map((row) => row.id);
    const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id));
    const built: Column<GridRow>[] = [
      {
        key: "select",
        name: "",
        width: 44,
        cellClass: (row) => (row.skipped ? "towGridSkipped" : undefined),
        renderHeaderCell: () => (
          <input
            type="checkbox"
            aria-label="Выбрать все строки"
            checked={allSelected}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rowIds))}
          />
        ),
        renderCell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="Выбрать строку"
            checked={selected.has(row.id)}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={() =>
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(row.id)) next.delete(row.id);
                else next.add(row.id);
                return next;
              })
            }
          />
        )
      },
      {
        key: "isNew",
        name: "Статус",
        width: 120,
        cellClass: (row) => (row.skipped ? "towGridSkipped" : READONLY),
        renderCell: ({ row }) =>
          row.added ? (
            <span className="towGridNew">Добавлено</span>
          ) : row.skipped ? (
            <TowText>Не требуется</TowText>
          ) : row.isNew ? (
            <span className="towGridNew">Новое</span>
          ) : (
            <TowText>—</TowText>
          )
      },
      { key: "aircraftType", name: "Тип ВС", width: 110, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.aircraftType || "—"}</TowText> },
      { key: "tailNumber", name: "Борт", width: 120, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.tailNumber || "—"}</TowText> },
      { key: "eventTitle", name: "Название события", width: 180, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.eventTitle || "—"}</TowText> },
      { key: "eventType", name: "Тип события", width: 150, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.eventType || "—"}</TowText> },
      { key: "operator", name: "Оператор", width: 130, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.operator || "—"}</TowText> },
      { key: "hangarNumber", name: "Номер ангара", width: 120, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.hangarNumber || "—"}</TowText> },
      { key: "layoutName", name: "Вариант расстановки", width: 170, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.layoutName || "—"}</TowText> },
      { key: "parkedStand", name: "Номер стоянки", width: 140, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.parkedStand || "—"}</TowText> },
      {
        key: "fromStand",
        name: "Откуда (с МС)",
        width: 150,
        cellClass: (row) => fieldClass(row, "from"),
        renderCell: ({ row }) => standSelect(row, "fromStand")
      },
      {
        key: "toStand",
        name: "Куда (на МС)",
        width: 150,
        cellClass: (row) => fieldClass(row, "to"),
        renderCell: ({ row }) => standSelect(row, "toStand")
      },
      { key: "eventStartMsk", name: "Начало события", width: 160, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.eventStartMsk || "—"}</TowText> },
      { key: "eventEndMsk", name: "Окончание события", width: 170, cellClass: READONLY, renderCell: ({ row }) => <TowText>{row.eventEndMsk || "—"}</TowText> },
      {
        key: "startLocal",
        name: "Начало буксировки",
        width: 170,
        editable,
        cellClass: (row) => fieldClass(row, "start"),
        renderCell: ({ row }) => (
          <span className="towGridCellStack">
            <TowText>{formatLocalMsk(row.startLocal) || "—"}</TowText>
            {shortShift(row) ? (
              <input
                className="towGridInput"
                value={row.reason}
                placeholder="причина <60 мин"
                aria-label="Причина сдвига начала"
                onChange={(event) => setRows((current) => current.map((item) => (item.id === row.id ? { ...item, reason: event.target.value } : item)))}
              />
            ) : null}
          </span>
        ),
        renderEditCell: DateTimeEditor
      },
      {
        key: "endLocal",
        name: "Окончание буксировки",
        width: 180,
        editable,
        cellClass: (row) => fieldClass(row, "end"),
        renderCell: ({ row }) => <TowText>{formatLocalMsk(row.endLocal) || "—"}</TowText>,
        renderEditCell: DateTimeEditor
      },
      {
        key: "standOccupancy",
        name: "Продолжительность занятия МС",
        width: 180,
        cellClass: READONLY,
        renderCell: ({ row }) => <TowText>{occupancyOf(row) || "—"}</TowText>
      }
    ];
    const visible = new Set(layout.visibleKeys);
    return built
      .filter((column) => visible.has(column.key))
      .map((column) => layoutColumn(column, layout.widthOf(column.key, typeof column.width === "number" ? column.width : 120)));
  }, [canWrite, layout.visibleKeys, layout.widthOf, rows, selected]);
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
      const message = messageRowHeight(errorsRef.current[row.id] || noticesRef.current[row.id] || "", shortShift(row) ? 34 : 0);
      const wrapped = wrappedBlockSize(
        columns
          .filter((column) => column.key !== "actions")
          .map((column) => ({ text: planCellText(row, column.key), width: typeof column.width === "number" ? column.width : 120 }))
      );
      return Math.max(message, wrapped);
    },
    [columns]
  );

  const sourceOf = (row: GridRow) => committedRef.current[row.id] ?? itemsRef.current.find((item) => item.id === row.id);
  const dirtyRows = rows.filter((row) => {
    if (row.added) return true;
    const source = sourceOf(row);
    return source ? isDirty(source, row) : false;
  });
  const chosen = rows.filter((row) => selected.has(row.id));
  const copyTargets = chosen.filter((row) => !row.locked);
  const localCopies = chosen.filter((row) => row.added);
  const deleteTargets = chosen.filter((row) => row.towId && !row.locked && !row.skipped);
  const skipIds = [...new Set(chosen.filter((row) => !row.locked).map((row) => row.eventId))];
  const skipClears = skipIds.length > 0 && skipIds.every((id) => chosen.some((row) => row.eventId === id && row.skipped));
  const messages = [
    ...Object.entries(errors).filter(([, text]) => text),
    ...Object.entries(notices).filter(([, text]) => text)
  ];
  const saveDirty = async () => {
    setBulkError("");
    for (const sourceRow of dirtyRows) {
      const row = withDefaultEnd(sourceRow);
      if (copyIncomplete(row) || missingFields(row).length || (shortShift(row) && !row.reason.trim())) {
        setBulkError(shortShift(row) && !row.reason.trim() ? "Сдвиг начала меньше 60 минут. Укажите причину в строке" : "Заполните откуда, куда, начало и окончание");
        return;
      }
      try {
        await run.mutateAsync({ kind: "save", row });
      } catch (reason) {
        setBulkError(String((reason as Error).message ?? reason));
        return;
      }
    }
  };
  const dropCopies = (ids: string[]) => {
    if (!ids.length) return;
    const drop = new Set(ids);
    setRows((current) => current.filter((row) => !drop.has(row.id)));
    setSelected((current) => {
      const next = new Set(current);
      for (const id of drop) next.delete(id);
      return next;
    });
  };
  const duplicateChosen = () => {
    if (!copyTargets.length) return;
    setBulkError("");
    setRows((current) => {
      const next = [...current];
      for (const source of copyTargets) {
        const at = next.findIndex((row) => row.id === source.id);
        next.splice(at + 1, 0, copyPlanRow(source));
      }
      return next;
    });
  };
  const deleteChosen = async () => {
    if (!deleteTargets.length && !localCopies.length) return;
    const serverNote = deleteTargets.length === 1 ? "Удалить эту буксировку?" : `Удалить буксировки: ${deleteTargets.length}?`;
    const copyNote = localCopies.length === 1 ? "Убрать несохранённую копию?" : `Убрать несохранённые копии: ${localCopies.length}?`;
    const note =
      deleteTargets.length && localCopies.length
        ? `${serverNote.slice(0, -1)} и ${copyNote.charAt(0).toLowerCase()}${copyNote.slice(1)}`
        : deleteTargets.length
          ? serverNote
          : copyNote;
    if (!window.confirm(note)) return;
    setBulkError("");
    dropCopies(localCopies.map((row) => row.id));
    for (const row of deleteTargets) {
      try {
        await run.mutateAsync({ kind: "delete", row });
      } catch (reason) {
        setBulkError(String((reason as Error).message ?? reason));
        return;
      }
    }
    setSelected(new Set());
  };
  const skipChosen = async () => {
    if (!skipIds.length) return;
    setBulkError("");
    try {
      await apiPost("/api/tows/skip", { eventIds: skipIds, skipped: !skipClears });
      setSelected(new Set());
      await refreshTowLists(qc);
    } catch (reason) {
      setBulkError(String((reason as Error).message ?? reason));
    }
  };

  return (
    <>
      <TowActionBar
        canWrite={canWrite}
        dirty={dirtyRows.length}
        selected={chosen.length}
        canDuplicate={copyTargets.length > 0}
        canDelete={deleteTargets.length > 0 || localCopies.length > 0}
        canSkip={skipIds.length > 0}
        skipClears={skipClears}
        pending={run.isPending}
        onCreate={() => setCreateOpen(true)}
        onSave={() => void saveDirty()}
        onUndo={() => {
          dropCopies(dirtyRows.filter((row) => row.added).map((row) => row.id));
          for (const row of dirtyRows) if (!row.added) resetRow(row);
        }}
        onDuplicate={duplicateChosen}
        onDelete={() => void deleteChosen()}
        onSkip={() => void skipChosen()}
      />
      {bulkError ? <div className="error">{bulkError}</div> : null}
      {messages.map(([id, text]) => (
        <div key={id} className={errors[id] ? "error" : "muted"}>
          {text}
        </div>
      ))}
      <div onContextMenu={(event) => {
        const point = towHeaderContextPoint(event);
        if (point) setColumnMenu(point);
      }}>
        <DataGrid
          className="rdg-light towGrid"
          columns={columns}
          rows={rows}
          rowKeyGetter={(row) => row.id}
          onRowsChange={setRows}
          onColumnResize={(idx, width) => {
            const key = columns[idx]?.key;
            if (key) layout.resize(key, width);
          }}
        headerRowHeight={headerRowHeight}
        rowHeight={rowHeight}
        rowClass={(row) => [row.skipped ? "towGridSkipped" : "", row.added ? "towGridAdded" : ""].filter(Boolean).join(" ") || undefined}
        style={{ blockSize: "min(70vh, 760px)" }}
      />
      </div>
      {createOpen ? (
        <TowCreateDialog
          events={items}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            void refreshTowLists(qc);
          }}
        />
      ) : null}
      <TowColumnMenu specs={PLAN_COLUMNS} hidden={layout.hidden} onShown={layout.setShown} point={columnMenu} onClose={closeColumnMenu} />
      {rows.length === 0 ? <div className="muted towGridEmpty">В этом периоде нет событий</div> : null}
    </>
  );
}
