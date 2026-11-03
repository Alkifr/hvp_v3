export type TowDraftRow = {
  key: string;
  serverId: string | null;
  deleted: boolean;
  startAt: string;
  endAt: string;
  fromLabel: string;
  toLabel: string;
  placementId: string | null;
};

export type TowServerRow = {
  id: string;
  startAt: string;
  endAt: string;
  fromLabel?: string | null;
  toLabel?: string | null;
  placementId?: string | null;
};

export type PlacementLink = {
  key: string;
  origin: "MANUAL" | "AUTO_GAP";
  standId: string;
  hangarId: string;
  startMs: number;
  endMs: number;
};

export type SavedPlacementLink = {
  id: string;
  origin?: string | null;
  standId?: string | null;
  hangarId?: string | null;
  startAt: string;
  endAt: string;
};

const MATCH_SLACK_MS = 2 * 60 * 1000;

function iso(value: string): string {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

function label(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function towRowsFromServer(rows: TowServerRow[]): TowDraftRow[] {
  return rows.map((row) => ({
    key: row.id,
    serverId: row.id,
    deleted: false,
    startAt: iso(row.startAt),
    endAt: iso(row.endAt),
    fromLabel: label(row.fromLabel),
    toLabel: label(row.toLabel),
    placementId: row.placementId ?? null
  }));
}

export function newTowDraftKey(): string {
  return `local-${crypto.randomUUID()}`;
}

function sameInstant(a: string, b: string): boolean {
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return a === b;
  return left === right;
}

function sameRow(a: TowDraftRow, b: TowDraftRow): boolean {
  return (
    sameInstant(a.startAt, b.startAt) &&
    sameInstant(a.endAt, b.endAt) &&
    label(a.fromLabel) === label(b.fromLabel) &&
    label(a.toLabel) === label(b.toLabel) &&
    (a.placementId ?? "") === (b.placementId ?? "")
  );
}

export function towDraftDirty(rows: TowDraftRow[], baseline: TowDraftRow[]): boolean {
  const baseById = new Map(baseline.filter((row) => row.serverId).map((row) => [row.serverId!, row]));
  const live = rows.filter((row) => !row.deleted);
  if (live.some((row) => !row.serverId)) return true;
  if (rows.some((row) => row.deleted && row.serverId)) return true;
  const liveIds = new Set(live.map((row) => row.serverId).filter(Boolean));
  for (const id of baseById.keys()) {
    if (!liveIds.has(id)) return true;
  }
  return live.some((row) => {
    const prev = row.serverId ? baseById.get(row.serverId) : undefined;
    return !prev || !sameRow(row, prev);
  });
}

export type TowMutationPlan = {
  deleteIds: string[];
  update: TowDraftRow[];
  create: TowDraftRow[];
};

export function towMutationPlan(rows: TowDraftRow[], baseline: TowDraftRow[]): TowMutationPlan {
  const baseById = new Map(baseline.filter((row) => row.serverId).map((row) => [row.serverId!, row]));
  const deleteIds = rows.filter((row) => row.deleted && row.serverId).map((row) => row.serverId!);
  const update = rows.filter((row) => {
    if (!row.serverId || row.deleted) return false;
    const prev = baseById.get(row.serverId);
    return !prev || !sameRow(row, prev);
  });
  const create = rows.filter((row) => !row.serverId && !row.deleted);
  return { deleteIds, update, create };
}

export function resolveTowPlacementId(
  placementKey: string | null,
  before: PlacementLink[],
  after: SavedPlacementLink[] | null
): string | null {
  if (!placementKey) return null;
  if (!after) return placementKey;
  if (after.some((placement) => placement.id === placementKey)) return placementKey;
  const source = before.find((placement) => placement.key === placementKey);
  if (!source || source.origin === "AUTO_GAP") return null;
  const candidates = after.filter((placement) => {
    if ((placement.origin ?? "MANUAL") === "AUTO_GAP") return false;
    if ((placement.standId ?? "") !== source.standId) return false;
    if (source.hangarId && (placement.hangarId ?? "") !== source.hangarId) return false;
    const start = new Date(placement.startAt).getTime();
    const end = new Date(placement.endAt).getTime();
    return Math.abs(start - source.startMs) <= MATCH_SLACK_MS && Math.abs(end - source.endMs) <= MATCH_SLACK_MS;
  });
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      Math.abs(new Date(a.startAt).getTime() - source.startMs) - Math.abs(new Date(b.startAt).getTime() - source.startMs)
  );
  return candidates[0]!.id;
}
