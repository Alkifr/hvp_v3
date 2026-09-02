import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import {
  ER_EDGES,
  ER_GROUPS,
  ER_GROUP_BY_ID,
  ER_TABLE_BY_ID,
  ER_TABLES,
  edgesOfTable,
  neighborIds,
  searchErTables,
  type ErColumn,
  type ErEdge,
  type ErGroupId,
  type ErTable
} from "../../lib/erSchema";

type Box = { id: string; x: number; y: number; w: number; h: number };
type Header = { id: string; title: string; x: number; y: number; color: string };
type Pt = { x: number; y: number };
type Side = "left" | "right";

const COMPACT_W = 210;
const COMPACT_H = 56;
const FULL_W = 340;
const NEIGHBOR_W = 268;
const COL_H = 22;
const HEAD_H = 44;
const MAX_FULL_H = 640;
const MAX_NEIGHBOR_H = 280;
const NEIGHBOR_GAP = 28;
const LANE_STEP = 14;

const OVERVIEW_COLS: ErGroupId[][] = [
  ["auth", "sandbox", "comms"],
  ["fleet", "analytics"],
  ["hangar"],
  ["event", "eventExt", "tech"],
  ["labor", "material"]
];

function cardHeight(colCount: number, maxH: number, extra = 0) {
  return Math.min(HEAD_H + 8 + colCount * COL_H + extra, maxH);
}

function neighborCardHeight(table: ErTable, selectedId: string, links: ErEdge[]) {
  const cols = neighborColumns(table, selectedId, links);
  return cardHeight(cols.length, MAX_NEIGHBOR_H, cols.length < table.columns.length ? 22 : 0);
}

function colIndex(table: ErTable, name: string) {
  const i = table.columns.findIndex((c) => c.name === name);
  return i < 0 ? 0 : i;
}

function splitNeighbors(selectedId: string) {
  const parents = new Map<string, ErEdge[]>();
  const children = new Map<string, ErEdge[]>();
  for (const edge of edgesOfTable(selectedId)) {
    if (edge.from === selectedId && edge.to !== selectedId) {
      const list = parents.get(edge.to) ?? [];
      list.push(edge);
      parents.set(edge.to, list);
    } else if (edge.to === selectedId && edge.from !== selectedId) {
      const list = children.get(edge.from) ?? [];
      list.push(edge);
      children.set(edge.from, list);
    }
  }
  for (const id of [...parents.keys()]) {
    if (!children.has(id)) continue;
    if ((children.get(id)?.length ?? 0) >= (parents.get(id)?.length ?? 0)) parents.delete(id);
    else children.delete(id);
  }
  return { parents, children };
}

function stackVertical(items: { id: string; h: number }[], x: number, w: number, startY: number, gap: number) {
  let y = startY;
  return items.map((it) => {
    const box: Box = { id: it.id, x, y, w, h: it.h };
    y += it.h + gap;
    return box;
  });
}

function stackBottom(boxes: Box[], fallback: number) {
  if (!boxes.length) return fallback;
  return Math.max(...boxes.map((b) => b.y + b.h));
}

