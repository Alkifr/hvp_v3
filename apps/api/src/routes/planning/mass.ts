import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { EventAuditAction, EventStatus, PlanningLevel } from "@prisma/client";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";
import { canWriteInContext, sandboxFilter, sandboxIdFor } from "../../plugins/sandbox.js";

function assertCanWrite(req: any) {
  if (!canWriteInContext(req)) {
    const err: any = new Error("SANDBOX_READ_ONLY");
    err.statusCode = 403;
    throw err;
  }
}

function assertCanWriteEvent(req: any) {
  if (req.sandbox) {
    assertCanWrite(req);
    return;
  }
  assertPermission(req, "events:write");
}

function getActor(req: any) {
  const auth = req.auth as { email?: string } | undefined;
  if (auth?.email) return String(auth.email).slice(0, 80);
  const h = req.headers ?? {};
  return String(h["x-actor"] ?? h["x-user"] ?? "browser").slice(0, 80);
}

type StandEntry = { hangarId: string; layoutId: string; standId: string; priorityScore?: number; priorityRuleIds?: string[]; scoreDetails?: string[] };
type ScheduleMode = "compact" | "sequential" | "fixedCadence";
type PlacementMode = "auto" | "preferredHangars" | "draftOnConflict";
type BatchSolverMode = "ortools" | "hybrid" | "heuristic";
type BatchPlacementPreview = PlacementPreview & { rowIndex: number; itemIndex: number; operatorId: string; aircraftTypeId: string; eventTypeId: string };
type BatchUnplacedPreview = UnplacedPreview & { rowIndex: number; itemIndex: number; operatorId: string; aircraftTypeId: string; eventTypeId: string };
type BatchPlanningJob = {
  flatIndex: number;
  rowIndex: number;
  itemIndex: number;
  operatorId: string;
  aircraftTypeId: string;
  eventTypeId: string;
  title: string;
  label: string;
  startFromMs: number;
  endToMs: number;
  tatMs: number;
  spacingMs: number;
  cadenceMs: number | null;
  scheduleMode: ScheduleMode;
  nominalStartAt: number;
  bodyType: unknown;
  compatibleEntries: StandEntry[];
  candidateCount: number;
  maxPriorityScore: number;
  windowSlackMs: number;
};
function batchJobIntendedStartMs(job: BatchPlanningJob, nextStartByItem?: Map<number, number>): number {
  if (job.scheduleMode === "fixedCadence") return job.nominalStartAt;
  if (job.scheduleMode === "compact") return job.startFromMs;
  return Math.max(job.nominalStartAt, nextStartByItem?.get(job.rowIndex) ?? job.startFromMs);
}

function batchJobDraftStartMs(job: BatchPlanningJob, preferredStartMs = batchJobIntendedStartMs(job)): number {
  return draftStartWithinWindow({
    preferredStartMs,
    startFromMs: job.startFromMs,
    endToMs: job.endToMs,
    tatMs: job.tatMs,
    spacingMs: job.spacingMs,
    cadenceMs: job.cadenceMs,
    scheduleMode: job.scheduleMode,
    itemIndex: job.itemIndex
  });
}

function draftStartWithinWindow(params: {
  preferredStartMs: number;
  startFromMs: number;
  endToMs: number;
  tatMs: number;
  spacingMs: number;
  cadenceMs: number | null;
  scheduleMode: ScheduleMode;
  itemIndex: number;
}): number {
  const { preferredStartMs, startFromMs, endToMs, tatMs, spacingMs, cadenceMs, scheduleMode, itemIndex } = params;
  if (!Number.isFinite(startFromMs) || !Number.isFinite(endToMs) || endToMs <= startFromMs) return preferredStartMs;

  const latestStartMs = tatMs < endToMs - startFromMs ? Math.max(startFromMs, endToMs - tatMs) : startFromMs;
  const preferredInsideWindow = Number.isFinite(preferredStartMs) && preferredStartMs >= startFromMs && preferredStartMs <= latestStartMs;
  if (scheduleMode !== "compact" && preferredInsideWindow) return preferredStartMs;

  const stepMs = Math.max(1, scheduleMode === "fixedCadence" ? (cadenceMs ?? tatMs + spacingMs) : tatMs + spacingMs);
  const slotCount = Math.max(1, Math.floor((latestStartMs - startFromMs) / stepMs) + 1);
  return startFromMs + (itemIndex % slotCount) * stepMs;
}

type StandBusyContext = {
  busyByStand: Map<string, Array<{ start: number; end: number }>>;
  layoutLocksByHangar: Map<string, Array<{ layoutId: string; start: number; end: number }>>;
  blockBefore: number;
  blockAfter: number;
};

function standBusyIntervals(entry: StandEntry, ctx: StandBusyContext): Array<{ start: number; end: number }> {
  const standBusy = ctx.busyByStand.get(entry.standId) ?? [];
  const incompatibleLayoutLocks = (ctx.layoutLocksByHangar.get(entry.hangarId) ?? []).filter((lock) => lock.layoutId !== entry.layoutId);
  return [...standBusy, ...incompatibleLayoutLocks].sort((a, b) => a.start - b.start);
}

function analyzeStandFeasibility(job: BatchPlanningJob, entry: StandEntry, ctx: StandBusyContext) {
  const busy = standBusyIntervals(entry, ctx);
  const firstFreeAt = findFirstEventStart(busy, job.startFromMs, job.tatMs, job.endToMs, ctx.blockBefore, ctx.blockAfter);
  const slotInWindow = firstFreeAt != null && firstFreeAt <= job.endToMs;
  const layoutLockBlocks = (ctx.layoutLocksByHangar.get(entry.hangarId) ?? []).some(
    (lock) => lock.layoutId !== entry.layoutId && lock.start < job.endToMs && lock.end > job.startFromMs
  );
  const standBusyInWindow = (ctx.busyByStand.get(entry.standId) ?? []).filter(
    (block) => block.start < job.endToMs && block.end > job.startFromMs
  ).length;
  let blockedReason: string | null = null;
  if (!slotInWindow) {
    if (job.startFromMs > job.endToMs) blockedReason = "Начало периода позже крайнего допустимого старта";
    else if (layoutLockBlocks && standBusyInWindow === 0) blockedReason = "Блокировка другой схемой в ангаре на весь период";
    else if (standBusyInWindow > 0 && !layoutLockBlocks) blockedReason = "Стоянка занята в выбранном периоде";
    else if (layoutLockBlocks && standBusyInWindow > 0) blockedReason = "Стоянка занята и конфликт схем в ангаре";
    else blockedReason = "Нет свободного старта в окне [startFrom, endTo]";
  }
  return { busy, firstFreeAt, slotInWindow, layoutLockBlocks, standBusyInWindow, blockedReason };
}

function selectOrToolsCandidateEntries(job: BatchPlanningJob, ctx: StandBusyContext, maxEntries: number) {
  const ranked = job.compatibleEntries.map((entry) => ({ entry, ...analyzeStandFeasibility(job, entry, ctx) }));
  const feasible = ranked.filter((item) => item.slotInWindow);
  const selected: typeof ranked = [];
  const selectedStandIds = new Set<string>();
  const byHangar = new Map<string, typeof ranked>();
  for (const item of feasible) {
    const arr = byHangar.get(item.entry.hangarId) ?? [];
    arr.push(item);
    byHangar.set(item.entry.hangarId, arr);
  }
  for (const items of byHangar.values()) {
    if (selected.length >= maxEntries) break;
    const best = items[0]!;
    selected.push(best);
    selectedStandIds.add(best.entry.standId);
  }
  for (const item of feasible) {
    if (selected.length >= maxEntries) break;
    if (!selectedStandIds.has(item.entry.standId)) {
      selected.push(item);
      selectedStandIds.add(item.entry.standId);
    }
  }
  return {
    entries: selected.map((item) => item.entry),
    ranked: ranked.map((item) => ({
      entry: item.entry,
      firstFreeAt: item.firstFreeAt,
      slotInWindow: item.slotInWindow,
      layoutLockBlocks: item.layoutLockBlocks,
      standBusyInWindow: item.standBusyInWindow,
      blockedReason: item.blockedReason,
      inModel: selectedStandIds.has(item.entry.standId),
      excludedReason: selectedStandIds.has(item.entry.standId)
        ? null
        : item.slotInWindow
          ? `Не вошло в топ-${maxEntries} кандидатов OR-Tools`
          : item.blockedReason
    }))
  };
}

type SolverStandDiagnosticRow = {
  flatIndex: number;
  label: string;
  hangarId: string;
  hangarName: string;
  layoutId: string;
  layoutName: string;
  standId: string;
  standCode: string;
  priorityScore: number;
  slotInWindow: boolean;
  firstFreeAt: string | null;
  inOrToolsModel: boolean;
  excludedReason: string | null;
  orToolsSelected: boolean | null;
  layoutLockBlocks: boolean;
  standBusyBlocksInWindow: number;
};

type SolverJobDiagnosticRow = {
  flatIndex: number;
  label: string;
  title: string;
  aircraftType: string;
  eventType: string;
  scheduleMode: ScheduleMode;
  periodFrom: string;
  periodTo: string;
  tatHours: number;
  intendedStartAt: string;
  compatibleStandsTotal: number;
  feasibleStandsTotal: number;
  orToolsCandidates: number;
  sentToOrTools: boolean;
  placed: boolean;
  placementHangar: string | null;
  placementStand: string | null;
  placementScore: number | null;
  bestCandidateScore: number | null;
  bestFreeCandidateScore: number | null;
  selectedCandidateRank: number | null;
  betterFreeCandidates: number;
  decisionReason: string;
  topAlternatives: string;
  solverOutcome: string;
  unplacedReason: string | null;
};

type LayoutSwitchSuggestionRow = {
  eventId: string;
  eventTitle: string;
  aircraftLabel: string;
  hangarName: string;
  fromLayoutName: string;
  fromStandCode: string;
  toLayoutName: string;
  toStandCode: string;
  startAt: string;
  endAt: string;
  unlocksLayoutName: string;
  note: string;
};

type AlternativeScenarioRow = {
  scenarioId: string;
  scenarioType: "layout_switch";
  hangarName: string;
  targetLayoutName: string;
  feasible: boolean;
  requiredMoves: number;
  additionalPlacements: number;
  affectedEvents: string;
  unlockedJobs: string;
  score: number;
  reason: string;
  moves: string;
};

type MassReservationSnapshot = {
  id: string;
  eventId: string;
  standId: string;
  layoutId: string;
  startMs: number;
  endMs: number;
  standCode: string;
  hangarId: string;
  layoutName: string;
  eventTitle: string;
  aircraftLabel: string;
  aircraftTypeId: string | null;
};

type SolverDiagnosticsPayload = {
  solverMode: BatchSolverMode;
  solverEngine: "heuristic" | "ortools";
  solverStatus: string | null;
  fallbackReason: string | null;
  optimizedJobs: number;
  heuristicOnlyJobs: number;
  assignmentCount: number;
  layoutPairChecks: number;
  jobs: SolverJobDiagnosticRow[];
  standCandidates: SolverStandDiagnosticRow[];
  layoutSwitchSuggestions: LayoutSwitchSuggestionRow[];
  alternativeScenarios: AlternativeScenarioRow[];
};

type BatchSolverResult = {
  placements: BatchPlacementPreview[];
  unplaced: BatchUnplacedPreview[];
  solver: "heuristic" | "ortools";
  fallbackReason?: string;
  diagnostics?: SolverDiagnosticsPayload;
};

const MASS_PLAN_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 15_000 };
const BODY_TYPE_SCORE_FALLBACK: Record<"NARROW_BODY" | "WIDE_BODY", number> = {
  NARROW_BODY: 50,
  WIDE_BODY: 150
};
const NARROW_BODY_ON_WIDE_CAPABLE_STAND_PENALTY = -75;
const OR_TOOLS_SOLVER_TIME_LIMIT_SECONDS = 5;
const OR_TOOLS_FULL_SOLVER_TIME_LIMIT_SECONDS = 45;
const OR_TOOLS_MAX_OPTIMIZED_JOBS = 420;
const OR_TOOLS_SCHEDULING_MAX_STANDS_PER_JOB = 24;
const OR_TOOLS_SCHEDULING_LARGE_BATCH_MAX_STANDS_PER_JOB = 8;
const OR_TOOLS_SCHEDULING_MIN_STANDS_PER_JOB = 4;
const OR_TOOLS_SCHEDULING_MAX_SLOTS_PER_STAND = 6;
const OR_TOOLS_SCHEDULING_LARGE_BATCH_MAX_SLOTS_PER_STAND = 16;
const OR_TOOLS_SCHEDULING_MAX_ASSIGNMENTS = 24_000;
const OR_TOOLS_SCHEDULING_MAX_LAYOUT_PAIR_CHECKS = 600_000;
const OR_TOOLS_SCARCE_CANDIDATE_THRESHOLD = 4;
const OR_TOOLS_LONG_EVENT_HOURS = 24;
const OR_TOOLS_PLACED_OBJECTIVE_WEIGHT = 1_000_000_000_000;
type PlacementPreview = {
  index: number;
  title: string;
  label: string;
  startAt: number;
  endAt: number;
  hangarId: string;
  layoutId: string;
  standId: string;
  scheduledBy: ScheduleMode;
  warnings: string[];
  score?: number;
  scoreDetails?: string[];
  priorityRuleIds?: string[];
  towBeforeStartAt?: number;
  towBeforeEndAt?: number;
  towAfterStartAt?: number;
  towAfterEndAt?: number;
};

type UnplacedPreview = {
  index: number;
  title: string;
  label: string;
  intendedStartAt: number;
  warnings: string[];
  bestCandidateScore?: number;
  bestFreeCandidateScore?: number;
  bestCandidateDetails?: string[];
};

type BuildPlacementsParams = {
  count: number;
  titleBase: string;
  virtualLabel: (i: number) => string;
  standOrder: StandEntry[];
  busyByStand: Map<string, Array<{ start: number; end: number }>>;
  layoutLocksByHangar: Map<string, Array<{ layoutId: string; start: number; end: number }>>;
  startFromMs: number;
  endToMs: number;
  tatMs: number;
  spacingMs: number;
  cadenceMs: number | null;
  scheduleMode: ScheduleMode;
  placementMode: PlacementMode;
  towBeforeMs: number;
  towAfterMs: number;
  towBlocksStand: boolean;
};

function overlapsMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function findFirstEventStart(
  busy: Array<{ start: number; end: number }>,
  minEventStart: number,
  eventDurationMs: number,
  maxEventStartMs: number,
  towBeforeMs: number,
  towAfterMs: number
): number | null {
  if (minEventStart > maxEventStartMs) return null;
  let cursor = minEventStart;
  for (const b of busy) {
    const blockStart = cursor - towBeforeMs;
    const blockEnd = cursor + eventDurationMs + towAfterMs;
    if (b.end <= blockStart) continue;
    if (blockEnd <= b.start) return cursor;
    cursor = Math.max(cursor, b.end + towBeforeMs);
    if (cursor > maxEventStartMs) return null;
  }
  return cursor <= maxEventStartMs ? cursor : null;
}

