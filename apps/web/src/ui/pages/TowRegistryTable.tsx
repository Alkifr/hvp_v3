import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/api";
import { fromInputMskOptional, toInputMsk } from "../../lib/localDate";

export type TowRegistryEdge = {
  role: "event-in" | "event-out";
  state: "assigned" | "waived" | "empty";
  towId: string;
  placementId: string;
  fromStand: string;
  toStand: string;
  startAt: string;
  endAt: string;
  startMsk: string;
  endMsk: string;
  planStartAt: string;
  planEndAt: string;
  planFrom: string;
  planTo: string;
  note: string;
};

export type TowRegistryHangar = { id: string; label: string };

export type TowRegistryExport = Record<string, string>;

export type TowRegistryRow = {
  eventId: string;
  seq: number;
  title: string;
  status: string;
  locked: boolean;
  hangarId: string;
  hangarNumber: string;
  hangars: TowRegistryHangar[];
  aircraftTypeId: string;
  aircraftType: string;
  aircraftId: string;
  tailNumber: string;
  operatorId: string;
  operator: string;
  eventStartAt?: string;
  eventEndAt?: string;
  eventStartMsk: string;
  eventEndMsk: string;
  createdAt?: string;
  inEdge: TowRegistryEdge;
  outEdge: TowRegistryEdge;
  mark: "same" | "new" | "changed" | "removed";
  changedFields: string[];
  export: TowRegistryExport;
};

type EdgeDraft = {
  fromStand: string;
  toStand: string;
  startLocal: string;
  endLocal: string;
  reason: string;
};

type ChangeItem = {
  id: string;
  actor: string;
  field: string;
  before: string;
  after: string;
  reason: string;
  createdMsk: string;
};

const COL_SPAN = 14;

const EDGE_FIELDS: Record<TowRegistryEdge["role"], { mark: string; from: string; to: string; start: string; end: string }> = {
  "event-in": { mark: "inMark", from: "inFrom", to: "inTo", start: "inStartMsk", end: "inEndMsk" },
  "event-out": { mark: "outMark", from: "outFrom", to: "outTo", start: "outStartMsk", end: "outEndMsk" }
};

function assignedInWindow(edge: TowRegistryEdge, fromIso: string, toIso: string): boolean {
  return edge.state === "assigned" && intersects(edge.startAt, edge.endAt, fromIso, toIso);
}

export function periodState(edge: TowRegistryEdge, fromIso: string, toIso: string): TowRegistryEdge["state"] {
  if (edge.state === "waived") return "waived";
  if (assignedInWindow(edge, fromIso, toIso)) return "assigned";
  return "empty";
}

function baseline(edge: TowRegistryEdge, fromIso: string, toIso: string): EdgeDraft {
  if (periodState(edge, fromIso, toIso) === "assigned") {
    return {
      fromStand: edge.fromStand,
      toStand: edge.toStand,
      startLocal: toInputMsk(edge.startAt),
      endLocal: toInputMsk(edge.endAt),
      reason: ""
    };
  }
  return { fromStand: "", toStand: "", startLocal: "", endLocal: "", reason: "" };
}

function draftOf(edge: TowRegistryEdge, fromIso: string, toIso: string): EdgeDraft {
  return baseline(edge, fromIso, toIso);
}

function edgeDirty(edge: TowRegistryEdge, draft: EdgeDraft, fromIso: string, toIso: string): boolean {
  const saved = baseline(edge, fromIso, toIso);
  return (
    draft.fromStand !== saved.fromStand ||
    draft.toStand !== saved.toStand ||
    draft.startLocal !== saved.startLocal ||
    draft.endLocal !== saved.endLocal
  );
}

function edgeInterval(edge: TowRegistryEdge): { start: string; end: string } {
  if (edge.state === "assigned" && edge.startAt && edge.endAt) return { start: edge.startAt, end: edge.endAt };
  return { start: edge.planStartAt, end: edge.planEndAt };
}

