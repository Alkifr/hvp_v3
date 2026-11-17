import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataGrid, { type Column, type RenderEditCellProps } from "react-data-grid";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import "react-data-grid/lib/styles.css";

import { apiDelete, apiPatch, apiPost } from "../../lib/api";
import { formatMskDateTime, fromInputMskOptional, toInputMsk } from "../../lib/localDate";
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
};

type GridRow = TowPlanRow & {
  startLocal: string;
  endLocal: string;
  reason: string;
};

const READONLY = "towGridReadonly";

function toGrid(row: TowPlanRow): GridRow {
  return {
    ...row,
    standOptions: row.standOptions?.length ? row.standOptions : ["МС"],
    startLocal: row.towStartAt ? toInputMsk(row.towStartAt) : "",
    endLocal: row.towEndAt ? toInputMsk(row.towEndAt) : "",
    reason: ""
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

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
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

function DateTimeEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<GridRow>) {
  const key = column.key as "startLocal" | "endLocal";
  return (
    <input
      autoFocus
      className="towGridInput"
      type="datetime-local"
      value={row[key]}
      onChange={(event) => onRowChange({ ...row, [key]: event.target.value })}
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
      if (next.length === prev.length && next.every((row, index) => row === prev[index])) return prev;
      return next;
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
      const row = action.row;
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
      if (action.kind === "save" && missingFields(action.row).length) return;
      setErrors((prev) => ({ ...prev, [action.row.id]: "" }));
      setNotices((prev) => ({ ...prev, [action.row.id]: "" }));
      setAccepted((prev) => ({ ...prev, [action.row.id]: { ...action, after: dataUpdatedAt } }));
      if (action.kind === "delete") {
        putReportRow(qc, action.row.towId, null);
      } else {
        const createdId = !action.row.towId && data && typeof data === "object" && "id" in data ? String((data as { id?: string }).id ?? "") : "";
        const towId = action.row.towId || createdId;
        const startIso = fromInputMskOptional(action.row.startLocal) ?? "";
        const endIso = fromInputMskOptional(action.row.endLocal) ?? "";
        const source = itemsRef.current.find((item) => item.id === action.row.id);
        if (source) {
          setCommitted((prev) => ({
            ...prev,
            [action.row.id]: {
              ...source,
              towId: towId || source.towId,
              fromStand: action.row.fromStand,
              toStand: action.row.toStand,
              towStartAt: startIso,
              towEndAt: endIso
            }
          }));
        }
        setRows((current) =>
          current.map((item) =>
            item.id === action.row.id ? { ...item, towId: towId || item.towId, towStartAt: startIso, towEndAt: endIso, reason: "" } : item
          )
        );
        if (towId) putReportRow(qc, towId, reportRowFromPlan({ ...action.row, towId }, towId));
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
  const editable = (row: GridRow) => canWrite && !row.locked;
  const fieldClass = (row: GridRow, field: "from" | "to" | "start" | "end") => {
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
  const columns = useMemo<Column<GridRow>[]>(
    () => [
      {
        key: "isNew",
        name: "Статус",
        width: 100,
        cellClass: READONLY,
        renderCell: ({ row }) => (row.isNew ? <span className="towGridNew">Новое</span> : "—")
      },
      { key: "aircraftType", name: "Тип ВС", width: 110, cellClass: READONLY },
      { key: "tailNumber", name: "Борт", width: 120, cellClass: READONLY },
      { key: "eventTitle", name: "Название события", width: 180, cellClass: READONLY, renderCell: ({ row }) => row.eventTitle || "—" },
      { key: "eventType", name: "Тип события", width: 150, cellClass: READONLY, renderCell: ({ row }) => row.eventType || "—" },
      { key: "operator", name: "Оператор", width: 130, cellClass: READONLY },
      { key: "hangarNumber", name: "Номер ангара", width: 120, cellClass: READONLY, renderCell: ({ row }) => row.hangarNumber || "—" },
      { key: "layoutName", name: "Вариант расстановки", width: 170, cellClass: READONLY, renderCell: ({ row }) => row.layoutName || "—" },
      { key: "parkedStand", name: "Номер стоянки", width: 140, cellClass: READONLY, renderCell: ({ row }) => row.parkedStand || "—" },
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
      { key: "eventStartMsk", name: "Начало события", width: 160, cellClass: READONLY, renderCell: ({ row }) => row.eventStartMsk || "—" },
      { key: "eventEndMsk", name: "Окончание события", width: 170, cellClass: READONLY, renderCell: ({ row }) => row.eventEndMsk || "—" },
      {
        key: "startLocal",
        name: "Начало буксировки",
        width: 170,
        editable,
        cellClass: (row) => fieldClass(row, "start"),
        renderCell: ({ row }) => formatLocalMsk(row.startLocal) || "—",
        renderEditCell: DateTimeEditor
      },
      {
        key: "endLocal",
        name: "Окончание буксировки",
        width: 180,
        editable,
        cellClass: (row) => fieldClass(row, "end"),
        renderCell: ({ row }) => formatLocalMsk(row.endLocal) || "—",
        renderEditCell: DateTimeEditor
      },
      {
        key: "standOccupancy",
        name: "Продолжительность занятия МС",
        width: 180,
        cellClass: READONLY,
        renderCell: ({ row }) => occupancyOf(row) || "—"
      },
      {
        key: "actions",
        name: "",
        width: 280,
        renderCell: ({ row }) => {
          const source = committedRef.current[row.id] ?? itemsRef.current.find((item) => item.id === row.id);
          const changed = source ? isDirty(source, row) : false;
          const pending = pendingRef.current === row.id;
          return (
            <div className="towGridActions">
              {canWrite && !row.locked && changed ? (
                <>
                  <button
                    className="btn btnPrimary"
                    type="button"
                    disabled={pending || missingFields(row).length > 0}
                    onClick={() => mutateRef.current({ kind: "save", row })}
                  >
                    Сохранить
                  </button>
                  <button className="btn towIconBtn" type="button" disabled={pending} aria-label="Отменить" title="Отменить" onClick={() => resetRow(row)}>
                    <UndoIcon />
                  </button>
                </>
              ) : null}
              {canWrite && !row.locked && row.towId ? (
                <button
                  className="btn towIconBtn towIconBtnDanger"
                  type="button"
                  disabled={pending}
                  aria-label="Удалить"
                  title="Удалить"
                  onClick={() => {
                    if (window.confirm("Удалить эту буксировку?")) mutateRef.current({ kind: "delete", row });
                  }}
                >
                  <TrashIcon />
                </button>
              ) : null}
              {shortShift(row) ? (
                <input
                  className="towGridInput"
                  value={row.reason}
                  placeholder="причина <60 мин"
                  aria-label="Причина сдвига начала"
                  onChange={(event) =>
                    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, reason: event.target.value } : item)))
                  }
                />
              ) : null}
              {errorsRef.current[row.id] ? <span className="error towGridMessage">{errorsRef.current[row.id]}</span> : null}
              {noticesRef.current[row.id] ? <span className="muted towGridMessage">{noticesRef.current[row.id]}</span> : null}
            </div>
          );
        }
      }
    ],
    [canWrite]
  );
  const rowHeight = useCallback(
    (row: GridRow) => messageRowHeight(errorsRef.current[row.id] || noticesRef.current[row.id] || "", shortShift(row) ? 34 : 0),
    []
  );

  return (
    <>
      <DataGrid
        className="rdg-light towGrid"
        columns={columns}
        rows={rows}
        rowKeyGetter={(row) => row.id}
        onRowsChange={setRows}
        headerRowHeight={58}
        rowHeight={rowHeight}
        style={{ blockSize: "min(70vh, 760px)" }}
      />
      {rows.length === 0 ? <div className="muted towGridEmpty">В этом периоде нет событий</div> : null}
    </>
  );
}