function isEventStartFree(
  busy: Array<{ start: number; end: number }>,
  eventStart: number,
  eventDurationMs: number,
  towBeforeMs: number,
  towAfterMs: number
): boolean {
  const blockStart = eventStart - towBeforeMs;
  const blockEnd = eventStart + eventDurationMs + towAfterMs;
  return !busy.some((b) => overlapsMs(blockStart, blockEnd, b.start, b.end));
}

function pickBestPlacementCandidate(
  entries: StandEntry[],
  slotFor: (entry: StandEntry) => number | null
): { entry: StandEntry; slot: number } | null {
  let best: { entry: StandEntry; slot: number; score: number } | null = null;
  for (const entry of entries) {
    const slot = slotFor(entry);
    if (slot == null) continue;
    const score = entry.priorityScore ?? 0;
    if (!best || score > best.score || (score === best.score && slot < best.slot)) {
      best = { entry, slot, score };
    }
  }
  return best ? { entry: best.entry, slot: best.slot } : null;
}

function bestScoreSummary(entries: StandEntry[], freeEntryIds?: Set<string>) {
  const compatible = entries.reduce<StandEntry | null>((best, entry) => {
    if (!best || (entry.priorityScore ?? 0) > (best.priorityScore ?? 0)) return entry;
    return best;
  }, null);
  const free = entries.reduce<StandEntry | null>((best, entry) => {
    if (freeEntryIds && !freeEntryIds.has(entry.standId)) return best;
    if (!best || (entry.priorityScore ?? 0) > (best.priorityScore ?? 0)) return entry;
    return best;
  }, null);
  return {
    bestCandidateScore: compatible?.priorityScore,
    bestFreeCandidateScore: free?.priorityScore,
    bestCandidateDetails: compatible?.scoreDetails
  };
}

function unplacedScoreSummary(job: BatchPlanningJob, ctx: StandBusyContext) {
  const freeEntryIds = new Set<string>();
  for (const entry of job.compatibleEntries) {
    if (analyzeStandFeasibility(job, entry, ctx).slotInWindow) freeEntryIds.add(entry.standId);
  }
  return bestScoreSummary(job.compatibleEntries, freeEntryIds);
}

function wideBodyReservePenalty(
  bodyType: unknown,
  standAllowedTypeIds: string[],
  wideAircraftTypeIds: Set<string>,
  wideBodyPlacementScore: number
): number {
  if (bodyType !== "NARROW_BODY") return 0;
  if (wideAircraftTypeIds.size === 0) return 0;
  if (!standAcceptsWideBody(standAllowedTypeIds, wideAircraftTypeIds)) return 0;
  return -Math.max(NARROW_BODY_ON_WIDE_CAPABLE_STAND_PENALTY, wideBodyPlacementScore);
}

function massEventAircraftLabel(event: {
  title: string;
  aircraft?: { tailNumber?: string | null } | null;
  virtualAircraft?: unknown;
}): string {
  if (event.aircraft?.tailNumber) return event.aircraft.tailNumber;
  const virtual = event.virtualAircraft as { label?: string } | null;
  if (virtual?.label) return virtual.label;
  return event.title;
}

function massEventAircraftTypeId(event: {
  aircraft?: { typeId?: string | null } | null;
  virtualAircraft?: unknown;
}): string | null {
  if (event.aircraft?.typeId) return event.aircraft.typeId;
  const virtual = event.virtualAircraft as { aircraftTypeId?: string } | null;
  return virtual?.aircraftTypeId ?? null;
}

function standFreeForInterval(
  busyByStand: Map<string, Array<{ start: number; end: number }>>,
  standId: string,
  start: number,
  end: number
): boolean {
  const busy = busyByStand.get(standId) ?? [];
  return !busy.some((block) => block.start < end && block.end > start);
}

function standAcceptsAircraftType(stand: { allowedAircraftTypes: Array<{ aircraftTypeId: string }> }, aircraftTypeId: string | null): boolean {
  const allowed = stand.allowedAircraftTypes.map((link) => link.aircraftTypeId);
  return allowed.length === 0 || (aircraftTypeId != null && allowed.includes(aircraftTypeId));
}