function intersects(start: string, end: string, fromIso: string, toIso: string): boolean {
  return Boolean(start && end && start < toIso && end > fromIso);
}

export function planLinesInWindow(items: TowRegistryRow[], fromIso: string, toIso: string) {
  const lines: Array<{ row: TowRegistryRow; edge: TowRegistryEdge }> = [];
  for (const row of items) {
    const edges = [row.inEdge, row.outEdge];
    const inside = edges.filter((edge) => {
      const interval = edgeInterval(edge);
      return intersects(interval.start, interval.end, fromIso, toIso);
    });
    if (inside.length > 0) {
      for (const edge of inside) lines.push({ row, edge });
      continue;
    }
    const edge = edges.find((item) => item.state !== "waived") ?? row.inEdge;
    lines.push({ row, edge });
  }
  return lines;
}

function marked(fields: string[], keys: string[]): boolean {
  return keys.some((key) => fields.includes(key));
}

function diffClass(on: boolean): string | undefined {
  return on ? "towDiff" : undefined;
}

function statusText(state: TowRegistryEdge["state"]): string {
  if (state === "empty") return "не назначена";
  if (state === "waived") return "не требуется";
  return "назначена";
}

function FlatHead() {
  return (
    <tr>
      <th>Борт</th>
      <th>Тип ВС</th>
      <th>Оператор</th>
      <th>Ангар</th>
      <th>Событие</th>
      <th>Начало события</th>
      <th>Окончание события</th>
      <th>Буксировка</th>
      <th>Откуда</th>
      <th>Куда</th>
      <th>Начало</th>
      <th>Окончание</th>
      <th>Отличие</th>
      <th />
    </tr>
  );
}