function spreadYs(box: Box, count: number) {
  const top = box.y + Math.min(HEAD_H + 8, Math.max(10, box.h * 0.2));
  const bot = box.y + box.h - 10;
  const lo = Math.min(top, bot);
  const hi = Math.max(bot, lo + 1);
  if (count <= 1) return [(lo + hi) / 2];
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

function sideX(box: Box, side: Side) {
  return side === "left" ? box.x : box.x + box.w;
}

function preferredSides(from: Box, to: Box): { fromSide: Side; toSide: Side } {
  if (Math.abs(from.x - to.x) < 8) {
    return { fromSide: "right", toSide: "right" };
  }
  const fromCx = from.x + from.w / 2;
  const toCx = to.x + to.w / 2;
  if (toCx < fromCx) return { fromSide: "left", toSide: "right" };
  return { fromSide: "right", toSide: "left" };
}

function edgeKey(edge: ErEdge) {
  return `${edge.from}|${edge.fromCol}|${edge.to}|${edge.toCol}`;
}

function assignPorts(boxes: Box[], edges: ErEdge[]) {
  const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
  type Slot = { edge: ErEdge; end: "from" | "to"; otherY: number; otherId: string };
  const groups = new Map<string, Slot[]>();
  const add = (boxId: string, side: Side, slot: Slot) => {
    const key = `${boxId}:${side}`;
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  };
  for (const edge of edges) {
    const from = byId[edge.from];
    const to = byId[edge.to];
    if (!from || !to) continue;
    const sides = preferredSides(from, to);
    add(edge.from, sides.fromSide, { edge, end: "from", otherY: to.y + to.h / 2, otherId: to.id });
    add(edge.to, sides.toSide, { edge, end: "to", otherY: from.y + from.h / 2, otherId: from.id });
  }
  const ports = new Map<string, Pt>();
  for (const [key, list] of groups) {
    const [boxId, side] = key.split(":") as [string, Side];
    const box = byId[boxId];
    if (!box) continue;
    list.sort((a, b) => a.otherY - b.otherY || a.otherId.localeCompare(b.otherId) || a.edge.fromCol.localeCompare(b.edge.fromCol));
    const ys = spreadYs(box, list.length);
    list.forEach((slot, i) => {
      ports.set(`${edgeKey(slot.edge)}:${slot.end}`, { x: sideX(box, side), y: ys[i]! });
    });
  }
  return ports;
}

function assignLanes(ranges: { y1: number; y2: number }[]) {
  const lastHi: number[] = [];
  const out = new Array<number>(ranges.length).fill(0);
  const order = ranges
    .map((r, i) => ({ i, lo: Math.min(r.y1, r.y2), hi: Math.max(r.y1, r.y2) }))
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  for (const item of order) {
    let lane = lastHi.findIndex((hi) => hi + 12 <= item.lo);
    if (lane < 0) {
      lane = lastHi.length;
      lastHi.push(item.hi);
    } else {
      lastHi[lane] = item.hi;
    }
    out[item.i] = lane;
  }
  return out;
}

function orthoPath(a: Pt, b: Pt, lane: number) {
  const dir = Math.sign(b.x - a.x) || 1;
  const span = Math.abs(b.x - a.x);
  const stub = Math.min(28 + lane * LANE_STEP, Math.max(24, span - 24));
  const midX = a.x + dir * stub;
  const lx = a.x + dir * Math.min(72, stub);
  if (Math.abs(a.y - b.y) < 2) {
    return { d: `M ${a.x} ${a.y} H ${b.x}`, lx: (a.x + b.x) / 2, ly: a.y - 6 };
  }
  return {
    d: `M ${a.x} ${a.y} H ${midX} V ${b.y} H ${b.x}`,
    lx,
    ly: a.y - 6
  };
}

function bezierPath(a: Pt, b: Pt) {
  if (Math.abs(a.x - b.x) < 4) {
    const bump = a.x + 40;
    return {
      d: `M ${a.x} ${a.y} C ${bump} ${a.y}, ${bump} ${b.y}, ${b.x} ${b.y}`,
      lx: bump,
      ly: (a.y + b.y) / 2 - 6
    };
  }
  const dx = Math.max(48, Math.abs(b.x - a.x) * 0.4);
  const s = Math.sign(b.x - a.x) || 1;
  return {
    d: `M ${a.x} ${a.y} C ${a.x + s * dx} ${a.y}, ${b.x - s * dx} ${b.y}, ${b.x} ${b.y}`,
    lx: (a.x + b.x) / 2,
    ly: (a.y + b.y) / 2 - 6
  };
}

function routeEdges(boxes: Box[], edges: ErEdge[], mode: "focus" | "overview") {
  const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
  const ports = assignPorts(boxes, edges);
  const pts = edges
    .map((edge) => {
      const a = ports.get(`${edgeKey(edge)}:from`);
      const b = ports.get(`${edgeKey(edge)}:to`);
      const from = byId[edge.from];
      const to = byId[edge.to];
      if (!a || !b || !from || !to) return null;
      return { edge, a, b };
    })
    .filter((item): item is { edge: ErEdge; a: Pt; b: Pt } => item !== null);

  const lanes = new Array<number>(pts.length).fill(0);
  if (mode === "focus") {
    const leftIdx: number[] = [];
    const rightIdx: number[] = [];
    pts.forEach((p, i) => {
      if (p.b.x < p.a.x) leftIdx.push(i);
      else rightIdx.push(i);
    });
    const fill = (idxs: number[]) => {
      const assigned = assignLanes(idxs.map((i) => ({ y1: pts[i]!.a.y, y2: pts[i]!.b.y })));
      idxs.forEach((ptIndex, j) => {
        lanes[ptIndex] = assigned[j]!;
      });
    };
    fill(leftIdx);
    fill(rightIdx);
  }

  return pts.map((p, i) => {
    const path = mode === "focus" ? orthoPath(p.a, p.b, lanes[i]!) : bezierPath(p.a, p.b);
    return { edge: p.edge, ...path };
  });
}

function neighborColumns(table: ErTable, selectedId: string, links: ErEdge[]) {
  const names = new Set<string>();
  for (const c of table.columns) {
    if (c.pk) names.add(c.name);
  }
  for (const e of links) {
    if (e.from === table.id && (e.to === selectedId || table.id === selectedId)) names.add(e.fromCol);
    if (e.to === table.id && (e.from === selectedId || table.id === selectedId)) names.add(e.toCol);
  }
  const cols = table.columns.filter((c) => names.has(c.name));
  return cols.length ? cols : table.columns.slice(0, 6);
}

function ColBadges(props: { col: ErColumn }) {
  return (
    <span className="erColBadges">
      {props.col.pk ? <span className="erBadge erBadgePk">PK</span> : null}
      {props.col.fk ? <span className="erBadge erBadgeFk">FK</span> : null}
      {props.col.unique && !props.col.pk ? <span className="erBadge erBadgeUq">UQ</span> : null}
    </span>
  );
}

function ColumnList(props: { columns: ErColumn[]; highlight?: string; dim?: boolean }) {
  return (
    <ul className={props.dim ? "erCols erColsDim" : "erCols"}>
      {props.columns.map((col) => (
        <li key={col.name} className={props.highlight === col.name ? "erCol erColHit" : "erCol"}>
          <span className="erColName" title={col.name}>
            {col.name}
          </span>
          <span className="erColType" title={col.type}>
            {col.type}
          </span>
          <ColBadges col={col} />
        </li>
      ))}
    </ul>
  );
}

export function HelpErDiagram(props: { focusTable?: string }) {
  const svgUid = useId().replace(/:/g, "");
  const canvasRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(props.focusTable ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(props.focusTable ?? null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<ErGroupId | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  useEffect(() => {
    if (!props.focusTable) return;
    setQuery(props.focusTable);
    setSelectedId(props.focusTable);
  }, [props.focusTable]);

  const hits = useMemo(() => searchErTables(query), [query]);

  const visibleIds = useMemo(() => {
    if (selectedId) {
      return new Set([selectedId, ...neighborIds(selectedId)]);
    }
    if (!query.trim()) {
      const ids = new Set(ER_TABLES.filter((t) => !groupFilter || t.group === groupFilter).map((t) => t.id));
      return ids;
    }
    const ids = new Set<string>();
    for (const hit of hits) {
      ids.add(hit.table.id);
      for (const n of neighborIds(hit.table.id)) ids.add(n);
    }
    if (groupFilter) {
      for (const id of [...ids]) {
        const table = ER_TABLE_BY_ID[id];
        if (table && table.group !== groupFilter && !hits.some((h) => h.table.id === id)) ids.delete(id);
      }
    }
    return ids;
  }, [selectedId, query, hits, groupFilter]);

  const layout = useMemo(() => {
    const selected = selectedId ? ER_TABLE_BY_ID[selectedId] : undefined;
    if (selected) {
      const links = edgesOfTable(selected.id);
      const { parents, children } = splitNeighbors(selected.id);
      const parentItems = [...parents.entries()]
        .map(([id, edges]) => {
          const table = ER_TABLE_BY_ID[id]!;
          return {
            id,
            h: neighborCardHeight(table, selected.id, links),
            order: Math.min(...edges.map((e) => colIndex(selected, e.fromCol)))
          };
        })
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const childItems = [...children.entries()]
        .map(([id]) => {
          const table = ER_TABLE_BY_ID[id]!;
          return { id, h: neighborCardHeight(table, selected.id, links) };
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      const leftEdgeCount = parentItems.reduce((n, it) => n + (parents.get(it.id)?.length ?? 1), 0);
      const rightEdgeCount = childItems.reduce((n, it) => n + (children.get(it.id)?.length ?? 1), 0);
      const leftGap = parentItems.length ? Math.max(150, 48 + leftEdgeCount * LANE_STEP) : 0;
      const rightGap = childItems.length ? Math.max(150, 48 + rightEdgeCount * LANE_STEP) : 0;
      const PAD = 32;
      const selectedH = cardHeight(selected.columns.length, MAX_FULL_H);
      const leftX = PAD;
      const selectedX = parentItems.length ? PAD + NEIGHBOR_W + leftGap : PAD;
      const rightX = selectedX + FULL_W + rightGap;
      const TITLE = 22;
      const startY = PAD + TITLE;
      const leftBoxes = stackVertical(parentItems, leftX, NEIGHBOR_W, startY, NEIGHBOR_GAP);
      const rightBoxes = stackVertical(childItems, rightX, NEIGHBOR_W, startY, NEIGHBOR_GAP);
      const boxes: Box[] = [
        { id: selected.id, x: selectedX, y: startY, w: FULL_W, h: selectedH },
        ...leftBoxes,
        ...rightBoxes
      ];
      const headers: Header[] = [{ id: "er-selected", title: "Выбранная таблица", x: selectedX, y: PAD, color: "#4c1d95" }];
      if (parentItems.length) headers.push({ id: "er-parents", title: "Ссылается на", x: leftX, y: PAD, color: "#64748b" });
      if (childItems.length) {
        headers.push({ id: "er-children", title: "Ссылаются на эту таблицу", x: rightX, y: PAD, color: "#64748b" });
      }
      const width = (childItems.length ? rightX + NEIGHBOR_W : selectedX + FULL_W) + PAD;
      const height = Math.max(startY + selectedH, stackBottom(leftBoxes, 0), stackBottom(rightBoxes, 0)) + PAD;
      return { boxes, headers, width, height, mode: "focus" as const };
    }

    const byGroup = new Map<ErGroupId, ErTable[]>();
    for (const g of ER_GROUPS) byGroup.set(g.id, []);
    for (const t of ER_TABLES) {
      if (!visibleIds.has(t.id)) continue;
      byGroup.get(t.group)?.push(t);
    }

    const boxes: Box[] = [];
    const headers: Header[] = [];
    const PAD = 20;
    const COL_W = COMPACT_W + 72;
    const GROUP_GAP = 18;
    let maxH = 0;
    OVERVIEW_COLS.forEach((groups, colIdx) => {
      let y = PAD;
      const x = PAD + colIdx * COL_W;
      for (const gid of groups) {
        const tables = byGroup.get(gid) ?? [];
        if (!tables.length) continue;
        const meta = ER_GROUP_BY_ID[gid];
        headers.push({ id: gid, title: meta.title, x, y, color: meta.color });
        y += 26;
        for (const t of tables) {
          boxes.push({ id: t.id, x, y, w: COMPACT_W, h: COMPACT_H });
          y += COMPACT_H + 10;
        }
        y += GROUP_GAP;
      }
      maxH = Math.max(maxH, y);
    });
    const width = PAD * 2 + OVERVIEW_COLS.length * COL_W;
    const height = Math.max(maxH + PAD, 420);
    return { boxes, headers, width, height, mode: "overview" as const };
  }, [selectedId, visibleIds]);

  const boxById = useMemo(() => Object.fromEntries(layout.boxes.map((b) => [b.id, b])), [layout.boxes]);

  const drawnEdges = useMemo(() => {
    const visible = new Set(layout.boxes.map((b) => b.id));
    const raw =
      layout.mode === "focus" && selectedId
        ? ER_EDGES.filter(
            (e) => (e.from === selectedId || e.to === selectedId) && visible.has(e.from) && visible.has(e.to)
          )
        : ER_EDGES.filter((e) => visible.has(e.from) && visible.has(e.to));
    const routed = routeEdges(layout.boxes, raw, layout.mode);
    const focus = selectedId ?? hoveredId;
    return routed.map((item) => ({
      ...item,
      active: Boolean(focus && (item.edge.from === focus || item.edge.to === focus))
    }));
  }, [layout, selectedId, hoveredId]);

  const highlightCol = useMemo(() => {
    if (!selectedId) return undefined;
    return hits.find((h) => h.table.id === selectedId)?.viaColumn;
  }, [hits, selectedId]);

  useEffect(() => {
    if (!selectedId || !canvasRef.current) return;
    const box = boxById[selectedId];
    if (!box) return;
    const el = canvasRef.current;
    const left = Math.max(0, box.x - 24);
    const top = Math.max(0, box.y - 24);
    el.scrollTo({ left, top, behavior: "smooth" });
  }, [selectedId, boxById]);

  const pickTable = (id: string) => {
    setSelectedId(id);
    setSuggestOpen(false);
    const table = ER_TABLE_BY_ID[id];
    if (table) setQuery(table.id);
  };

  const clearFocus = () => {
    setSelectedId(null);
    setQuery("");
    setSuggestOpen(false);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && hits[0]) {
      e.preventDefault();
      pickTable(hits[0].table.id);
    }
    if (e.key === "Escape") {
      setSuggestOpen(false);
      if (selectedId) clearFocus();
    }
  };

  const selected = selectedId ? ER_TABLE_BY_ID[selectedId] : undefined;
  const selectedLinks = selected ? edgesOfTable(selected.id) : [];
  const listTables = query.trim() ? hits.map((h) => h.table) : ER_TABLES.filter((t) => !groupFilter || t.group === groupFilter);

  return (
    <div className="erWrap">
      <div className="erToolbar">
        <div className="erSearch">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSuggestOpen(true);
              if (!e.target.value.trim()) setSelectedId(null);
            }}
            onFocus={() => setSuggestOpen(true)}
            onKeyDown={onSearchKey}
            placeholder="Поиск таблицы: MaintenanceEvent, «Ангар», eventId…"
            aria-label="Поиск таблицы"
            aria-autocomplete="list"
          />
          {query ? (
            <button type="button" className="btn btnGhost" onClick={clearFocus}>
              Сбросить
            </button>
          ) : null}
          {suggestOpen && query.trim() && hits.length > 0 ? (
            <ul className="erSuggest" role="listbox">
              {hits.slice(0, 12).map((hit) => (
                <li key={hit.table.id}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickTable(hit.table.id)}>
                    <b>{hit.table.id}</b>
                    <span>{hit.table.label}</span>
                    {hit.viaColumn ? <em>колонка {hit.viaColumn}</em> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="erToolbarMeta">
          <span>
            {visibleIds.size} из {ER_TABLES.length} таблиц · {drawnEdges.length} связей
          </span>
          {selected ? (
            <button type="button" className="btn btnGhost" onClick={clearFocus}>
              Вся схема
            </button>
          ) : null}
        </div>
      </div>

      <div className="erGroupRow" role="tablist" aria-label="Группы таблиц">
        <button
          type="button"
          className={groupFilter === null ? "erGroupChip erGroupChipOn" : "erGroupChip"}
          onClick={() => setGroupFilter(null)}
        >
          Все
        </button>
        {ER_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={groupFilter === g.id ? "erGroupChip erGroupChipOn" : "erGroupChip"}
            style={{ ["--er-chip" as string]: g.color }}
            onClick={() => {
              setGroupFilter((prev) => (prev === g.id ? null : g.id));
              if (selectedId) setSelectedId(null);
            }}
          >
            {g.title}
          </button>
        ))}
      </div>

      <div className="erBody">
        <aside className="erList" aria-label="Таблицы">
          {listTables.map((t) => {
            const g = ER_GROUP_BY_ID[t.group];
            const hit = hits.find((h) => h.table.id === t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={selectedId === t.id ? "erListItem erListItemOn" : "erListItem"}
                onClick={() => pickTable(t.id)}
              >
                <i style={{ background: g.color }} />
                <span>
                  <b>{t.id}</b>
                  <small>
                    {t.label}
                    {hit?.viaColumn ? ` · ${hit.viaColumn}` : ""}
                  </small>
                </span>
              </button>
            );
          })}
          {listTables.length === 0 ? <div className="muted erListEmpty">Нет таблиц по запросу</div> : null}
        </aside>

        <div className="erCanvas" ref={canvasRef} onClick={() => setSuggestOpen(false)}>
          <div className="erScene" style={{ width: layout.width, height: layout.height }}>
            <svg className="erSvg" width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker id={`${svgUid}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0 L8 4 L0 8 z" fill="rgba(37, 99, 235, 0.85)" />
                </marker>
                <marker id={`${svgUid}-arrowOn`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M0 0 L8 4 L0 8 z" fill="#7c3aed" />
                </marker>
              </defs>
              {drawnEdges.map((item, i) => (
                <g key={`${item.edge.from}-${item.edge.fromCol}-${item.edge.to}-${i}`}>
                  <path
                    className={item.active ? "erEdge erEdgeOn" : "erEdge"}
                    d={item.d}
                    markerEnd={`url(#${svgUid}-${item.active ? "arrowOn" : "arrow"})`}
                  />
                  {layout.mode === "focus" && item.active ? (
                    <text className="erEdgeLabel" x={item.lx} y={item.ly - 6} textAnchor="middle">
                      {item.edge.fromCol} → {item.edge.toCol} · {item.edge.rel}
                    </text>
                  ) : null}
                </g>
              ))}
            </svg>

            {layout.headers.map((h) => (
              <div key={h.id} className="erGroupTitle" style={{ left: h.x, top: h.y, color: h.color }}>
                {h.title}
              </div>
            ))}

            {layout.boxes.map((box) => {
              const table = ER_TABLE_BY_ID[box.id];
              if (!table) return null;
              const g = ER_GROUP_BY_ID[table.group];
              const isSel = table.id === selectedId;
              const isNeighbor = Boolean(selectedId && !isSel);
              const hot = selectedId ?? hoveredId;
              const hotSet = hot ? new Set([hot, ...neighborIds(hot)]) : null;
              const dim = Boolean(hotSet && !hotSet.has(table.id));
              const cols = isSel
                ? table.columns
                : isNeighbor && selected
                  ? neighborColumns(table, selected.id, selectedLinks)
                  : [];
              return (
                <article
                  key={table.id}
                  className={[
                    "erNode",
                    isSel ? "erNodeOn" : "",
                    isNeighbor ? "erNodeLink" : "",
                    dim ? "erNodeDim" : ""
                  ].join(" ")}
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.w,
                    height: box.h,
                    ["--er-node" as string]: g.color
                  }}
                  onMouseEnter={() => setHoveredId(table.id)}
                  onMouseLeave={() => setHoveredId((id) => (id === table.id ? null : id))}
                  onClick={() => pickTable(table.id)}
                >
                  <header className="erNodeHead">
                    <b>{table.id}</b>
                    <small>{table.label}</small>
                  </header>
                  {cols.length ? (
                    <>
                      <ColumnList columns={cols} highlight={isSel ? highlightCol : undefined} />
                      {isNeighbor && table.columns.length > cols.length ? (
                        <div className="erNodeMeta">ещё {table.columns.length - cols.length} колонок · нажмите</div>
                      ) : null}
                    </>
                  ) : (
                    <div className="erNodeMeta">
                      {table.columns.length} колонок · {edgesOfTable(table.id).length} связей
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <div className="erLegend">
        <span>
          <i className="erBadge erBadgePk">PK</i> первичный ключ
        </span>
        <span>
          <i className="erBadge erBadgeFk">FK</i> внешний ключ
        </span>
        <span>
          <i className="erBadge erBadgeUq">UQ</i> уникальное поле
        </span>
        <span>N:1 — много записей ссылаются на одну</span>
        <span>1:1 — связь один к одному</span>
        <span>Стрелка указывает на таблицу, на которую ссылается внешний ключ</span>
      </div>
    </div>
  );
}