function buildLayoutSwitchSuggestions(params: {
  reservations: MassReservationSnapshot[];
  layoutsWithStands: Array<{
    id: string;
    hangarId: string;
    name: string;
    stands: Array<{ id: string; code: string; allowedAircraftTypes: Array<{ aircraftTypeId: string }> }>;
  }>;
  hangarNameById: Map<string, string>;
  busyByStand: Map<string, Array<{ start: number; end: number }>>;
  layoutLocksByHangar: Map<string, Array<{ layoutId: string; start: number; end: number }>>;
}): LayoutSwitchSuggestionRow[] {
  const layoutsByHangar = new Map<string, typeof params.layoutsWithStands>();
  for (const layout of params.layoutsWithStands) {
    const arr = layoutsByHangar.get(layout.hangarId) ?? [];
    arr.push(layout);
    layoutsByHangar.set(layout.hangarId, arr);
  }

  const suggestions: LayoutSwitchSuggestionRow[] = [];
  const seen = new Set<string>();

  for (const reservation of params.reservations) {
    const hangarLayouts = layoutsByHangar.get(reservation.hangarId) ?? [];
    if (hangarLayouts.length < 2) continue;

    for (const targetLayout of hangarLayouts) {
      if (targetLayout.id === reservation.layoutId) continue;

      const targetStand =
        targetLayout.stands.find((stand) => stand.code === reservation.standCode && standAcceptsAircraftType(stand, reservation.aircraftTypeId)) ??
        targetLayout.stands.find((stand) => standAcceptsAircraftType(stand, reservation.aircraftTypeId));
      if (!targetStand) continue;

      const foreignLayoutLock = (params.layoutLocksByHangar.get(reservation.hangarId) ?? []).some(
        (lock) =>
          lock.layoutId !== targetLayout.id &&
          lock.layoutId !== reservation.layoutId &&
          lock.start < reservation.endMs &&
          lock.end > reservation.startMs
      );
      if (foreignLayoutLock) continue;

      const targetLayoutBusy = params.reservations.some(
        (other) =>
          other.id !== reservation.id &&
          other.layoutId === targetLayout.id &&
          other.startMs < reservation.endMs &&
          other.endMs > reservation.startMs
      );
      if (targetLayoutBusy) continue;

      if (!standFreeForInterval(params.busyByStand, targetStand.id, reservation.startMs, reservation.endMs)) continue;

      const key = `${reservation.id}:${targetLayout.id}:${targetStand.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      suggestions.push({
        eventId: reservation.eventId,
        eventTitle: reservation.eventTitle,
        aircraftLabel: reservation.aircraftLabel,
        hangarName: params.hangarNameById.get(reservation.hangarId) ?? reservation.hangarId,
        fromLayoutName: reservation.layoutName,
        fromStandCode: reservation.standCode,
        toLayoutName: targetLayout.name,
        toStandCode: targetStand.code,
        startAt: new Date(reservation.startMs).toISOString(),
        endAt: new Date(reservation.endMs).toISOString(),
        unlocksLayoutName: reservation.layoutName,
        note: "Решение о переносе принимает пользователь; перенос освободит текущую схему в ангаре"
      });
    }
  }

  return suggestions.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.aircraftLabel.localeCompare(b.aircraftLabel, "ru"));
}

function cloneBusyMap(source: Map<string, Array<{ start: number; end: number }>>) {
  const next = new Map<string, Array<{ start: number; end: number }>>();
  for (const [standId, busy] of source.entries()) next.set(standId, busy.map((block) => ({ ...block })));
  return next;
}

function intervalMatches(block: { start: number; end: number }, start: number, end: number): boolean {
  return block.start === start && block.end === end;
}

function removeBusyInterval(busyByStand: Map<string, Array<{ start: number; end: number }>>, standId: string, start: number, end: number) {
  const busy = busyByStand.get(standId) ?? [];
  busyByStand.set(
    standId,
    busy.filter((block) => !intervalMatches(block, start, end))
  );
}

function addBusyInterval(busyByStand: Map<string, Array<{ start: number; end: number }>>, standId: string, start: number, end: number) {
  const busy = busyByStand.get(standId) ?? [];
  busy.push({ start, end });
  busy.sort((a, b) => a.start - b.start);
  busyByStand.set(standId, busy);
}

function buildAlternativeScenarios(params: {
  jobs: BatchPlanningJob[];
  placements: BatchPlacementPreview[];
  reservations: MassReservationSnapshot[];
  layoutsWithStands: Array<{
    id: string;
    hangarId: string;
    name: string;
    stands: Array<{ id: string; code: string; allowedAircraftTypes: Array<{ aircraftTypeId: string }> }>;
  }>;
  hangarNameById: Map<string, string>;
  busyByStand: Map<string, Array<{ start: number; end: number }>>;
  blockBefore: number;
  blockAfter: number;
}): AlternativeScenarioRow[] {
  const placedJobIds = new Set(params.placements.map((placement) => placement.index));
  const unresolvedJobs = params.jobs.filter((job) => !placedJobIds.has(job.flatIndex));
  if (unresolvedJobs.length === 0) return [];

  const layoutsByHangar = new Map<string, typeof params.layoutsWithStands>();
  for (const layout of params.layoutsWithStands) {
    const arr = layoutsByHangar.get(layout.hangarId) ?? [];
    arr.push(layout);
    layoutsByHangar.set(layout.hangarId, arr);
  }

  const reservationsByHangar = new Map<string, MassReservationSnapshot[]>();
  for (const reservation of params.reservations) {
    const arr = reservationsByHangar.get(reservation.hangarId) ?? [];
    arr.push(reservation);
    reservationsByHangar.set(reservation.hangarId, arr);
  }

  const scenarios: AlternativeScenarioRow[] = [];

  for (const [hangarId, layouts] of layoutsByHangar.entries()) {
    if (layouts.length < 2) continue;
    const hangarReservations = reservationsByHangar.get(hangarId) ?? [];
    if (hangarReservations.length === 0) continue;

    for (const targetLayout of layouts) {
      const blockingReservations = hangarReservations.filter((reservation) => reservation.layoutId !== targetLayout.id);
      if (blockingReservations.length === 0) continue;

      const hypotheticalBusy = cloneBusyMap(params.busyByStand);
      const moves: string[] = [];
      let feasible = true;
      let reason = "Сценарий допустим: существующие события можно переложить на целевую схему";

      for (const reservation of blockingReservations.sort((a, b) => a.startMs - b.startMs || a.eventId.localeCompare(b.eventId))) {
        removeBusyInterval(hypotheticalBusy, reservation.standId, reservation.startMs, reservation.endMs);
        const candidateStand =
          targetLayout.stands.find((stand) => stand.code === reservation.standCode && standAcceptsAircraftType(stand, reservation.aircraftTypeId)) ??
          targetLayout.stands.find((stand) => standAcceptsAircraftType(stand, reservation.aircraftTypeId));

        if (!candidateStand) {
          feasible = false;
          reason = `Нет совместимой стоянки на схеме "${targetLayout.name}" для существующего события`;
          addBusyInterval(hypotheticalBusy, reservation.standId, reservation.startMs, reservation.endMs);
          break;
        }

        if (!standFreeForInterval(hypotheticalBusy, candidateStand.id, reservation.startMs, reservation.endMs)) {
          feasible = false;
          reason = `Целевая схема "${targetLayout.name}" конфликтует по занятости существующих событий`;
          addBusyInterval(hypotheticalBusy, reservation.standId, reservation.startMs, reservation.endMs);
          break;
        }

        addBusyInterval(hypotheticalBusy, candidateStand.id, reservation.startMs, reservation.endMs);
        moves.push(`${reservation.aircraftLabel}: ${reservation.layoutName}/${reservation.standCode} -> ${targetLayout.name}/${candidateStand.code}`);
      }

      const unlockedLabels: string[] = [];
      if (feasible) {
        const targetEntries: StandEntry[] = targetLayout.stands.map((stand) => ({
          hangarId,
          layoutId: targetLayout.id,
          standId: stand.id,
          priorityScore: 0
        }));

        for (const job of unresolvedJobs) {
          const compatibleEntries = targetEntries.filter((entry) =>
            job.compatibleEntries.some((candidate) => candidate.standId === entry.standId && candidate.layoutId === entry.layoutId)
          );
          if (compatibleEntries.length === 0) continue;
          const picked = pickBestPlacementCandidate(compatibleEntries, (entry) => {
            const busy = hypotheticalBusy.get(entry.standId) ?? [];
            const start = findFirstEventStart(busy, batchJobIntendedStartMs(job), job.tatMs, job.endToMs, params.blockBefore, params.blockAfter);
            if (start == null || start > job.endToMs) return null;
            return start;
          });
          if (!picked) continue;
          const end = picked.slot + job.tatMs;
          addBusyInterval(hypotheticalBusy, picked.entry.standId, picked.slot, end);
          unlockedLabels.push(job.label);
        }
      }

      const score = unlockedLabels.length * 1000 - blockingReservations.length * 100;
      scenarios.push({
        scenarioId: `${hangarId}:${targetLayout.id}`,
        scenarioType: "layout_switch",
        hangarName: params.hangarNameById.get(hangarId) ?? hangarId,
        targetLayoutName: targetLayout.name,
        feasible,
        requiredMoves: blockingReservations.length,
        additionalPlacements: feasible ? unlockedLabels.length : 0,
        affectedEvents: blockingReservations.map((reservation) => reservation.aircraftLabel).join("; "),
        unlockedJobs: unlockedLabels.join("; "),
        score: feasible ? score : -10_000,
        reason,
        moves: moves.join("; ")
      });
    }
  }

  return scenarios
    .filter((scenario) => scenario.feasible || scenario.additionalPlacements > 0)
    .sort((a, b) => b.score - a.score || a.requiredMoves - b.requiredMoves || a.hangarName.localeCompare(b.hangarName, "ru"));
}

function addTowFields<T extends Omit<PlacementPreview, "towBeforeStartAt" | "towBeforeEndAt" | "towAfterStartAt" | "towAfterEndAt">>(
  placement: T,
  towBeforeMs: number,
  towAfterMs: number,
  startFromMs: number
): T & PlacementPreview {
  const next = { ...placement } as T & PlacementPreview;
  if (towBeforeMs > 0) {
    next.towBeforeStartAt = next.startAt - towBeforeMs;
    next.towBeforeEndAt = next.startAt;
    if (next.towBeforeStartAt < startFromMs) next.warnings.push("Буксировка до события выходит за начало периода");
  }
  if (towAfterMs > 0) {
    next.towAfterStartAt = next.endAt;
    next.towAfterEndAt = next.endAt + towAfterMs;
  }
  return next;
}

function bodyTypeScore(bodyType: unknown, scoreByCode: Map<string, number>): { score: number; label: string | null } {
  if (bodyType === "WIDE_BODY") {
    return { score: scoreByCode.get("wide_body_placement_priority") ?? BODY_TYPE_SCORE_FALLBACK.WIDE_BODY, label: "Широкий фюзеляж" };
  }
  if (bodyType === "NARROW_BODY") {
    return { score: scoreByCode.get("narrow_body_placement_priority") ?? BODY_TYPE_SCORE_FALLBACK.NARROW_BODY, label: "Узкий фюзеляж" };
  }
  return { score: 0, label: null };
}

function bodyTypeRank(bodyType: unknown): number {
  if (bodyType === "WIDE_BODY") return 2;
  if (bodyType === "NARROW_BODY") return 1;
  return 0;
}

function standAcceptsWideBody(aircraftTypeIds: string[], wideAircraftTypeIds: Set<string>): boolean {
  return aircraftTypeIds.length === 0 || aircraftTypeIds.some((aircraftTypeId) => wideAircraftTypeIds.has(aircraftTypeId));
}

function compareBatchPlanningJobs(a: BatchPlanningJob, b: BatchPlanningJob): number {
  const bodyRankDiff = bodyTypeRank(b.bodyType) - bodyTypeRank(a.bodyType);
  if (bodyRankDiff !== 0) return bodyRankDiff;
  const candidateDiff = a.candidateCount - b.candidateCount;
  if (candidateDiff !== 0) return candidateDiff;
  const durationDiff = b.tatMs - a.tatMs;
  if (durationDiff !== 0) return durationDiff;
  const slackDiff = a.windowSlackMs - b.windowSlackMs;
  if (slackDiff !== 0) return slackDiff;
  const priorityDiff = b.maxPriorityScore - a.maxPriorityScore;
  if (priorityDiff !== 0) return priorityDiff;
  return a.flatIndex - b.flatIndex;
}

function shouldOptimizeWithOrTools(job: BatchPlanningJob): boolean {
  return (
    job.bodyType === "WIDE_BODY" ||
    job.candidateCount <= OR_TOOLS_SCARCE_CANDIDATE_THRESHOLD ||
    job.tatMs >= OR_TOOLS_LONG_EVENT_HOURS * 60 * 60 * 1000
  );
}

function buildBatchPlacement(
  job: BatchPlanningJob,
  entry: StandEntry,
  startAt: number,
  towBeforeMs: number,
  towAfterMs: number
): BatchPlacementPreview {
  const endAt = startAt + job.tatMs;
  const warnings: string[] = [];
  if (startAt > job.nominalStartAt && job.scheduleMode === "fixedCadence") warnings.push("Сдвинуто относительно фиксированного шага из-за занятости");
  return addTowFields(
    {
      index: job.flatIndex,
      rowIndex: job.rowIndex,
      itemIndex: job.itemIndex,
      operatorId: job.operatorId,
      aircraftTypeId: job.aircraftTypeId,
      eventTypeId: job.eventTypeId,
      title: job.title,
      label: job.label,
      startAt,
      endAt,
      hangarId: entry.hangarId,
      layoutId: entry.layoutId,
      standId: entry.standId,
      scheduledBy: job.scheduleMode,
      warnings,
      score: entry.priorityScore ?? 0,
      scoreDetails: entry.scoreDetails ?? [],
      priorityRuleIds: entry.priorityRuleIds
    },
    towBeforeMs,
    towAfterMs,
    job.startFromMs
  ) as BatchPlacementPreview;
}

function buildMassPlanPlacements(params: BuildPlacementsParams): {
  placements: PlacementPreview[];
  unplaced: UnplacedPreview[];
} {
  const {
    count,
    titleBase,
    virtualLabel,
    standOrder,
    busyByStand,
    layoutLocksByHangar,
    startFromMs,
    endToMs,
    tatMs,
    spacingMs,
    cadenceMs,
    scheduleMode,
    placementMode,
    towBeforeMs,
    towAfterMs,
    towBlocksStand
  } = params;

  const placements: PlacementPreview[] = [];
  const unplaced: UnplacedPreview[] = [];
  const busyByStandWork = new Map<string, Array<{ start: number; end: number }>>();
  for (const [standId, busy] of busyByStand.entries()) {
    busyByStandWork.set(standId, [...busy].sort((a, b) => a.start - b.start));
  }
  const layoutLocksWork = new Map<string, Array<{ layoutId: string; start: number; end: number }>>();
  for (const [hangarId, locks] of layoutLocksByHangar.entries()) {
    layoutLocksWork.set(hangarId, [...locks].sort((a, b) => a.start - b.start));
  }

  const blockBefore = towBlocksStand ? towBeforeMs : 0;
  const blockAfter = towBlocksStand ? towAfterMs : 0;
  let nextSequentialStart = startFromMs;

  const addBusy = (standId: string, start: number, end: number) => {
    const arr = busyByStandWork.get(standId) ?? [];
    arr.push({
      start: towBlocksStand ? start - towBeforeMs : start,
      end: towBlocksStand ? end + towAfterMs : end
    });
    arr.sort((a, b) => a.start - b.start);
    busyByStandWork.set(standId, arr);
  };
  const addLayoutLock = (entry: StandEntry, start: number, end: number) => {
    const arr = layoutLocksWork.get(entry.hangarId) ?? [];
    arr.push({
      layoutId: entry.layoutId,
      start: towBlocksStand ? start - towBeforeMs : start,
      end: towBlocksStand ? end + towAfterMs : end
    });
    arr.sort((a, b) => a.start - b.start);
    layoutLocksWork.set(entry.hangarId, arr);
  };

  for (let i = 0; i < count; i++) {
    const title = titleBase.includes("%") ? titleBase.replace("%", String(i + 1)) : `${titleBase} #${i + 1}`;
    const label = virtualLabel(i);
    const intendedStart =
      scheduleMode === "fixedCadence"
        ? startFromMs + i * (cadenceMs ?? tatMs + spacingMs)
        : scheduleMode === "sequential"
          ? nextSequentialStart
          : Math.max(startFromMs, nextSequentialStart);

    const picked = pickBestPlacementCandidate(standOrder, (entry) => {
      const standBusy = busyByStandWork.get(entry.standId) ?? [];
      const incompatibleLayoutLocks = (layoutLocksWork.get(entry.hangarId) ?? []).filter((lock) => lock.layoutId !== entry.layoutId);
      const busy = [...standBusy, ...incompatibleLayoutLocks].sort((a, b) => a.start - b.start);
      const slot =
        placementMode === "draftOnConflict"
          ? isEventStartFree(busy, intendedStart, tatMs, blockBefore, blockAfter)
            ? intendedStart
            : null
          : findFirstEventStart(busy, intendedStart, tatMs, endToMs, blockBefore, blockAfter);
      if (slot == null || slot > endToMs) return null;
      return slot;
    });

    if (picked == null) {
      const scoreSummary = bestScoreSummary(standOrder);
      const draftStartAt = draftStartWithinWindow({
        preferredStartMs: intendedStart,
        startFromMs,
        endToMs,
        tatMs,
        spacingMs,
        cadenceMs,
        scheduleMode,
        itemIndex: i
      });
      const warnings = [
        placementMode === "draftOnConflict"
          ? "Целевой слот занят, событие будет создано черновиком"
          : "Не найден свободный слот в выбранном периоде"
      ];
      if (draftStartAt !== intendedStart) warnings.push("Время черновика назначено внутри выбранного периода");
      unplaced.push({
        index: i,
        title,
        label,
        intendedStartAt: draftStartAt,
        warnings,
        ...scoreSummary
      });
      if (scheduleMode !== "fixedCadence") nextSequentialStart = intendedStart + tatMs + spacingMs;
      continue;
    }

    const bestEntry = picked.entry;
    const bestStart = picked.slot;
    const endAt = bestStart + tatMs;
    const warnings: string[] = [];
    if (bestStart > intendedStart && scheduleMode === "fixedCadence") {
      warnings.push("Сдвинуто относительно фиксированного шага из-за занятости");
    }
    const priorityScore = bestEntry.priorityScore ?? 0;
    const scoreDetails = bestEntry.scoreDetails ?? [];
    const placement = addTowFields(
      {
        index: i,
        title,
        label,
        startAt: bestStart,
        endAt,
        hangarId: bestEntry.hangarId,
        layoutId: bestEntry.layoutId,
        standId: bestEntry.standId,
        scheduledBy: scheduleMode,
        warnings,
        score: priorityScore,
        scoreDetails,
        priorityRuleIds: bestEntry.priorityRuleIds
      },
      towBeforeMs,
      towAfterMs,
      startFromMs
    );
    placements.push(placement);
    addBusy(bestEntry.standId, bestStart, endAt);
    addLayoutLock(bestEntry, bestStart, endAt);
    if (scheduleMode !== "fixedCadence") nextSequentialStart = endAt + spacingMs;
  }

  return { placements, unplaced };
}

export const massPlanningRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Массовое планирование: виртуальные борта (без реального Aircraft), период [startFrom, endTo].
   * endTo — крайний допустимый старт события; окончание может выходить за endTo (переходные события).
   * dryRun: true — предпросмотр (placements + unplaced). dryRun: false — создание событий.
   * Непоместившиеся создаются в статусе DRAFT без ангара/места.
   */
  app.post("/", async (req) => {
    assertCanWriteEvent(req);

    const body = z
      .object({
        tatHours: z.number().positive().max(8760),
        operatorId: zUuid,
        aircraftTypeId: zUuid,
        eventTypeId: zUuid,
        count: z.number().int().min(1).max(200),
        startFrom: z.string().transform((s) => new Date(s)),
        endTo: z.string().transform((s) => new Date(s)),
        hangarIds: z.array(zUuid).optional(),
        titleTemplate: z.string().trim().min(1).max(200).optional(),
        spacingHours: z.number().min(0).max(8760).optional().default(0),
        scheduleMode: z.enum(["compact", "sequential", "fixedCadence"]).optional().default("compact"),
        cadenceHours: z.number().positive().max(8760).optional(),
        placementMode: z.enum(["auto", "preferredHangars", "draftOnConflict"]).optional().default("auto"),
        budgetStartAt: zDateTime.nullable().optional(),
        budgetEndAt: zDateTime.nullable().optional(),
        actualStartAt: zDateTime.nullable().optional(),
        actualEndAt: zDateTime.nullable().optional(),
        towBeforeMinutes: z.number().int().min(0).max(24 * 60).optional().default(0),
        towAfterMinutes: z.number().int().min(0).max(24 * 60).optional().default(0),
        towBlocksStand: z.boolean().optional().default(false),
        dryRun: z.boolean().optional()
      })
      .refine((v) => Number.isFinite(v.startFrom.getTime()), { message: "startFrom must be a valid date" })
      .refine((v) => Number.isFinite(v.endTo.getTime()), { message: "endTo must be a valid date" })
      .refine((v) => v.endTo >= v.startFrom, { message: "endTo must be >= startFrom" })
      .refine((v) => v.scheduleMode !== "fixedCadence" || (v.cadenceHours ?? 0) > 0, {
        message: "cadenceHours is required for fixedCadence"
      })
      .refine((v) => Boolean(v.budgetStartAt) === Boolean(v.budgetEndAt), { message: "budget period must have both dates" })
      .refine((v) => !v.budgetStartAt || !v.budgetEndAt || v.budgetEndAt > v.budgetStartAt, {
        message: "budgetEndAt must be after budgetStartAt"
      })
      .refine((v) => Boolean(v.actualStartAt) === Boolean(v.actualEndAt), { message: "actual period must have both dates" })
      .refine((v) => !v.actualStartAt || !v.actualEndAt || v.actualEndAt > v.actualStartAt, {
        message: "actualEndAt must be after actualStartAt"
      })
      .parse(req.body);

    const dryRun = Boolean(body.dryRun);
    const tatMs = body.tatHours * 60 * 60 * 1000;
    const spacingMs = body.spacingHours * 60 * 60 * 1000;
    const cadenceMs = body.cadenceHours ? body.cadenceHours * 60 * 60 * 1000 : null;
    const towBeforeMs = body.towBeforeMinutes * 60 * 1000;
    const towAfterMs = body.towAfterMinutes * 60 * 1000;
    const startFromMs = body.startFrom.getTime();
    const endToMs = body.endTo.getTime();
    const windowEnd = new Date(Math.max(endToMs + tatMs + towAfterMs, startFromMs + body.count * (tatMs + spacingMs)));

    const [eventType, aircraftType, hangarsOrdered, layoutsWithStands, reservations, bodyTypeScoreRules] = await Promise.all([
      app.prisma.eventType.findUniqueOrThrow({ where: { id: body.eventTypeId } }),
      app.prisma.aircraftType.findUniqueOrThrow({ where: { id: body.aircraftTypeId } }),
      body.hangarIds?.length
        ? app.prisma.hangar.findMany({
            where: { id: { in: body.hangarIds }, isActive: true },
            orderBy: []
          }).then((list) => {
            const byId = new Map(list.map((h) => [h.id, h]));
            return body.hangarIds!.map((id) => byId.get(id)).filter(Boolean) as typeof list;
          })
        : app.prisma.hangar.findMany({
            where: { isActive: true },
            orderBy: [{ name: "asc" }]
          }),
      (async () => {
        const hid = body.hangarIds?.length
          ? body.hangarIds
          : (await app.prisma.hangar.findMany({ where: { isActive: true }, select: { id: true }, orderBy: [{ name: "asc" }] })).map((h) => h.id);
        const layouts = await app.prisma.hangarLayout.findMany({
          where: { hangarId: { in: hid }, isActive: true },
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
          include: {
            stands: {
              where: { isActive: true },
              select: { id: true, bodyType: true, code: true, allowedAircraftTypes: { select: { aircraftTypeId: true } } },
              orderBy: [{ code: "asc" }]
            },
            hangar: { select: { id: true } }
          }
        });
        const orderIdx = (id: string) => hid.indexOf(id);
        layouts.sort((a, b) => orderIdx(a.hangarId) - orderIdx(b.hangarId));
        return layouts;
      })(),
      app.prisma.standReservation.findMany({
        where: {
          ...sandboxFilter(req),
          startAt: { lt: windowEnd },
          endAt: { gt: body.startFrom },
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        select: {
          standId: true,
          layoutId: true,
          startAt: true,
          endAt: true,
          layout: { select: { hangarId: true } },
          event: { select: { towSegments: { select: { startAt: true, endAt: true } } } }
        }
      }),
      app.prisma.optimizationScoreRule.findMany({
        where: {
          isActive: true,
          code: { in: ["wide_body_placement_priority", "narrow_body_placement_priority"] },
          profile: { isDefault: true, isActive: true }
        },
        select: { code: true, value: true }
      })
    ]);
    const bodyTypeScoreByCode = new Map(bodyTypeScoreRules.map((rule) => [rule.code, rule.value]));

    const hangarIdSet = new Set(hangarsOrdered.map((h) => h.id));
    const priorityRules = await app.prisma.placementPriorityRule.findMany({
      where: {
        isActive: true,
        hangarId: { in: hangarsOrdered.map((h) => h.id) },
        OR: [
          { eventTypes: { none: {} } },
          { eventTypes: { some: { eventTypeId: body.eventTypeId } } }
        ],
        AND: [
          {
            OR: [
              { aircraftTypes: { none: {} } },
              { aircraftTypes: { some: { aircraftTypeId: body.aircraftTypeId } } }
            ]
          }
        ]
      },
      select: { id: true, hangarId: true, layoutId: true, standId: true, priorityScore: true }
    });
    const priorityByTarget = new Map<string, { score: number; ruleIds: string[] }>();
    for (const rule of priorityRules) {
      const key = `stand:${rule.standId}`;
      const current = priorityByTarget.get(key) ?? { score: 0, ruleIds: [] };
      current.score += rule.priorityScore;
      current.ruleIds.push(rule.id);
      priorityByTarget.set(key, current);
    }

    const priorityFor = (entry: Omit<StandEntry, "priorityScore" | "priorityRuleIds">) => {
      const keys = [`stand:${entry.standId}`];
      const matched = keys.map((key) => priorityByTarget.get(key)).filter((x): x is { score: number; ruleIds: string[] } => x != null);
      return {
        score: matched.reduce((sum, item) => sum + item.score, 0),
        ruleIds: matched.flatMap((item) => item.ruleIds).filter((id, pos, arr) => arr.indexOf(id) === pos)
      };
    };

    const standOrder: StandEntry[] = [];
    for (const lay of layoutsWithStands) {
      if (!hangarIdSet.has(lay.hangarId)) continue;
      for (const s of lay.stands) {
        const allowedAircraftTypeIds = s.allowedAircraftTypes.map((link) => link.aircraftTypeId);
        if (allowedAircraftTypeIds.length > 0 && !allowedAircraftTypeIds.includes(aircraftType.id)) continue;
        const baseEntry = { hangarId: lay.hangarId, layoutId: lay.id, standId: s.id };
        const priority = priorityFor(baseEntry);
        const bodyScore = bodyTypeScore(aircraftType.bodyType, bodyTypeScoreByCode);
        standOrder.push({
          ...baseEntry,
          priorityScore: priority.score + bodyScore.score,
          priorityRuleIds: priority.ruleIds,
          scoreDetails: [
            ...(priority.score > 0 ? [`Приоритет размещения: +${priority.score}`] : []),
            ...(bodyScore.score > 0 && bodyScore.label ? [`${bodyScore.label}: +${bodyScore.score}`] : [])
          ]
        });
      }
    }

    const busyByStand = new Map<string, Array<{ start: number; end: number }>>();
    const layoutLocksByHangar = new Map<string, Array<{ layoutId: string; start: number; end: number }>>();
    for (const r of reservations) {
      const arr = busyByStand.get(r.standId) ?? [];
      const towStarts = body.towBlocksStand ? r.event.towSegments.map((t) => t.startAt.getTime()) : [];
      const towEnds = body.towBlocksStand ? r.event.towSegments.map((t) => t.endAt.getTime()) : [];
      const start = Math.min(r.startAt.getTime(), ...towStarts);
      const end = Math.max(r.endAt.getTime(), ...towEnds);
      arr.push({ start, end });
      busyByStand.set(r.standId, arr);
      const locks = layoutLocksByHangar.get(r.layout.hangarId) ?? [];
      locks.push({ layoutId: r.layoutId, start, end });
      layoutLocksByHangar.set(r.layout.hangarId, locks);
    }
    for (const arr of busyByStand.values()) {
      arr.sort((a, b) => a.start - b.start);
    }
    for (const arr of layoutLocksByHangar.values()) {
      arr.sort((a, b) => a.start - b.start);
    }

    const hangarOrder = hangarsOrdered.map((h) => h.id);
    standOrder.sort((a, b) => {
      const ai = hangarOrder.indexOf(a.hangarId);
      const bi = hangarOrder.indexOf(b.hangarId);
      if (ai !== bi) return ai - bi;
      return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
    });

    const titleBase = body.titleTemplate ?? eventType.name;
    const virtualLabel = (i: number) => `— Масс. ${i + 1}`;

    const { placements: placementsPreview, unplaced: unplacedPreview } = buildMassPlanPlacements({
      count: body.count,
      titleBase,
      virtualLabel,
      standOrder,
      busyByStand,
      layoutLocksByHangar,
      startFromMs,
      endToMs,
      tatMs,
      spacingMs,
      cadenceMs,
      scheduleMode: body.scheduleMode,
      placementMode: body.placementMode,
      towBeforeMs,
      towAfterMs,
      towBlocksStand: body.towBlocksStand
    });

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        placements: placementsPreview.map((p) => ({
          ...p,
          startAt: new Date(p.startAt).toISOString(),
          endAt: new Date(p.endAt).toISOString(),
          budgetStartAt: body.budgetStartAt?.toISOString() ?? null,
          budgetEndAt: body.budgetEndAt?.toISOString() ?? null,
          actualStartAt: body.actualStartAt?.toISOString() ?? null,
          actualEndAt: body.actualEndAt?.toISOString() ?? null,
          towBeforeStartAt: p.towBeforeStartAt ? new Date(p.towBeforeStartAt).toISOString() : undefined,
          towBeforeEndAt: p.towBeforeEndAt ? new Date(p.towBeforeEndAt).toISOString() : undefined,
          towAfterStartAt: p.towAfterStartAt ? new Date(p.towAfterStartAt).toISOString() : undefined,
          towAfterEndAt: p.towAfterEndAt ? new Date(p.towAfterEndAt).toISOString() : undefined
        })),
        unplaced: unplacedPreview.map((u) => ({
          ...u,
          intendedStartAt: new Date(u.intendedStartAt).toISOString()
        })),
        summary: {
          total: body.count,
          placed: placementsPreview.length,
          unplaced: unplacedPreview.length,
          createdTowsBefore: placementsPreview.filter((p) => p.towBeforeStartAt != null).length,
          createdTowsAfter: placementsPreview.filter((p) => p.towAfterStartAt != null).length,
          draftOnConflict: body.placementMode === "draftOnConflict"
        }
      };
    }

    const virtualAircraftBase = {
      operatorId: body.operatorId,
      aircraftTypeId: body.aircraftTypeId
    };
    const sbId = sandboxIdFor(req);

    const result = await app.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const created: Array<{
          eventId: string;
          label: string;
          title: string;
          startAt: Date;
          endAt: Date;
          budgetStartAt: Date | null;
          budgetEndAt: Date | null;
          actualStartAt: Date | null;
          actualEndAt: Date | null;
          hangarId: string | null;
          layoutId: string | null;
          standId: string | null;
          status: EventStatus;
          towBeforeStartAt?: Date;
          towBeforeEndAt?: Date;
          towAfterStartAt?: Date;
          towAfterEndAt?: Date;
        }> = [];

      for (let i = 0; i < body.count; i++) {
        const title = titleBase.includes("%") ? titleBase.replace("%", String(i + 1)) : `${titleBase} #${i + 1}`;
        const label = virtualLabel(i);
        const virtualAircraft = { ...virtualAircraftBase, label } as object;

        const p = placementsPreview.find((x) => x.index === i);
        if (p) {
          const startAt = new Date(p.startAt);
          const endAt = new Date(p.endAt);
          const ev = await tx.maintenanceEvent.create({
            data: {
              level: PlanningLevel.OPERATIONAL,
              status: EventStatus.PLANNED,
              planningKind: body.budgetStartAt && body.budgetEndAt ? "PLANNED" : "UNPLANNED",
              title,
              sandboxId: sbId,
              eventTypeId: body.eventTypeId,
              startAt,
              endAt,
              budgetStartAt: body.budgetStartAt ?? null,
              budgetEndAt: body.budgetEndAt ?? null,
              actualStartAt: body.actualStartAt ?? null,
              actualEndAt: body.actualEndAt ?? null,
              hangarId: p.hangarId,
              layoutId: p.layoutId,
              virtualAircraft: virtualAircraft as Prisma.InputJsonValue
            }
          });
          const placement = await tx.eventPlacement.create({
            data: {
              eventId: ev.id,
              sandboxId: sbId,
              startAt,
              endAt,
              budgetStartAt: body.budgetStartAt ?? null,
              budgetEndAt: body.budgetEndAt ?? null,
              actualStartAt: body.actualStartAt ?? null,
              actualEndAt: body.actualEndAt ?? null,
              hangarId: p.hangarId,
              layoutId: p.layoutId,
              standId: p.standId,
              sortOrder: 0
            }
          });
          await tx.standReservation.create({
            data: { eventId: ev.id, placementId: placement.id, sandboxId: sbId, layoutId: p.layoutId, standId: p.standId, startAt, endAt }
          });
          const towRows = [
            p.towBeforeStartAt != null && p.towBeforeEndAt != null
              ? { eventId: ev.id, sandboxId: sbId, startAt: new Date(p.towBeforeStartAt), endAt: new Date(p.towBeforeEndAt) }
              : null,
            p.towAfterStartAt != null && p.towAfterEndAt != null
              ? { eventId: ev.id, sandboxId: sbId, startAt: new Date(p.towAfterStartAt), endAt: new Date(p.towAfterEndAt) }
              : null
          ].filter((row): row is { eventId: string; sandboxId: string | null; startAt: Date; endAt: Date } => row != null);
          if (towRows.length > 0) await tx.eventTow.createMany({ data: towRows });
          await tx.maintenanceEventAudit.create({
            data: {
              eventId: ev.id,
              sandboxId: sbId,
              action: EventAuditAction.CREATE,
              actor: getActor(req),
              reason: "Массовое планирование",
              changes: {
                massPlan: {
                  placed: true,
                  hangarId: p.hangarId,
                  layoutId: p.layoutId,
                  standId: p.standId,
                  scheduleMode: body.scheduleMode,
                  spacingHours: body.spacingHours,
                  cadenceHours: body.cadenceHours ?? null,
                  placementMode: body.placementMode,
                  towBeforeMinutes: body.towBeforeMinutes,
                  towAfterMinutes: body.towAfterMinutes,
                  towBlocksStand: body.towBlocksStand,
                  budgetStartAt: body.budgetStartAt?.toISOString() ?? null,
                  budgetEndAt: body.budgetEndAt?.toISOString() ?? null,
                  actualStartAt: body.actualStartAt?.toISOString() ?? null,
                  actualEndAt: body.actualEndAt?.toISOString() ?? null,
                  score: p.score ?? 0,
                  scoreDetails: p.scoreDetails ?? [],
                  priorityRuleIds: p.priorityRuleIds ?? [],
                  warnings: p.warnings
                }
              }
            }
          });
          created.push({
            eventId: ev.id,
            label,
            title: ev.title,
            startAt,
            endAt,
            budgetStartAt: body.budgetStartAt ?? null,
            budgetEndAt: body.budgetEndAt ?? null,
            actualStartAt: body.actualStartAt ?? null,
            actualEndAt: body.actualEndAt ?? null,
            hangarId: p.hangarId,
            layoutId: p.layoutId,
            standId: p.standId,
            status: EventStatus.PLANNED,
            towBeforeStartAt: p.towBeforeStartAt != null ? new Date(p.towBeforeStartAt) : undefined,
            towBeforeEndAt: p.towBeforeEndAt != null ? new Date(p.towBeforeEndAt) : undefined,
            towAfterStartAt: p.towAfterStartAt != null ? new Date(p.towAfterStartAt) : undefined,
            towAfterEndAt: p.towAfterEndAt != null ? new Date(p.towAfterEndAt) : undefined
          });
        } else {
          const u = unplacedPreview.find((x) => x.index === i);
          const startAt = new Date(
            u?.intendedStartAt ??
              draftStartWithinWindow({
                preferredStartMs: startFromMs + i * (tatMs + spacingMs),
                startFromMs,
                endToMs,
                tatMs,
                spacingMs,
                cadenceMs,
                scheduleMode: body.scheduleMode,
                itemIndex: i
              })
          );
          const endAt = new Date(startAt.getTime() + tatMs);
          const ev = await tx.maintenanceEvent.create({
            data: {
              level: PlanningLevel.OPERATIONAL,
              status: EventStatus.DRAFT,
              planningKind: body.budgetStartAt && body.budgetEndAt ? "PLANNED" : "UNPLANNED",
              title,
              sandboxId: sbId,
              eventTypeId: body.eventTypeId,
              startAt,
              endAt,
              budgetStartAt: body.budgetStartAt ?? null,
              budgetEndAt: body.budgetEndAt ?? null,
              actualStartAt: body.actualStartAt ?? null,
              actualEndAt: body.actualEndAt ?? null,
              hangarId: null,
              layoutId: null,
              virtualAircraft: virtualAircraft as Prisma.InputJsonValue
            }
          });
          await tx.maintenanceEventAudit.create({
            data: {
              eventId: ev.id,
              sandboxId: sbId,
              action: EventAuditAction.CREATE,
              actor: getActor(req),
              reason: "Массовое планирование (черновик — не поместилось в период)",
              changes: {
                massPlan: {
                  placed: false,
                  draft: true,
                  scheduleMode: body.scheduleMode,
                  spacingHours: body.spacingHours,
                  cadenceHours: body.cadenceHours ?? null,
                  placementMode: body.placementMode,
                  towBeforeMinutes: body.towBeforeMinutes,
                  towAfterMinutes: body.towAfterMinutes,
                  towBlocksStand: body.towBlocksStand,
                  budgetStartAt: body.budgetStartAt?.toISOString() ?? null,
                  budgetEndAt: body.budgetEndAt?.toISOString() ?? null,
                  actualStartAt: body.actualStartAt?.toISOString() ?? null,
                  actualEndAt: body.actualEndAt?.toISOString() ?? null,
                  warnings: u?.warnings ?? []
                }
              }
            }
          });
          created.push({
            eventId: ev.id,
            label,
            title: ev.title,
            startAt,
            endAt,
            budgetStartAt: body.budgetStartAt ?? null,
            budgetEndAt: body.budgetEndAt ?? null,
            actualStartAt: body.actualStartAt ?? null,
            actualEndAt: body.actualEndAt ?? null,
            hangarId: null,
            layoutId: null,
            standId: null,
            status: EventStatus.DRAFT
          });
        }
      }

      return created;
      },
      MASS_PLAN_TRANSACTION_OPTIONS
    );

    return {
      ok: true,
      dryRun: false,
      created: result.length,
      placed: result.filter((r) => r.status === EventStatus.PLANNED).length,
      unplaced: result.filter((r) => r.status === EventStatus.DRAFT).length,
      createdTowsBefore: result.filter((r) => r.towBeforeStartAt != null).length,
      createdTowsAfter: result.filter((r) => r.towAfterStartAt != null).length,
      events: result.map((r) => ({
        ...r,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        budgetStartAt: r.budgetStartAt?.toISOString() ?? null,
        budgetEndAt: r.budgetEndAt?.toISOString() ?? null,
        actualStartAt: r.actualStartAt?.toISOString() ?? null,
        actualEndAt: r.actualEndAt?.toISOString() ?? null,
        towBeforeStartAt: r.towBeforeStartAt?.toISOString(),
        towBeforeEndAt: r.towBeforeEndAt?.toISOString(),
        towAfterStartAt: r.towAfterStartAt?.toISOString(),
        towAfterEndAt: r.towAfterEndAt?.toISOString()
      }))
    };
  });

  app.post("/batch", async (req) => {
    assertCanWriteEvent(req);

    const zBatchItem = z
      .object({
        tatHours: z.number().positive().max(8760),
        operatorId: zUuid,
        aircraftTypeId: zUuid,
        eventTypeId: zUuid,
        count: z.number().int().min(1).max(200),
        startFrom: z.string().transform((s) => new Date(s)),
        endTo: z.string().transform((s) => new Date(s)),
        titleTemplate: z.string().trim().min(1).max(200).optional(),
        spacingHours: z.number().min(0).max(8760).optional().default(0),
        scheduleMode: z.enum(["compact", "sequential", "fixedCadence"]).optional().default("compact"),
        cadenceHours: z.number().positive().max(8760).optional()
      })
      .refine((v) => Number.isFinite(v.startFrom.getTime()), { message: "item.startFrom must be a valid date" })
      .refine((v) => Number.isFinite(v.endTo.getTime()), { message: "item.endTo must be a valid date" })
      .refine((v) => v.endTo >= v.startFrom, { message: "item.endTo must be >= item.startFrom" })
      .refine((v) => v.scheduleMode !== "fixedCadence" || (v.cadenceHours ?? 0) > 0, {
        message: "item.cadenceHours is required for fixedCadence"
      });

    const body = z
      .object({
        items: z.array(zBatchItem).min(1),
        hangarIds: z.array(zUuid).optional(),
        placementMode: z.enum(["auto", "preferredHangars", "draftOnConflict"]).optional().default("auto"),
        budgetStartAt: zDateTime.nullable().optional(),
        budgetEndAt: zDateTime.nullable().optional(),
        actualStartAt: zDateTime.nullable().optional(),
        actualEndAt: zDateTime.nullable().optional(),
        towBeforeMinutes: z.number().int().min(0).max(24 * 60).optional().default(0),
        towAfterMinutes: z.number().int().min(0).max(24 * 60).optional().default(0),
        towBlocksStand: z.boolean().optional().default(false),
        solverMode: z.enum(["ortools", "hybrid", "heuristic"]).optional().default("ortools"),
        dryRun: z.boolean().optional()
      })
      .refine((v) => Boolean(v.budgetStartAt) === Boolean(v.budgetEndAt), { message: "budget period must have both dates" })
      .refine((v) => !v.budgetStartAt || !v.budgetEndAt || v.budgetEndAt > v.budgetStartAt, {
        message: "budgetEndAt must be after budgetStartAt"
      })
      .refine((v) => Boolean(v.actualStartAt) === Boolean(v.actualEndAt), { message: "actual period must have both dates" })
      .refine((v) => !v.actualStartAt || !v.actualEndAt || v.actualEndAt > v.actualStartAt, {
        message: "actualEndAt must be after actualStartAt"
      })
      .parse(req.body);

    const dryRun = Boolean(body.dryRun);
    const towBeforeMs = body.towBeforeMinutes * 60 * 1000;
    const towAfterMs = body.towAfterMinutes * 60 * 1000;
    const blockBefore = body.towBlocksStand ? towBeforeMs : 0;
    const blockAfter = body.towBlocksStand ? towAfterMs : 0;
    const minStart = new Date(Math.min(...body.items.map((item) => item.startFrom.getTime())));
    const maxEnd = new Date(
      Math.max(...body.items.map((item) => item.endTo.getTime() + item.tatHours * 60 * 60 * 1000 + towAfterMs))
    );
    const aircraftTypeIds = Array.from(new Set(body.items.map((item) => item.aircraftTypeId)));
    const eventTypeIds = Array.from(new Set(body.items.map((item) => item.eventTypeId)));

    const [eventTypes, aircraftTypes, allWideAircraftTypes, hangarsOrdered, layoutsWithStands, reservations, priorityRules, bodyTypeScoreRules] = await Promise.all([
      app.prisma.eventType.findMany({ where: { id: { in: eventTypeIds } } }),
      app.prisma.aircraftType.findMany({ where: { id: { in: aircraftTypeIds } } }),
      app.prisma.aircraftType.findMany({ where: { bodyType: "WIDE_BODY" }, select: { id: true } }),
      body.hangarIds?.length
        ? app.prisma.hangar
            .findMany({
              where: { id: { in: body.hangarIds }, isActive: true },
              orderBy: []
            })
            .then((list) => {
              const byId = new Map(list.map((h) => [h.id, h]));
              return body.hangarIds!.map((id) => byId.get(id)).filter(Boolean) as typeof list;
            })
        : app.prisma.hangar.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }] }),
      (async () => {
        const hid = body.hangarIds?.length
          ? body.hangarIds
          : (await app.prisma.hangar.findMany({ where: { isActive: true }, select: { id: true }, orderBy: [{ name: "asc" }] })).map((h) => h.id);
        const layouts = await app.prisma.hangarLayout.findMany({
          where: { hangarId: { in: hid }, isActive: true },
          include: {
            stands: {
              where: { isActive: true },
              select: { id: true, code: true, allowedAircraftTypes: { select: { aircraftTypeId: true } } },
              orderBy: [{ code: "asc" }]
            }
          }
        });
        const orderIdx = (id: string) => hid.indexOf(id);
        layouts.sort((a, b) => orderIdx(a.hangarId) - orderIdx(b.hangarId));
        return layouts;
      })(),
      app.prisma.standReservation.findMany({
        where: {
          ...sandboxFilter(req),
          startAt: { lt: maxEnd },
          endAt: { gt: minStart },
          event: { status: { notIn: [EventStatus.CANCELLED, EventStatus.DELETED] } }
        },
        select: {
          id: true,
          eventId: true,
          standId: true,
          layoutId: true,
          startAt: true,
          endAt: true,
          stand: { select: { code: true } },
          layout: { select: { hangarId: true, name: true } },
          event: {
            select: {
              title: true,
              virtualAircraft: true,
              aircraft: { select: { tailNumber: true, typeId: true } },
              towSegments: { select: { startAt: true, endAt: true } }
            }
          }
        }
      }),
      app.prisma.placementPriorityRule.findMany({
        where: { isActive: true },
        include: {
          eventTypes: { select: { eventTypeId: true } },
          aircraftTypes: { select: { aircraftTypeId: true } }
        }
      }),
      app.prisma.optimizationScoreRule.findMany({
        where: {
          isActive: true,
          code: { in: ["wide_body_placement_priority", "narrow_body_placement_priority"] },
          profile: { isDefault: true, isActive: true }
        },
        select: { code: true, value: true }
      })
    ]);
    const bodyTypeScoreByCode = new Map(bodyTypeScoreRules.map((rule) => [rule.code, rule.value]));
    const wideBodyPlacementScore = bodyTypeScoreByCode.get("wide_body_placement_priority") ?? BODY_TYPE_SCORE_FALLBACK.WIDE_BODY;

    const eventTypeById = new Map(eventTypes.map((eventType) => [eventType.id, eventType]));
    const aircraftTypeById = new Map(aircraftTypes.map((aircraftType) => [aircraftType.id, aircraftType]));
    for (const item of body.items) {
      if (!eventTypeById.has(item.eventTypeId)) throw app.httpErrors.badRequest(`Не найден тип события: ${item.eventTypeId}`);
      if (!aircraftTypeById.has(item.aircraftTypeId)) throw app.httpErrors.badRequest(`Не найден тип ВС: ${item.aircraftTypeId}`);
    }

    const hangarOrder = hangarsOrdered.map((h) => h.id);
    const hangarIdSet = new Set(hangarOrder);
    const allStands: StandEntry[] = [];
    for (const lay of layoutsWithStands) {
      if (!hangarIdSet.has(lay.hangarId)) continue;
      for (const stand of lay.stands) allStands.push({ hangarId: lay.hangarId, layoutId: lay.id, standId: stand.id });
    }

    const busyByStand = new Map<string, Array<{ start: number; end: number }>>();
    const layoutLocksByHangar = new Map<string, Array<{ layoutId: string; start: number; end: number }>>();
    for (const reservation of reservations) {
      const arr = busyByStand.get(reservation.standId) ?? [];
      const towStarts = body.towBlocksStand ? reservation.event.towSegments.map((t) => t.startAt.getTime()) : [];
      const towEnds = body.towBlocksStand ? reservation.event.towSegments.map((t) => t.endAt.getTime()) : [];
      const start = Math.min(reservation.startAt.getTime(), ...towStarts);
      const end = Math.max(reservation.endAt.getTime(), ...towEnds);
      arr.push({ start, end });
      busyByStand.set(reservation.standId, arr);
      const locks = layoutLocksByHangar.get(reservation.layout.hangarId) ?? [];
      locks.push({ layoutId: reservation.layoutId, start, end });
      layoutLocksByHangar.set(reservation.layout.hangarId, locks);
    }
    for (const arr of busyByStand.values()) arr.sort((a, b) => a.start - b.start);
    for (const arr of layoutLocksByHangar.values()) arr.sort((a, b) => a.start - b.start);

    const standMeta = new Map<string, { aircraftTypeIds: string[] }>();
    for (const layout of layoutsWithStands) {
      for (const stand of layout.stands) {
        standMeta.set(stand.id, { aircraftTypeIds: stand.allowedAircraftTypes.map((link) => link.aircraftTypeId) });
      }
    }
    const hangarNameById = new Map(hangarsOrdered.map((hangar) => [hangar.id, hangar.name]));
    const layoutNameById = new Map(layoutsWithStands.map((layout) => [layout.id, layout.name]));
    const standCodeById = new Map<string, string>();
    for (const layout of layoutsWithStands) {
      for (const stand of layout.stands) standCodeById.set(stand.id, stand.code);
    }
    const busyCtx: StandBusyContext = { busyByStand, layoutLocksByHangar, blockBefore, blockAfter };
    const reservationSnapshots: MassReservationSnapshot[] = reservations.map((reservation) => {
      const towStarts = body.towBlocksStand ? reservation.event.towSegments.map((segment) => segment.startAt.getTime()) : [];
      const towEnds = body.towBlocksStand ? reservation.event.towSegments.map((segment) => segment.endAt.getTime()) : [];
      const startMs = Math.min(reservation.startAt.getTime(), ...(towStarts.length ? towStarts : [reservation.startAt.getTime()]));
      const endMs = Math.max(reservation.endAt.getTime(), ...(towEnds.length ? towEnds : [reservation.endAt.getTime()]));
      return {
        id: reservation.id,
        eventId: reservation.eventId,
        standId: reservation.standId,
        layoutId: reservation.layoutId,
        startMs,
        endMs,
        standCode: reservation.stand.code,
        hangarId: reservation.layout.hangarId,
        layoutName: reservation.layout.name,
        eventTitle: reservation.event.title,
        aircraftLabel: massEventAircraftLabel(reservation.event),
        aircraftTypeId: massEventAircraftTypeId(reservation.event)
      };
    });
    const layoutSwitchSuggestions = buildLayoutSwitchSuggestions({
      reservations: reservationSnapshots,
      layoutsWithStands,
      hangarNameById,
      busyByStand,
      layoutLocksByHangar
    });

    const priorityFor = (entry: StandEntry, eventTypeId: string, aircraftTypeId: string) => {
      const matched = priorityRules.filter((rule) => {
        if (rule.standId !== entry.standId) return false;
        const eventOk = rule.eventTypes.length === 0 || rule.eventTypes.some((link) => link.eventTypeId === eventTypeId);
        const aircraftOk = rule.aircraftTypes.length === 0 || rule.aircraftTypes.some((link) => link.aircraftTypeId === aircraftTypeId);
        return eventOk && aircraftOk;
      });
      return {
        score: matched.reduce((sum, rule) => sum + rule.priorityScore, 0),
        ruleIds: matched.map((rule) => rule.id)
      };
    };

    const wideAircraftTypeIds = new Set(allWideAircraftTypes.map((aircraftType) => aircraftType.id));

    const jobs: BatchPlanningJob[] = [];
    let flatIndex = 0;

    for (const [itemIndex, item] of body.items.entries()) {
      const eventType = eventTypeById.get(item.eventTypeId)!;
      const aircraftType = aircraftTypeById.get(item.aircraftTypeId)!;
      const tatMs = item.tatHours * 60 * 60 * 1000;
      const spacingMs = item.spacingHours * 60 * 60 * 1000;
      const cadenceMs = item.cadenceHours ? item.cadenceHours * 60 * 60 * 1000 : null;
      const titleBase = item.titleTemplate ?? eventType.name;
      const compatibleEntries = allStands
        .filter((entry) => {
          const allowed = standMeta.get(entry.standId)?.aircraftTypeIds ?? [];
          return allowed.length === 0 || allowed.includes(item.aircraftTypeId);
        })
        .map((entry) => {
          const priority = priorityFor(entry, item.eventTypeId, item.aircraftTypeId);
          const bodyScore = bodyTypeScore(aircraftType.bodyType, bodyTypeScoreByCode);
          const allowed = standMeta.get(entry.standId)?.aircraftTypeIds ?? [];
          const reserveWidePenalty = wideBodyReservePenalty(aircraftType.bodyType, allowed, wideAircraftTypeIds, wideBodyPlacementScore);
          const priorityScore = priority.score + bodyScore.score + reserveWidePenalty;
          return {
            ...entry,
            priorityScore,
            priorityRuleIds: priority.ruleIds,
            scoreDetails: [
              ...(priority.score > 0 ? [`Приоритет размещения: +${priority.score}`] : []),
              ...(bodyScore.score > 0 && bodyScore.label ? [`${bodyScore.label}: +${bodyScore.score}`] : []),
              ...(reserveWidePenalty !== 0 ? [`Резерв wide-body места: ${reserveWidePenalty}`] : [])
            ]
          };
        })
        .sort((a, b) => {
          const ai = hangarOrder.indexOf(a.hangarId);
          const bi = hangarOrder.indexOf(b.hangarId);
          if (ai !== bi) return ai - bi;
          return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
        });
      const maxPriorityScore = compatibleEntries.reduce((maxScore, entry) => Math.max(maxScore, entry.priorityScore ?? 0), Number.NEGATIVE_INFINITY);

      for (let i = 0; i < item.count; i++) {
        const nominalStartAt =
          item.scheduleMode === "fixedCadence"
            ? item.startFrom.getTime() + i * (cadenceMs ?? tatMs + spacingMs)
            : item.scheduleMode === "sequential"
              ? item.startFrom.getTime() + i * (tatMs + spacingMs)
              : item.startFrom.getTime();
        jobs.push({
          flatIndex,
          rowIndex: itemIndex,
          itemIndex: i,
          operatorId: item.operatorId,
          aircraftTypeId: item.aircraftTypeId,
          eventTypeId: item.eventTypeId,
          title: titleBase.includes("%") ? titleBase.replace("%", String(i + 1)) : `${titleBase} #${i + 1}`,
          label: `— Стр. ${itemIndex + 1}.${i + 1}`,
          startFromMs: item.startFrom.getTime(),
          endToMs: item.endTo.getTime(),
          tatMs,
          spacingMs,
          cadenceMs,
          scheduleMode: item.scheduleMode,
          nominalStartAt,
          bodyType: aircraftType.bodyType,
          compatibleEntries,
          candidateCount: compatibleEntries.length,
          maxPriorityScore: Number.isFinite(maxPriorityScore) ? maxPriorityScore : 0,
          windowSlackMs: item.endTo.getTime() - nominalStartAt
        });
        flatIndex += 1;
      }
    }

    const assembleDiagnostics = (params: {
      solverMode: BatchSolverMode;
      solverEngine: "heuristic" | "ortools";
      solverStatus: string | null;
      fallbackReason: string | null;
      optimizedJobIds: Set<number>;
      assignmentCount: number;
      layoutPairChecks: number;
      heuristicOnlyJobs: number;
      placements: BatchPlacementPreview[];
      unplaced: BatchUnplacedPreview[];
      candidateMetaByJob: Map<number, ReturnType<typeof selectOrToolsCandidateEntries>>;
      orToolsSelection?: Map<string, boolean>;
    }): SolverDiagnosticsPayload => {
      const placementByJob = new Map(params.placements.map((placement) => [placement.index, placement]));
      const unplacedByJob = new Map(params.unplaced.map((item) => [item.index, item]));
      const jobRows: SolverJobDiagnosticRow[] = [];
      const standRows: SolverStandDiagnosticRow[] = [];

      for (const job of jobs) {
        const meta =
          params.candidateMetaByJob.get(job.flatIndex) ??
          selectOrToolsCandidateEntries(job, busyCtx, OR_TOOLS_SCHEDULING_MAX_STANDS_PER_JOB);
        const placement = placementByJob.get(job.flatIndex);
        const unplacedItem = unplacedByJob.get(job.flatIndex);
        const aircraftType = aircraftTypeById.get(job.aircraftTypeId)?.name ?? job.aircraftTypeId;
        const eventType = eventTypeById.get(job.eventTypeId)?.name ?? job.eventTypeId;
        const sentToOrTools = params.solverEngine === "ortools" && params.optimizedJobIds.has(job.flatIndex);
        const feasibleCount = meta.ranked.filter((row) => row.slotInWindow).length;
        const freeEntryIds = new Set(meta.ranked.filter((row) => row.slotInWindow).map((row) => row.entry.standId));
        const scoreSummary = bestScoreSummary(job.compatibleEntries, freeEntryIds);
        const freeCandidates = meta.ranked
          .filter((row) => row.slotInWindow)
          .sort(
            (a, b) =>
              (b.entry.priorityScore ?? 0) - (a.entry.priorityScore ?? 0) ||
              (a.firstFreeAt ?? Number.MAX_SAFE_INTEGER) - (b.firstFreeAt ?? Number.MAX_SAFE_INTEGER)
          );
        const selectedCandidate =
          placement == null
            ? null
            : freeCandidates.find((row) => row.entry.standId === placement.standId && row.entry.layoutId === placement.layoutId) ?? null;
        const selectedCandidateRank =
          selectedCandidate == null ? null : freeCandidates.findIndex((row) => row.entry.standId === selectedCandidate.entry.standId) + 1;
        const betterFreeCandidates =
          selectedCandidate == null ? 0 : freeCandidates.filter((row) => (row.entry.priorityScore ?? 0) > (selectedCandidate.entry.priorityScore ?? 0)).length;
        const topAlternatives = freeCandidates
          .filter((row) => placement == null || row.entry.standId !== placement.standId || row.entry.layoutId !== placement.layoutId)
          .slice(0, 3)
          .map((row) => {
            const firstFreeAt = row.firstFreeAt == null ? "—" : new Date(row.firstFreeAt).toISOString();
            return `${hangarNameById.get(row.entry.hangarId) ?? row.entry.hangarId}/${layoutNameById.get(row.entry.layoutId) ?? row.entry.layoutId}/${standCodeById.get(row.entry.standId) ?? row.entry.standId}: score ${row.entry.priorityScore ?? 0}, старт ${firstFreeAt}`;
          })
          .join("; ");
        const decisionReason = placement
          ? selectedCandidateRank === 1
            ? `Выбран лучший свободный кандидат по score (${placement.score ?? "—"}), при равенстве учитывался более ранний старт`
            : `Выбран кандидат ранга ${selectedCandidateRank ?? "?"} из ${freeCandidates.length}; ${betterFreeCandidates} свободных кандидатов имеют более высокий score, но итоговое решение учитывает глобальные ограничения solver`
          : freeCandidates.length > 0
            ? `Не размещено, хотя есть ${freeCandidates.length} свободных кандидатов; решение solver оставило событие черновиком`
            : "Не размещено: нет свободного кандидата в выбранном окне с учётом схем и занятости";
        jobRows.push({
          flatIndex: job.flatIndex,
          label: job.label,
          title: job.title,
          aircraftType,
          eventType,
          scheduleMode: job.scheduleMode,
          periodFrom: new Date(job.startFromMs).toISOString(),
          periodTo: new Date(job.endToMs).toISOString(),
          tatHours: job.tatMs / (60 * 60 * 1000),
          intendedStartAt: new Date(batchJobIntendedStartMs(job)).toISOString(),
          compatibleStandsTotal: job.compatibleEntries.length,
          feasibleStandsTotal: feasibleCount,
          orToolsCandidates: meta.entries.length,
          sentToOrTools,
          placed: Boolean(placement),
          placementHangar: placement ? hangarNameById.get(placement.hangarId) ?? placement.hangarId : null,
          placementStand: placement ? standCodeById.get(placement.standId) ?? placement.standId : null,
          placementScore: placement?.score ?? null,
          bestCandidateScore: scoreSummary.bestCandidateScore ?? null,
          bestFreeCandidateScore: scoreSummary.bestFreeCandidateScore ?? null,
          selectedCandidateRank,
          betterFreeCandidates,
          decisionReason,
          topAlternatives,
          solverOutcome: placement ? "размещено" : sentToOrTools ? "OR-Tools не выбрал" : "эвристика / вне OR-Tools",
          unplacedReason: unplacedItem?.warnings?.join("; ") ?? null
        });

        for (const row of meta.ranked) {
          const selectionKey = `${job.flatIndex}:${row.entry.standId}`;
          standRows.push({
            flatIndex: job.flatIndex,
            label: job.label,
            hangarId: row.entry.hangarId,
            hangarName: hangarNameById.get(row.entry.hangarId) ?? row.entry.hangarId,
            layoutId: row.entry.layoutId,
            layoutName: layoutNameById.get(row.entry.layoutId) ?? row.entry.layoutId,
            standId: row.entry.standId,
            standCode: standCodeById.get(row.entry.standId) ?? row.entry.standId,
            priorityScore: row.entry.priorityScore ?? 0,
            slotInWindow: row.slotInWindow,
            firstFreeAt: row.firstFreeAt == null ? null : new Date(row.firstFreeAt).toISOString(),
            inOrToolsModel: row.inModel && sentToOrTools,
            excludedReason: row.excludedReason,
            orToolsSelected:
              params.orToolsSelection && sentToOrTools && row.inModel ? params.orToolsSelection.get(selectionKey) ?? false : null,
            layoutLockBlocks: row.layoutLockBlocks,
            standBusyBlocksInWindow: row.standBusyInWindow
          });
        }
      }

      return {
        solverMode: params.solverMode,
        solverEngine: params.solverEngine,
        solverStatus: params.solverStatus,
        fallbackReason: params.fallbackReason,
        optimizedJobs: params.optimizedJobIds.size,
        heuristicOnlyJobs: params.heuristicOnlyJobs,
        assignmentCount: params.assignmentCount,
        layoutPairChecks: params.layoutPairChecks,
        jobs: jobRows,
        standCandidates: standRows,
        layoutSwitchSuggestions,
        alternativeScenarios: buildAlternativeScenarios({
          jobs,
          placements: params.placements,
          reservations: reservationSnapshots,
          layoutsWithStands,
          hangarNameById,
          busyByStand,
          blockBefore,
          blockAfter
        })
      };
    };

    const runHeuristicSolver = (): BatchSolverResult => {
      const placements: BatchPlacementPreview[] = [];
      const unplaced: BatchUnplacedPreview[] = [];
      const localBusyWork = new Map<string, Array<{ start: number; end: number }>>();
      for (const [standId, busy] of busyByStand.entries()) localBusyWork.set(standId, [...busy]);
      const localLayoutLocksWork = new Map<string, Array<{ layoutId: string; start: number; end: number }>>();
      for (const [hangarId, locks] of layoutLocksByHangar.entries()) localLayoutLocksWork.set(hangarId, [...locks]);
      const nextStartByItem = new Map<number, number>();
      for (const [itemIndex, item] of body.items.entries()) nextStartByItem.set(itemIndex, item.startFrom.getTime());

      const addLocalBusy = (standId: string, start: number, end: number) => {
        const arr = localBusyWork.get(standId) ?? [];
        arr.push({ start: body.towBlocksStand ? start - towBeforeMs : start, end: body.towBlocksStand ? end + towAfterMs : end });
        arr.sort((a, b) => a.start - b.start);
        localBusyWork.set(standId, arr);
      };
      const addLocalLayoutLock = (entry: StandEntry, start: number, end: number) => {
        const arr = localLayoutLocksWork.get(entry.hangarId) ?? [];
        arr.push({ layoutId: entry.layoutId, start: body.towBlocksStand ? start - towBeforeMs : start, end: body.towBlocksStand ? end + towAfterMs : end });
        arr.sort((a, b) => a.start - b.start);
        localLayoutLocksWork.set(entry.hangarId, arr);
      };

      const candidateMetaByJob = new Map<number, ReturnType<typeof selectOrToolsCandidateEntries>>();

      for (const job of [...jobs].sort((a, b) => a.flatIndex - b.flatIndex)) {
        const decisionCtx = { busyByStand: localBusyWork, layoutLocksByHangar: localLayoutLocksWork, blockBefore, blockAfter };
        candidateMetaByJob.set(job.flatIndex, selectOrToolsCandidateEntries(job, decisionCtx, OR_TOOLS_SCHEDULING_MAX_STANDS_PER_JOB));
        const intendedStart = batchJobIntendedStartMs(job, nextStartByItem);
        const picked = pickBestPlacementCandidate(job.compatibleEntries, (entry) => {
          const standBusy = localBusyWork.get(entry.standId) ?? [];
          const incompatibleLayoutLocks = (localLayoutLocksWork.get(entry.hangarId) ?? []).filter((lock) => lock.layoutId !== entry.layoutId);
          const busy = [...standBusy, ...incompatibleLayoutLocks].sort((a, b) => a.start - b.start);
          const slot =
            body.placementMode === "draftOnConflict"
              ? isEventStartFree(busy, intendedStart, job.tatMs, blockBefore, blockAfter)
                ? intendedStart
                : null
              : findFirstEventStart(busy, intendedStart, job.tatMs, job.endToMs, blockBefore, blockAfter);
          if (slot == null || slot > job.endToMs) return null;
          return slot;
        });

        if (picked == null) {
          const scoreSummary = unplacedScoreSummary(job, { busyByStand: localBusyWork, layoutLocksByHangar: localLayoutLocksWork, blockBefore, blockAfter });
        const draftStartAt = batchJobDraftStartMs(job, intendedStart);
        const warnings = [
          body.placementMode === "draftOnConflict"
            ? "Целевой слот занят, событие будет создано черновиком"
            : "Не найден свободный слот в выбранном периоде"
        ];
        if (draftStartAt !== intendedStart) warnings.push("Время черновика назначено внутри выбранного периода");
          unplaced.push({
            index: job.flatIndex,
            rowIndex: job.rowIndex,
            itemIndex: job.itemIndex,
            operatorId: job.operatorId,
            aircraftTypeId: job.aircraftTypeId,
            eventTypeId: job.eventTypeId,
            title: job.title,
            label: job.label,
          intendedStartAt: draftStartAt,
          warnings,
            ...scoreSummary
          });
          if (job.scheduleMode === "sequential") nextStartByItem.set(job.rowIndex, intendedStart + job.tatMs + job.spacingMs);
          continue;
        }

        const bestEntry = picked.entry;
        const bestStart = picked.slot;
        const endAt = bestStart + job.tatMs;
        placements.push(buildBatchPlacement(job, bestEntry, bestStart, towBeforeMs, towAfterMs));
        addLocalBusy(bestEntry.standId, bestStart, endAt);
        addLocalLayoutLock(bestEntry, bestStart, endAt);
        if (job.scheduleMode === "sequential") nextStartByItem.set(job.rowIndex, endAt + job.spacingMs);
      }

      placements.sort((a, b) => a.index - b.index);
      unplaced.sort((a, b) => a.index - b.index);
      return {
        placements,
        unplaced,
        solver: "heuristic",
        diagnostics: assembleDiagnostics({
          solverMode: body.solverMode,
          solverEngine: "heuristic",
          solverStatus: null,
          fallbackReason: null,
          optimizedJobIds: new Set(),
          assignmentCount: 0,
          layoutPairChecks: 0,
          heuristicOnlyJobs: jobs.length,
          placements,
          unplaced,
          candidateMetaByJob
        })
      };
    };

    const runOrToolsSolver = async (solverMode: BatchSolverMode): Promise<BatchSolverResult | null> => {
      if (body.placementMode === "draftOnConflict") throw new Error("OR-Tools пропущен: режим draftOnConflict требует фиксированного целевого старта");
      const { CpModel, CpSolver, CpSat, LinearExpr } = (await import("or-tools-wasm/cp-sat")) as any;
      CpSat.setWorkerBridgeEnabled(false);

      const placements: BatchPlacementPreview[] = [];
      const unplaced: BatchUnplacedPreview[] = [];
      const useHeuristicFallback = solverMode === "hybrid";
      const heuristicSeed = runHeuristicSolver();
      const heuristicPlacementByJob = new Map(heuristicSeed.placements.map((placement) => [placement.index, placement]));
      const sortedJobs = [...jobs].sort(compareBatchPlanningJobs);
      const optimizedJobIds = new Set(
        sortedJobs
          .filter(shouldOptimizeWithOrTools)
          .slice(0, OR_TOOLS_MAX_OPTIMIZED_JOBS)
          .map((job) => job.flatIndex)
      );
      const optimizedJobs = solverMode === "ortools" ? sortedJobs : sortedJobs.filter((job) => optimizedJobIds.has(job.flatIndex));
      const heuristicOnlyJobs = solverMode === "ortools" ? [] : sortedJobs.filter((job) => !optimizedJobIds.has(job.flatIndex));
      if (optimizedJobs.length === 0) throw new Error("OR-Tools пропущен: нет дефицитных или широкофюзеляжных событий для оптимизации");
      const optimizedModelJobIds = new Set(optimizedJobs.map((job) => job.flatIndex));
      const dynamicMaxSlotsPerStand =
        optimizedJobs.length > 100 ? OR_TOOLS_SCHEDULING_LARGE_BATCH_MAX_SLOTS_PER_STAND : OR_TOOLS_SCHEDULING_MAX_SLOTS_PER_STAND;
      const dynamicMaxStandsPerJob = Math.max(
        optimizedJobs.length > 100 ? 1 : OR_TOOLS_SCHEDULING_MIN_STANDS_PER_JOB,
        Math.min(
          OR_TOOLS_SCHEDULING_MAX_STANDS_PER_JOB,
          optimizedJobs.length > 100 ? OR_TOOLS_SCHEDULING_LARGE_BATCH_MAX_STANDS_PER_JOB : OR_TOOLS_SCHEDULING_MAX_STANDS_PER_JOB,
          Math.floor(OR_TOOLS_SCHEDULING_MAX_ASSIGNMENTS / Math.max(1, optimizedJobs.length * dynamicMaxSlotsPerStand))
        )
      );

      const localBusyWork = new Map<string, Array<{ start: number; end: number }>>();
      for (const [standId, busy] of busyByStand.entries()) localBusyWork.set(standId, [...busy]);
      const localLayoutLocksWork = new Map<string, Array<{ layoutId: string; start: number; end: number }>>();
      for (const [hangarId, locks] of layoutLocksByHangar.entries()) localLayoutLocksWork.set(hangarId, [...locks]);

      const addLocalBusy = (standId: string, start: number, end: number) => {
        const arr = localBusyWork.get(standId) ?? [];
        arr.push({ start: body.towBlocksStand ? start - towBeforeMs : start, end: body.towBlocksStand ? end + towAfterMs : end });
        arr.sort((a, b) => a.start - b.start);
        localBusyWork.set(standId, arr);
      };
      const addLocalLayoutLock = (entry: StandEntry, start: number, end: number) => {
        const arr = localLayoutLocksWork.get(entry.hangarId) ?? [];
        arr.push({ layoutId: entry.layoutId, start: body.towBlocksStand ? start - towBeforeMs : start, end: body.towBlocksStand ? end + towAfterMs : end });
        arr.sort((a, b) => a.start - b.start);
        localLayoutLocksWork.set(entry.hangarId, arr);
      };
      const markUnplaced = (job: BatchPlanningJob, warning: string) => {
        const scoreSummary = unplacedScoreSummary(job, { busyByStand: localBusyWork, layoutLocksByHangar: localLayoutLocksWork, blockBefore, blockAfter });
        const intendedStartAt = batchJobIntendedStartMs(job);
        const draftStartAt = batchJobDraftStartMs(job, intendedStartAt);
        unplaced.push({
          index: job.flatIndex,
          rowIndex: job.rowIndex,
          itemIndex: job.itemIndex,
          operatorId: job.operatorId,
          aircraftTypeId: job.aircraftTypeId,
          eventTypeId: job.eventTypeId,
          title: job.title,
          label: job.label,
          intendedStartAt: draftStartAt,
          warnings: draftStartAt === intendedStartAt ? [warning] : [warning, "Время черновика назначено внутри выбранного периода"],
          ...scoreSummary
        });
      };
      const placeHeuristically = (job: BatchPlanningJob) => {
        const intendedStart = batchJobIntendedStartMs(job);
        const decisionCtx = { busyByStand: localBusyWork, layoutLocksByHangar: localLayoutLocksWork, blockBefore, blockAfter };
        candidateMetaByJob.set(job.flatIndex, selectOrToolsCandidateEntries(job, decisionCtx, OR_TOOLS_SCHEDULING_MAX_STANDS_PER_JOB));
        const picked = pickBestPlacementCandidate(job.compatibleEntries, (entry) => {
          const standBusy = localBusyWork.get(entry.standId) ?? [];
          const incompatibleLayoutLocks = (localLayoutLocksWork.get(entry.hangarId) ?? []).filter((lock) => lock.layoutId !== entry.layoutId);
          const busy = [...standBusy, ...incompatibleLayoutLocks].sort((a, b) => a.start - b.start);
          const slot = findFirstEventStart(busy, intendedStart, job.tatMs, job.endToMs, blockBefore, blockAfter);
          if (slot == null || slot > job.endToMs) return null;
          return slot;
        });
        if (picked != null) {
          const endAt = picked.slot + job.tatMs;
          placements.push(buildBatchPlacement(job, picked.entry, picked.slot, towBeforeMs, towAfterMs));
          addLocalBusy(picked.entry.standId, picked.slot, endAt);
          addLocalLayoutLock(picked.entry, picked.slot, endAt);
          return;
        }
        markUnplaced(job, "Не найден свободный слот в выбранном периоде");
      };

      type SchedulingAssignment = {
        job: BatchPlanningJob;
        entry: StandEntry;
        presence: any;
        interval: any;
        jobVars: {
          placed: any;
        };
        startH: number;
        score: number;
      };
      type SchedulingJob = {
        job: BatchPlanningJob;
        placed: any;
      };

      const hourMs = 60 * 60 * 1000;
      const originMs = minStart.getTime() - (body.towBlocksStand ? towBeforeMs : 0);
      const toHourFloor = (value: number) => Math.floor((value - originMs) / hourMs);
      const toHourCeil = (value: number) => Math.ceil((value - originMs) / hourMs);
      const fromHour = (value: number) => originMs + value * hourMs;
      const towBeforeH = body.towBlocksStand ? Math.ceil(towBeforeMs / hourMs) : 0;
      const towAfterH = body.towBlocksStand ? Math.ceil(towAfterMs / hourMs) : 0;
      const candidateStartHours = (job: BatchPlanningJob, entry: StandEntry, startMinH: number, startMaxH: number, durationH: number): number[] => {
        const busy = standBusyIntervals(entry, busyCtx);
        const starts: number[] = [];
        const heuristicPlacement = heuristicPlacementByJob.get(job.flatIndex);
        if (heuristicPlacement?.standId === entry.standId) {
          const heuristicStartH = toHourCeil(heuristicPlacement.startAt);
          if (heuristicStartH >= startMinH && heuristicStartH <= startMaxH) starts.push(heuristicStartH);
        }
        let cursorMs = fromHour(startMinH);
        while (starts.length < dynamicMaxSlotsPerStand) {
          const slotMs = findFirstEventStart(busy, cursorMs, job.tatMs, job.endToMs, blockBefore, blockAfter);
          if (slotMs == null || slotMs > job.endToMs) break;
          const slotH = Math.max(startMinH, toHourCeil(slotMs));
          if (slotH > startMaxH) break;
          if (!starts.includes(slotH)) starts.push(slotH);
          cursorMs = fromHour(slotH + durationH) + job.spacingMs;
        }
        return starts;
      };

      const model = new CpModel();
      const assignments: SchedulingAssignment[] = [];
      const scheduledJobs: SchedulingJob[] = [];
      const standIntervals = new Map<string, any[]>();
      const standExistingIntervals = new Map<string, any[]>();
      const layoutIntervals = new Map<string, Map<string, any[]>>();
      const layoutExistingIntervals = new Map<string, Map<string, any[]>>();

      const addStandInterval = (target: Map<string, any[]>, standId: string, interval: any) => {
        const arr = target.get(standId) ?? [];
        arr.push(interval);
        target.set(standId, arr);
      };
      const addLayoutInterval = (target: Map<string, Map<string, any[]>>, hangarId: string, layoutId: string, interval: any) => {
        const byLayout = target.get(hangarId) ?? new Map<string, any[]>();
        const arr = byLayout.get(layoutId) ?? [];
        arr.push(interval);
        byLayout.set(layoutId, arr);
        target.set(hangarId, byLayout);
      };
      const estimateLayoutPairChecks = () => {
        let checks = 0;
        const hangarIds = new Set([...layoutIntervals.keys(), ...layoutExistingIntervals.keys()]);
        for (const hangarId of hangarIds) {
          const newByLayout = layoutIntervals.get(hangarId) ?? new Map<string, any[]>();
          const existingByLayout = layoutExistingIntervals.get(hangarId) ?? new Map<string, any[]>();
          const layoutIds = Array.from(new Set([...newByLayout.keys(), ...existingByLayout.keys()]));
          for (let i = 0; i < layoutIds.length; i++) {
            for (let j = i + 1; j < layoutIds.length; j++) {
              const a = layoutIds[i]!;
              const b = layoutIds[j]!;
              checks += (newByLayout.get(a)?.length ?? 0) * (newByLayout.get(b)?.length ?? 0);
              checks += (newByLayout.get(a)?.length ?? 0) * (existingByLayout.get(b)?.length ?? 0);
              checks += (newByLayout.get(b)?.length ?? 0) * (existingByLayout.get(a)?.length ?? 0);
              if (checks > OR_TOOLS_SCHEDULING_MAX_LAYOUT_PAIR_CHECKS) return checks;
            }
          }
        }
        return checks;
      };

      for (const [standId, busy] of busyByStand.entries()) {
        for (const [idx, block] of busy.entries()) {
          const blockStartH = toHourFloor(block.start);
          const blockEndH = toHourCeil(block.end);
          const sizeH = Math.max(1, blockEndH - blockStartH);
          addStandInterval(standExistingIntervals, standId, model.newFixedSizeIntervalVar(blockStartH, sizeH, `busy_${standId}_${idx}`));
        }
      }
      for (const [hangarId, locks] of layoutLocksByHangar.entries()) {
        for (const [idx, lock] of locks.entries()) {
          const blockStartH = toHourFloor(lock.start);
          const blockEndH = toHourCeil(lock.end);
          const sizeH = Math.max(1, blockEndH - blockStartH);
          addLayoutInterval(layoutExistingIntervals, hangarId, lock.layoutId, model.newFixedSizeIntervalVar(blockStartH, sizeH, `layout_busy_${hangarId}_${idx}`));
        }
      }

      const candidateMetaByJob = new Map<number, ReturnType<typeof selectOrToolsCandidateEntries>>();
      for (const job of jobs) {
        const maxEntries = optimizedModelJobIds.has(job.flatIndex)
          ? dynamicMaxStandsPerJob
          : OR_TOOLS_SCHEDULING_MAX_STANDS_PER_JOB;
        candidateMetaByJob.set(job.flatIndex, selectOrToolsCandidateEntries(job, busyCtx, maxEntries));
      }

      for (const job of optimizedJobs) {
        const durationH = Math.max(1, Math.ceil(job.tatMs / hourMs));
        const startMinH = Math.max(toHourCeil(job.startFromMs), toHourCeil(job.nominalStartAt));
        const startMaxH = toHourFloor(job.endToMs);
        if (startMaxH < startMinH) {
          markUnplaced(job, "Начало периода позже крайнего допустимого старта");
          continue;
        }
        const jobAssignments: SchedulingAssignment[] = [];
        const nominalStartH = toHourCeil(job.nominalStartAt);
        const placed = model.newBoolVar(`placed_${job.flatIndex}`);
        const jobVars = { placed };
        const candidateEntries = [...(candidateMetaByJob.get(job.flatIndex)?.entries ?? [])];
        const heuristicPlacement = heuristicPlacementByJob.get(job.flatIndex);
        const heuristicEntry =
          heuristicPlacement != null && !candidateEntries.some((entry) => entry.standId === heuristicPlacement.standId)
            ? job.compatibleEntries.find((entry) => entry.standId === heuristicPlacement.standId)
            : undefined;
        if (heuristicEntry) candidateEntries.push(heuristicEntry);
        const entriesByLayout = new Map<string, { hangarId: string; layoutId: string; entries: StandEntry[] }>();
        for (const entry of candidateEntries) {
          const key = `${entry.hangarId}:${entry.layoutId}`;
          const group = entriesByLayout.get(key) ?? { hangarId: entry.hangarId, layoutId: entry.layoutId, entries: [] };
          group.entries.push(entry);
          entriesByLayout.set(key, group);
        }
        for (const layoutGroup of entriesByLayout.values()) {
          const layoutPresence = model.newBoolVar(`lp_${job.flatIndex}_${layoutGroup.layoutId}`);
          const layoutAssignments: SchedulingAssignment[] = [];
          for (const entry of layoutGroup.entries) {
            const startHours = candidateStartHours(job, entry, startMinH, startMaxH, durationH);
            for (const startH of startHours) {
              const endH = startH + durationH;
              const presence = model.newBoolVar(`p_${job.flatIndex}_${entry.standId}_${startH}`);
              const interval = model.newOptionalIntervalVar(
                startH - towBeforeH,
                durationH + towBeforeH + towAfterH,
                endH + towAfterH,
                presence,
                `i_${job.flatIndex}_${entry.standId}_${startH}`
              );
              const layoutInterval = model.newOptionalIntervalVar(
                startH - towBeforeH,
                durationH + towBeforeH + towAfterH,
                endH + towAfterH,
                presence,
                `li_${job.flatIndex}_${entry.standId}_${startH}`
              );
              model.add(presence.le(layoutPresence));
              model.add(presence.le(placed));
              const delayH = Math.max(0, startH - nominalStartH);
              const score =
                bodyTypeRank(job.bodyType) * 1_000_000 +
                (entry.priorityScore ?? 0) * 1_000 -
                delayH * 100 -
                job.flatIndex;
              const assignment = { job, entry, presence, interval, jobVars, startH, score };
              assignments.push(assignment);
              jobAssignments.push(assignment);
              layoutAssignments.push(assignment);
              addStandInterval(standIntervals, entry.standId, interval);
              addLayoutInterval(layoutIntervals, layoutGroup.hangarId, layoutGroup.layoutId, layoutInterval);
              if (assignments.length > OR_TOOLS_SCHEDULING_MAX_ASSIGNMENTS) {
                throw new Error(`OR-Tools scheduling-модель слишком большая: больше ${OR_TOOLS_SCHEDULING_MAX_ASSIGNMENTS} event-stand интервалов`);
              }
            }
          }
          const layoutPresenceSum = layoutAssignments.reduce((expr: any, assignment) => expr.plus(assignment.presence), LinearExpr.constant(0));
          model.add(layoutPresence.eq(layoutPresenceSum));
        }
        if (jobAssignments.length > 0) {
          model.addAtMostOne(jobAssignments.map((assignment) => assignment.presence));
          const jobPresenceSum = jobAssignments.reduce((expr: any, assignment) => expr.plus(assignment.presence), LinearExpr.constant(0));
          model.add(placed.eq(jobPresenceSum));
          scheduledJobs.push({ job, placed });
        } else {
          markUnplaced(job, "Нет совместимых мест для OR-Tools");
        }
      }

      const standIds = new Set([...standIntervals.keys(), ...standExistingIntervals.keys()]);
      for (const standId of standIds) {
        const newIntervals = standIntervals.get(standId) ?? [];
        const existingIntervals = standExistingIntervals.get(standId) ?? [];
        if (newIntervals.length > 1) model.addNoOverlap(newIntervals);
        for (const newInterval of newIntervals) {
          for (const existingInterval of existingIntervals) model.addNoOverlap([newInterval, existingInterval]);
        }
      }

      const layoutPairChecks = estimateLayoutPairChecks();
      if (layoutPairChecks > OR_TOOLS_SCHEDULING_MAX_LAYOUT_PAIR_CHECKS) {
        throw new Error(`OR-Tools scheduling-модель слишком большая: ${layoutPairChecks} layout-конфликтов`);
      }

      const hangarIds = new Set([...layoutIntervals.keys(), ...layoutExistingIntervals.keys()]);
      for (const hangarId of hangarIds) {
        const newByLayout = layoutIntervals.get(hangarId) ?? new Map<string, any[]>();
        const existingByLayout = layoutExistingIntervals.get(hangarId) ?? new Map<string, any[]>();
        const layoutIds = Array.from(new Set([...newByLayout.keys(), ...existingByLayout.keys()]));
        for (let i = 0; i < layoutIds.length; i++) {
          for (let j = i + 1; j < layoutIds.length; j++) {
            const a = layoutIds[i]!;
            const b = layoutIds[j]!;
            const newA = newByLayout.get(a) ?? [];
            const newB = newByLayout.get(b) ?? [];
            const existingA = existingByLayout.get(a) ?? [];
            const existingB = existingByLayout.get(b) ?? [];
            for (const intervalA of newA) {
              for (const intervalB of newB) model.addNoOverlap([intervalA, intervalB]);
              for (const fixedB of existingB) model.addNoOverlap([intervalA, fixedB]);
            }
            for (const intervalB of newB) {
              for (const fixedA of existingA) model.addNoOverlap([intervalB, fixedA]);
            }
          }
        }
      }

      if (assignments.length === 0) throw new Error("OR-Tools пропущен: нет допустимых event-stand интервалов");
      const placementObjective = assignments.reduce(
        (expr: any, assignment) => expr.plus(assignment.presence.times(OR_TOOLS_PLACED_OBJECTIVE_WEIGHT + assignment.score)),
        LinearExpr.constant(0)
      );
      model.maximize(placementObjective);

      const solverTimeLimitSeconds = solverMode === "ortools" ? OR_TOOLS_FULL_SOLVER_TIME_LIMIT_SECONDS : OR_TOOLS_SOLVER_TIME_LIMIT_SECONDS;
      const solver = new CpSolver();
      solver.parameters.maxTimeInSeconds = solverTimeLimitSeconds;
      solver.parameters.numSearchWorkers = 1;
      const status = await solver.solve(model);
      const statusName = solver.statusName(status);
      let solverHasValues = statusName === "OPTIMAL" || statusName === "FEASIBLE";
      if (!solverHasValues && statusName === "UNKNOWN") {
        try {
          solverHasValues = assignments.some((assignment) => solver.value(assignment.presence) === 1);
        } catch {
          solverHasValues = false;
        }
      }
      const placedCount = solverHasValues ? scheduledJobs.reduce((sum, scheduledJob) => sum + Number(solver.value(scheduledJob.placed)), 0) : 0;
      const orToolsSelection = new Map<string, boolean>();
      if (solverHasValues) {
        for (const assignment of assignments) {
          const key = `${assignment.job.flatIndex}:${assignment.entry.standId}`;
          orToolsSelection.set(key, (orToolsSelection.get(key) ?? false) || solver.value(assignment.presence) === 1);
        }
      }

      const extractPlacementsFromSolver = () => {
        const selectedByJob = new Map<number, SchedulingAssignment>();
        for (const assignment of assignments) {
          if (solver.value(assignment.presence) === 1) selectedByJob.set(assignment.job.flatIndex, assignment);
        }
        for (const job of optimizedJobs) {
          const selected = selectedByJob.get(job.flatIndex);
          if (!selected) {
            if (!unplaced.some((item) => item.index === job.flatIndex)) markUnplaced(job, "OR-Tools не выбрал размещение в допустимом периоде");
            continue;
          }
          const startAt = fromHour(selected.startH);
          const endAt = startAt + job.tatMs;
          placements.push(buildBatchPlacement(job, selected.entry, startAt, towBeforeMs, towAfterMs));
          addLocalBusy(selected.entry.standId, startAt, endAt);
          addLocalLayoutLock(selected.entry, startAt, endAt);
        }
      };

      const returnHeuristicFallback = (reason: string): BatchSolverResult => ({
        placements: heuristicSeed.placements,
        unplaced: heuristicSeed.unplaced,
        solver: "ortools",
        fallbackReason: reason,
        diagnostics: assembleDiagnostics({
          solverMode,
          solverEngine: "ortools",
          solverStatus: statusName,
          fallbackReason: reason,
          optimizedJobIds: new Set(optimizedJobs.map((job) => job.flatIndex)),
          assignmentCount: assignments.length,
          layoutPairChecks,
          heuristicOnlyJobs: heuristicOnlyJobs.length,
          placements: heuristicSeed.placements,
          unplaced: heuristicSeed.unplaced,
          candidateMetaByJob,
          orToolsSelection
        })
      });

      let solverFallbackReason: string | undefined;
      if (statusName === "OPTIMAL" || statusName === "FEASIBLE") {
        extractPlacementsFromSolver();
      } else if (statusName === "UNKNOWN") {
        if (solverHasValues) {
          extractPlacementsFromSolver();
          solverFallbackReason = `OR-Tools job-shop: частичное решение за ${solverTimeLimitSeconds}с (${statusName}), размещено ${placedCount}`;
        } else {
          if (!useHeuristicFallback) {
            for (const job of optimizedJobs) {
              if (!unplaced.some((item) => item.index === job.flatIndex)) markUnplaced(job, `OR-Tools не нашёл допустимое решение за ${solverTimeLimitSeconds}с (${statusName})`);
            }
            for (const job of heuristicOnlyJobs) markUnplaced(job, "Событие не передавалось в OR-Tools");
            placements.sort((a, b) => a.index - b.index);
            unplaced.sort((a, b) => a.index - b.index);
            const reason = `OR-Tools не нашёл допустимое решение за ${solverTimeLimitSeconds}с (${statusName}); эвристический результат не подставлялся`;
            return {
              placements,
              unplaced,
              solver: "ortools",
              fallbackReason: reason,
              diagnostics: assembleDiagnostics({
                solverMode,
                solverEngine: "ortools",
                solverStatus: statusName,
                fallbackReason: reason,
                optimizedJobIds: new Set(optimizedJobs.map((job) => job.flatIndex)),
                assignmentCount: assignments.length,
                layoutPairChecks,
                heuristicOnlyJobs: heuristicOnlyJobs.length,
                placements,
                unplaced,
                candidateMetaByJob,
                orToolsSelection
              })
            };
          }
          return returnHeuristicFallback(
            `OR-Tools не успел за ${solverTimeLimitSeconds}с (${statusName}); показан эвристический результат (${heuristicSeed.placements.length} размещено)`
          );
        }
      } else {
        throw new Error(`статус ${statusName}`);
      }

      for (const job of heuristicOnlyJobs) {
        if (useHeuristicFallback) placeHeuristically(job);
        else markUnplaced(job, "Событие не передавалось в OR-Tools");
      }

      placements.sort((a, b) => a.index - b.index);
      unplaced.sort((a, b) => a.index - b.index);
      const fallbackReason =
        solverFallbackReason ??
        (heuristicOnlyJobs.length > 0
          ? `OR-Tools рассчитал ${optimizedJobs.length} событий scheduling-моделью; ${heuristicOnlyJobs.length} типовых событий дозаполнены эвристикой`
          : undefined);
      return {
        placements,
        unplaced,
        solver: solverMode === "hybrid" && placements.length === 0 ? "heuristic" : "ortools",
        fallbackReason,
        diagnostics: assembleDiagnostics({
          solverMode,
          solverEngine: "ortools",
          solverStatus: statusName,
          fallbackReason: fallbackReason ?? null,
          optimizedJobIds: new Set(optimizedJobs.map((job) => job.flatIndex)),
          assignmentCount: assignments.length,
          layoutPairChecks,
          heuristicOnlyJobs: heuristicOnlyJobs.length,
          placements,
          unplaced,
          candidateMetaByJob,
          orToolsSelection
        })
      };
    };

    let solverResult: BatchSolverResult;
    if (body.solverMode === "heuristic") {
      solverResult = runHeuristicSolver();
    } else if (body.solverMode === "hybrid") {
      try {
        solverResult = (await runOrToolsSolver("hybrid")) ?? { ...runHeuristicSolver(), fallbackReason: "OR-Tools не вернул допустимое решение" };
      } catch (error) {
        solverResult = { ...runHeuristicSolver(), fallbackReason: error instanceof Error ? error.message : "OR-Tools недоступен" };
      }
    } else {
      try {
        solverResult = (await runOrToolsSolver("ortools")) ?? {
          placements: [],
          unplaced: jobs.map((job) => ({
            index: job.flatIndex,
            rowIndex: job.rowIndex,
            itemIndex: job.itemIndex,
            operatorId: job.operatorId,
            aircraftTypeId: job.aircraftTypeId,
            eventTypeId: job.eventTypeId,
            title: job.title,
            label: job.label,
            intendedStartAt: batchJobDraftStartMs(job),
            warnings: ["OR-Tools не вернул допустимое решение"]
          })),
          solver: "ortools",
          fallbackReason: "OR-Tools не вернул допустимое решение"
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "OR-Tools недоступен";
        const heuristic = runHeuristicSolver();
        solverResult = {
          ...heuristic,
          solver: "ortools",
          fallbackReason: `${reason}; показан эвристический результат (${heuristic.placements.length} размещено)`
        };
      }
    }

    const placementsPreview = solverResult.placements;
    const unplacedPreview = solverResult.unplaced;

    const serializePlacement = (p: typeof placementsPreview[number]) => ({
      ...p,
      startAt: new Date(p.startAt).toISOString(),
      endAt: new Date(p.endAt).toISOString(),
      budgetStartAt: body.budgetStartAt?.toISOString() ?? null,
      budgetEndAt: body.budgetEndAt?.toISOString() ?? null,
      actualStartAt: body.actualStartAt?.toISOString() ?? null,
      actualEndAt: body.actualEndAt?.toISOString() ?? null,
      towBeforeStartAt: p.towBeforeStartAt ? new Date(p.towBeforeStartAt).toISOString() : undefined,
      towBeforeEndAt: p.towBeforeEndAt ? new Date(p.towBeforeEndAt).toISOString() : undefined,
      towAfterStartAt: p.towAfterStartAt ? new Date(p.towAfterStartAt).toISOString() : undefined,
      towAfterEndAt: p.towAfterEndAt ? new Date(p.towAfterEndAt).toISOString() : undefined
    });

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        batch: true,
        placements: placementsPreview.map(serializePlacement),
        unplaced: unplacedPreview.map((u) => ({ ...u, intendedStartAt: new Date(u.intendedStartAt).toISOString() })),
        summary: {
          total: body.items.reduce((sum, item) => sum + item.count, 0),
          rows: body.items.length,
          placed: placementsPreview.length,
          unplaced: unplacedPreview.length,
          createdTowsBefore: placementsPreview.filter((p) => p.towBeforeStartAt != null).length,
          createdTowsAfter: placementsPreview.filter((p) => p.towAfterStartAt != null).length,
          solver: solverResult.solver,
          solverFallbackReason: solverResult.fallbackReason ?? null,
          draftOnConflict: body.placementMode === "draftOnConflict"
        },
        solverDiagnostics: solverResult.diagnostics ?? null
      };
    }

    const sbId = sandboxIdFor(req);
    const result = await app.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const created: Array<{
          eventId: string;
          label: string;
          title: string;
          startAt: Date;
          endAt: Date;
          hangarId: string | null;
          layoutId: string | null;
          standId: string | null;
          status: EventStatus;
        }> = [];
      const eventRows: Prisma.MaintenanceEventCreateManyInput[] = [];
      const placementRows: Prisma.EventPlacementCreateManyInput[] = [];
      const reservationRows: Prisma.StandReservationCreateManyInput[] = [];
      const towRows: Prisma.EventTowCreateManyInput[] = [];

      for (const p of placementsPreview) {
        const eventId = randomUUID();
        const placementId = randomUUID();
        const startAt = new Date(p.startAt);
        const endAt = new Date(p.endAt);
        eventRows.push({
          id: eventId,
          level: PlanningLevel.OPERATIONAL,
          status: EventStatus.PLANNED,
          planningKind: body.budgetStartAt && body.budgetEndAt ? "PLANNED" : "UNPLANNED",
          title: p.title,
          sandboxId: sbId,
          eventTypeId: p.eventTypeId,
          startAt,
          endAt,
          budgetStartAt: body.budgetStartAt ?? null,
          budgetEndAt: body.budgetEndAt ?? null,
          actualStartAt: body.actualStartAt ?? null,
          actualEndAt: body.actualEndAt ?? null,
          hangarId: p.hangarId,
          layoutId: p.layoutId,
          virtualAircraft: { operatorId: p.operatorId, aircraftTypeId: p.aircraftTypeId, label: p.label } as Prisma.InputJsonValue
        });
        placementRows.push({
          id: placementId,
          eventId,
          sandboxId: sbId,
          startAt,
          endAt,
          budgetStartAt: body.budgetStartAt ?? null,
          budgetEndAt: body.budgetEndAt ?? null,
          actualStartAt: body.actualStartAt ?? null,
          actualEndAt: body.actualEndAt ?? null,
          hangarId: p.hangarId,
          layoutId: p.layoutId,
          standId: p.standId,
          sortOrder: 0
        });
        reservationRows.push({
          eventId,
          placementId,
          sandboxId: sbId,
          layoutId: p.layoutId,
          standId: p.standId,
          startAt,
          endAt
        });
        if (p.towBeforeStartAt != null && p.towBeforeEndAt != null) {
          towRows.push({ eventId, sandboxId: sbId, startAt: new Date(p.towBeforeStartAt), endAt: new Date(p.towBeforeEndAt) });
        }
        if (p.towAfterStartAt != null && p.towAfterEndAt != null) {
          towRows.push({ eventId, sandboxId: sbId, startAt: new Date(p.towAfterStartAt), endAt: new Date(p.towAfterEndAt) });
        }
        created.push({ eventId, label: p.label, title: p.title, startAt, endAt, hangarId: p.hangarId, layoutId: p.layoutId, standId: p.standId, status: EventStatus.PLANNED });
      }

      for (const u of unplacedPreview) {
        const eventId = randomUUID();
        const item = body.items[u.rowIndex]!;
        const tatMs = item.tatHours * 60 * 60 * 1000;
        const startAt = new Date(u.intendedStartAt);
        const endAt = new Date(u.intendedStartAt + tatMs);
        eventRows.push({
          id: eventId,
          level: PlanningLevel.OPERATIONAL,
          status: EventStatus.DRAFT,
          planningKind: body.budgetStartAt && body.budgetEndAt ? "PLANNED" : "UNPLANNED",
          title: u.title,
          sandboxId: sbId,
          eventTypeId: u.eventTypeId,
          startAt,
          endAt,
          budgetStartAt: body.budgetStartAt ?? null,
          budgetEndAt: body.budgetEndAt ?? null,
          actualStartAt: body.actualStartAt ?? null,
          actualEndAt: body.actualEndAt ?? null,
          hangarId: null,
          layoutId: null,
          virtualAircraft: { operatorId: u.operatorId, aircraftTypeId: u.aircraftTypeId, label: u.label } as Prisma.InputJsonValue
        });
        created.push({ eventId, label: u.label, title: u.title, startAt, endAt, hangarId: null, layoutId: null, standId: null, status: EventStatus.DRAFT });
      }

      if (eventRows.length > 0) await tx.maintenanceEvent.createMany({ data: eventRows });
      if (placementRows.length > 0) await tx.eventPlacement.createMany({ data: placementRows });
      if (reservationRows.length > 0) await tx.standReservation.createMany({ data: reservationRows });
      if (towRows.length > 0) await tx.eventTow.createMany({ data: towRows });

        return created;
      },
      MASS_PLAN_TRANSACTION_OPTIONS
    );

    return {
      ok: true,
      dryRun: false,
      batch: true,
      created: result.length,
      placed: result.filter((r) => r.status === EventStatus.PLANNED).length,
      unplaced: result.filter((r) => r.status === EventStatus.DRAFT).length,
      solver: solverResult.solver,
      solverFallbackReason: solverResult.fallbackReason ?? null,
      events: result.map((r) => ({ ...r, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString() }))
    };
  });
};