function EdgeRow({
  row,
  edge,
  draft,
  fromIso,
  toIso,
  canWrite,
  canGantt,
  changesOpen,
  changes,
  changesLoading,
  onDraft,
  onDone,
  onOpenEvent,
  onToggleChanges
}: {
  row: TowRegistryRow;
  edge: TowRegistryEdge;
  draft: EdgeDraft;
  fromIso: string;
  toIso: string;
  canWrite: boolean;
  canGantt: boolean;
  changesOpen: boolean;
  changes: ChangeItem[];
  changesLoading: boolean;
  onDraft: (next: EdgeDraft) => void;
  onDone: () => void;
  onOpenEvent: (eventId: string) => void;
  onToggleChanges: () => void;
}) {
  const qc = useQueryClient();
  const title = "Буксировка";
  const fields = EDGE_FIELDS[edge.role];
  const normReady = edge.state === "empty" && Boolean(edge.placementId) && edge.note.startsWith("Норматив");
  const run = useMutation({
    mutationFn: async (action: "save" | "norm" | "waive" | "restore" | "delete") => {
      if (action === "waive") {
        return apiPost("/api/tows/waiver", { eventId: row.eventId, role: edge.role, waived: true });
      }
      if (action === "restore") {
        return apiPost("/api/tows/waiver", { eventId: row.eventId, role: edge.role, waived: false });
      }
      if (action === "norm") {
        return apiPost(`/api/events/${row.eventId}/tows/edges`, { role: edge.role, changeReason: "Норматив буксировки" });
      }
      if (action === "delete") {
        const query = new URLSearchParams({ changeReason: "Снятие буксировки" });
        return apiDelete(`/api/events/${row.eventId}/tows/${edge.towId}?${query.toString()}`);
      }
      const saved = baseline(edge, fromIso, toIso);
      const startEdited = draft.startLocal !== saved.startLocal;
      const endEdited = draft.endLocal !== saved.endLocal;
      const startIso = fromInputMskOptional(draft.startLocal);
      const endIso = fromInputMskOptional(draft.endLocal);
      if (edge.state === "assigned") {
        if ((startEdited && !startIso) || (endEdited && !endIso)) throw new Error("Укажите начало и окончание");
        if (startEdited && !draft.reason.trim()) throw new Error("Укажите причину изменения времени начала буксировки");
        return apiPatch(`/api/tows/${edge.towId}`, {
          fromLabel: draft.fromStand.trim() || null,
          toLabel: draft.toStand.trim() || null,
          startAt: startEdited ? startIso ?? undefined : undefined,
          endAt: endEdited ? endIso ?? undefined : undefined,
          startChangeReason: draft.reason.trim() || undefined,
          changeReason: draft.reason.trim() || "Буксировка"
        });
      }
      if (!startIso || !endIso) throw new Error("Укажите начало и окончание");
      return apiPost(`/api/events/${row.eventId}/tows`, {
        startAt: startIso,
        endAt: endIso,
        placementId: edge.placementId || null,
        fromLabel: draft.fromStand.trim() || null,
        toLabel: draft.toStand.trim() || null,
        changeReason: "Буксировка"
      });
    },
    onSuccess: async () => {
      onDone();
      await qc.invalidateQueries({ queryKey: ["tows-registry"] });
      await qc.invalidateQueries({ queryKey: ["tows-changes", row.eventId] });
    }
  });
  const shown = periodState(edge, fromIso, toIso);
  const waived = shown === "waived";
  const disabled = waived || row.locked || !canWrite || run.isPending;
  const saved = baseline(edge, fromIso, toIso);
  const dirty = edgeDirty(edge, draft, fromIso, toIso);
  const startChanged = edge.state === "assigned" && draft.startLocal !== saved.startLocal;
  const identityChanged = marked(row.changedFields, ["hangarNumber", "aircraftType", "tailNumber", "operator"]);
  const eventChanged = marked(row.changedFields, ["eventTitle", "eventStartMsk", "eventEndMsk"]);

  return (
    <>
      <tr className={waived ? "towRowWaived" : undefined}>
        <td className={diffClass(identityChanged)}>{row.tailNumber || "—"}</td>
        <td className={diffClass(identityChanged)}>{row.aircraftType || "—"}</td>
        <td className={diffClass(identityChanged)}>{row.operator || "—"}</td>
        <td className={diffClass(identityChanged)}>{row.hangarNumber || "—"}</td>
        <td className={diffClass(eventChanged)}>{row.title || "—"}</td>
        <td className={diffClass(eventChanged)}>{row.eventStartMsk || "—"}</td>
        <td className={diffClass(eventChanged)}>{row.eventEndMsk || "—"}</td>
        <td className={diffClass(marked(row.changedFields, [fields.mark]))} title={edge.note || undefined}>
          <span className={shown === "empty" ? "towEdgeEmpty" : undefined}>{statusText(shown)}</span>
        </td>
        {waived ? (
          <>
            <td>—</td>
            <td>—</td>
            <td>—</td>
            <td>—</td>
          </>
        ) : (
          <>
            <td className={diffClass(marked(row.changedFields, [fields.from]))}>
              <input
                value={draft.fromStand}
                disabled={disabled}
                placeholder="откуда"
                aria-label={`${title}: откуда`}
                onChange={(e) => onDraft({ ...draft, fromStand: e.target.value })}
              />
            </td>
            <td className={diffClass(marked(row.changedFields, [fields.to]))}>
              <input
                value={draft.toStand}
                disabled={disabled}
                placeholder="куда"
                aria-label={`${title}: куда`}
                onChange={(e) => onDraft({ ...draft, toStand: e.target.value })}
              />
            </td>
            <td className={diffClass(marked(row.changedFields, [fields.start]))}>
              <input
                type="datetime-local"
                value={draft.startLocal}
                disabled={disabled}
                aria-label={`${title}: начало`}
                onChange={(e) => onDraft({ ...draft, startLocal: e.target.value })}
              />
            </td>
            <td className={diffClass(marked(row.changedFields, [fields.end]))}>
              <input
                type="datetime-local"
                value={draft.endLocal}
                disabled={disabled}
                aria-label={`${title}: окончание`}
                onChange={(e) => onDraft({ ...draft, endLocal: e.target.value })}
              />
            </td>
          </>
        )}
        <td className={row.mark === "new" ? "towMarkNew" : row.mark === "changed" ? "towDiff" : undefined}>
          {row.export.changeMark || "—"}
        </td>
        <td className="towFlatActions">
          {canWrite && !row.locked && shown === "empty" && edge.state === "empty" ? (
            <button className="btn btnPrimary" type="button" disabled={disabled || !normReady} onClick={() => run.mutate("norm")}>
              Норматив
            </button>
          ) : null}
          {canWrite && !row.locked && shown !== "waived" && dirty ? (
            <button className="btn btnPrimary" type="button" disabled={disabled} onClick={() => run.mutate("save")}>
              Сохранить
            </button>
          ) : null}
          {canWrite && !row.locked && shown === "empty" && edge.state === "empty" ? (
            <button className="btn" type="button" disabled={disabled} onClick={() => run.mutate("waive")}>
              Не требуется
            </button>
          ) : null}
          {canWrite && !row.locked && waived ? (
            <button className="btn" type="button" disabled={row.locked || !canWrite || run.isPending} onClick={() => run.mutate("restore")}>
              Вернуть
            </button>
          ) : null}
          {canWrite && !row.locked && shown === "assigned" ? (
            <button className="btn" type="button" disabled={disabled} onClick={() => run.mutate("delete")}>
              Снять
            </button>
          ) : null}
          {startChanged ? (
            <input
              value={draft.reason}
              disabled={disabled}
              placeholder="причина сдвига"
              aria-label={`${title}: причина сдвига начала`}
              onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
            />
          ) : null}
          {canGantt ? (
            <button className="btn" type="button" onClick={() => onOpenEvent(row.eventId)}>
              Гантт
            </button>
          ) : null}
          <button className="btn" type="button" onClick={onToggleChanges}>
            Правки
          </button>
          {run.isError ? <span className="error">{String((run.error as Error).message ?? run.error)}</span> : null}
        </td>
      </tr>
      {changesOpen ? (
        <tr>
          <td colSpan={COL_SPAN}>
            <div className="towChangeLog">
            {changesLoading ? <div className="muted">обновление…</div> : null}
            {changes.length === 0 && !changesLoading ? <div className="muted">Правок пока нет</div> : null}
            {changes.map((item) => (
              <div key={item.id}>
                <span className="muted">{item.createdMsk} · {item.actor}</span>
                <div>
                  {item.field}: {item.before || "—"} → {item.after || "—"}
                </div>
              </div>
            ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function removedTow(row: TowRegistryRow) {
  const useOut = row.export.inMark !== "назначена" && row.export.outMark === "назначена";
  return {
    mark: useOut ? row.export.outMark : row.export.inMark,
    from: useOut ? row.export.outFrom : row.export.inFrom,
    to: useOut ? row.export.outTo : row.export.inTo,
    start: useOut ? row.export.outStartMsk : row.export.inStartMsk,
    end: useOut ? row.export.outEndMsk : row.export.inEndMsk
  };
}

export function TowRegistryTable({
  items,
  removed,
  fromIso,
  toIso,
  canWrite,
  canGantt,
  onOpenEvent,
  onDirtyChange
}: {
  items: TowRegistryRow[];
  removed: TowRegistryRow[];
  fromIso: string;
  toIso: string;
  canWrite: boolean;
  canGantt: boolean;
  onOpenEvent: (eventId: string) => void;
  onDirtyChange: (count: number) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, EdgeDraft>>({});
  const windowKey = `${fromIso}|${toIso}`;
  const windowRef = useRef(windowKey);
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const changesEventId = changesFor?.slice(0, changesFor.lastIndexOf(":")) || null;
  const changesQ = useQuery({
    queryKey: ["tows-changes", changesEventId],
    enabled: Boolean(changesEventId),
    queryFn: () => apiGet<{ items: ChangeItem[] }>(`/api/tows/changes?eventId=${changesEventId}`)
  });

  useEffect(() => {
    const windowChanged = windowRef.current !== windowKey;
    windowRef.current = windowKey;
    setDrafts((prev) => {
      const next = windowChanged ? {} : { ...prev };
      for (const row of items) {
        for (const edge of [row.inEdge, row.outEdge]) {
          const key = `${row.eventId}:${edge.role}`;
          const fresh = draftOf(edge, fromIso, toIso);
          const current = next[key];
          if (!current || !edgeDirty(edge, current, fromIso, toIso)) next[key] = fresh;
        }
      }
      return next;
    });
  }, [items, fromIso, toIso, windowKey]);

  const lines = useMemo(() => planLinesInWindow(items, fromIso, toIso), [items, fromIso, toIso]);

  const dirtyCount = useMemo(() => {
    let count = 0;
    for (const line of lines) {
      const draft = drafts[`${line.row.eventId}:${line.edge.role}`] ?? draftOf(line.edge, fromIso, toIso);
      if (edgeDirty(line.edge, draft, fromIso, toIso)) count += 1;
    }
    return count;
  }, [lines, drafts]);

  useEffect(() => {
    onDirtyChange(dirtyCount);
  }, [dirtyCount, onDirtyChange]);

  const clearDraft = (eventId: string, role: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[`${eventId}:${role}`];
      return next;
    });
  };

  const changes = changesQ.data?.items ?? [];

  return (
    <>
      <div className="towsTableWrap">
        <table className="towsTable towFlatTable">
          <thead>
            <FlatHead />
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={COL_SPAN} className="muted">
                  В этом окне нет событий
                </td>
              </tr>
            ) : null}
            {lines.map(({ row, edge }) => {
              return (
                <EdgeRow
                  key={`${row.eventId}:${edge.role}`}
                  row={row}
                  edge={edge}
                  draft={drafts[`${row.eventId}:${edge.role}`] ?? draftOf(edge, fromIso, toIso)}
                  fromIso={fromIso}
                  toIso={toIso}
                  canWrite={canWrite}
                  canGantt={canGantt}
                  changesOpen={changesFor === `${row.eventId}:${edge.role}`}
                  changes={changes}
                  changesLoading={changesQ.isFetching}
                  onDraft={(next) => setDrafts((prev) => ({ ...prev, [`${row.eventId}:${edge.role}`]: next }))}
                  onDone={() => clearDraft(row.eventId, edge.role)}
                  onOpenEvent={onOpenEvent}
                  onToggleChanges={() =>
                    setChangesFor((current) => (current === `${row.eventId}:${edge.role}` ? null : `${row.eventId}:${edge.role}`))
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {removed.length ? (
        <section className="card towsTableCard">
          <h2 className="towEditorTitle">Сняты с прошлой отправки этого окна</h2>
          <div className="towsTableWrap">
            <table className="towsTable towFlatTable">
              <thead>
                <FlatHead />
              </thead>
              <tbody>
                {removed.map((row) => {
                  const tow = removedTow(row);
                  return (
                    <tr key={row.eventId}>
                      <td>{row.tailNumber || "—"}</td>
                      <td>{row.aircraftType || "—"}</td>
                      <td>{row.operator || "—"}</td>
                      <td>{row.hangarNumber || "—"}</td>
                      <td>{row.title || "—"}</td>
                      <td>{row.eventStartMsk || "—"}</td>
                      <td>{row.eventEndMsk || "—"}</td>
                      <td className="towDiff">{tow.mark || "—"}</td>
                      <td className="towDiff">{tow.from || "—"}</td>
                      <td className="towDiff">{tow.to || "—"}</td>
                      <td className="towDiff">{tow.start || "—"}</td>
                      <td className="towDiff">{tow.end || "—"}</td>
                      <td className="towDiff">снята</td>
                      <td />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
