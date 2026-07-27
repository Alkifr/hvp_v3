import { EventStatus } from "@prisma/client";

import {
  AUTO_IN_PROGRESS_STATUSES,
  MANUAL_ONLY_STATUSES
} from "./eventStatusCatalog.js";

/** Truncate to minute precision (seconds/ms = 0). */
export function floorToMinute(d: Date): Date {
  const x = new Date(d.getTime());
  x.setUTCSeconds(0, 0);
  return x;
}

export type StatusReconcileInput = {
  status: EventStatus;
  startAt: Date;
  endAt: Date;
  actualStartAt: Date | null | undefined;
  actualEndAt: Date | null | undefined;
  now?: Date;
  /** User explicitly requested DONE (manual). */
  forceDone?: boolean;
};

export type StatusReconcileResult = {
  status: EventStatus;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  statusChanged: boolean;
  actualFilledFromOper: boolean;
};

const TERMINAL_MANUAL = new Set<EventStatus>([EventStatus.CANCELLED, EventStatus.DELETED]);

/**
 * Auto status rules:
 * - CANCELLED / DELETED — untouched
 * - PENDING_* — no auto IN_PROGRESS; fact / forceDone still → DONE
 * - APPROVED_BY_* + now >= startAt (minute) → IN_PROGRESS
 * - both actual dates → DONE
 * - forceDone / DONE with empty actual → fill actual from operational period
 * - DONE with actual cleared → recompute APPROVED_BY_EXECUTOR / IN_PROGRESS
 */
export function reconcileEventStatus(input: StatusReconcileInput): StatusReconcileResult {
  const now = floorToMinute(input.now ?? new Date());
  const startAt = floorToMinute(input.startAt);
  const endAt = input.endAt;

  let status = input.status;
  let actualStartAt = input.actualStartAt ?? null;
  let actualEndAt = input.actualEndAt ?? null;
  let actualFilledFromOper = false;

  if (TERMINAL_MANUAL.has(status)) {
    return {
      status,
      actualStartAt,
      actualEndAt,
      statusChanged: false,
      actualFilledFromOper: false
    };
  }

  // Manual DONE → ensure fact from operational if empty
  if ((input.forceDone || status === EventStatus.DONE) && (!actualStartAt || !actualEndAt)) {
    actualStartAt = input.startAt;
    actualEndAt = endAt;
    actualFilledFromOper = true;
    status = EventStatus.DONE;
  }

  const hasFact = Boolean(actualStartAt && actualEndAt);

  if (hasFact && status !== EventStatus.DONE) {
    status = EventStatus.DONE;
  } else if (!hasFact && status === EventStatus.DONE) {
    // Fact cleared while DONE → fall back by time
    status = now.valueOf() >= startAt.valueOf() ? EventStatus.IN_PROGRESS : EventStatus.APPROVED_BY_EXECUTOR;
  } else if (
    !hasFact &&
    AUTO_IN_PROGRESS_STATUSES.has(status) &&
    now.valueOf() >= startAt.valueOf()
  ) {
    status = EventStatus.IN_PROGRESS;
  }

  return {
    status,
    actualStartAt,
    actualEndAt,
    statusChanged: status !== input.status,
    actualFilledFromOper
  };
}

export function isEventOverdueNoFact(params: {
  status: EventStatus;
  endAt: Date;
  actualStartAt: Date | null | undefined;
  actualEndAt: Date | null | undefined;
  now?: Date;
}): boolean {
  // Pending approval / cancelled / deleted / done — no overdue nag
  if (MANUAL_ONLY_STATUSES.has(params.status) || params.status === EventStatus.DONE) return false;
  if (params.actualStartAt && params.actualEndAt) return false;
  const now = floorToMinute(params.now ?? new Date());
  return now.valueOf() > floorToMinute(params.endAt).valueOf();
}

/** Schedule/type/placement stay locked while DONE unless status is explicitly changed away. */
export function isDoneScheduleLocked(
  existingStatus: EventStatus,
  requestedStatus?: EventStatus | null
): boolean {
  if (existingStatus !== EventStatus.DONE) return false;
  if (requestedStatus != null && requestedStatus !== EventStatus.DONE) return false;
  return true;
}

export const DONE_SCHEDULE_LOCK_MESSAGE =
  "Нельзя менять расписание, тип и размещение у завершённого события. Сначала смените статус.";

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return floorToMinute(a).getTime() === floorToMinute(b).getTime();
}

export type DoneSchedulePatch = {
  planningKind?: string;
  eventTypeId?: string;
  startAt?: Date;
  endAt?: Date;
  budgetStartAt?: Date | null;
  budgetEndAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  hangarId?: string | null;
  layoutId?: string | null;
};

export type DoneScheduleExisting = {
  status: EventStatus;
  planningKind: string;
  eventTypeId: string;
  startAt: Date;
  endAt: Date;
  budgetStartAt: Date | null;
  budgetEndAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  hangarId: string | null;
  layoutId: string | null;
};

/** Returns true if patch tries to change DONE-locked schedule fields (event-level). */
export function patchTouchesDoneScheduleLock(
  existing: DoneScheduleExisting,
  patch: DoneSchedulePatch,
  requestedStatus?: EventStatus | null
): boolean {
  if (!isDoneScheduleLocked(existing.status, requestedStatus)) return false;

  if (patch.planningKind !== undefined && patch.planningKind !== existing.planningKind) return true;
  if (patch.eventTypeId !== undefined && patch.eventTypeId !== existing.eventTypeId) return true;
  if (patch.startAt !== undefined && !sameInstant(patch.startAt, existing.startAt)) return true;
  if (patch.endAt !== undefined && !sameInstant(patch.endAt, existing.endAt)) return true;
  if (patch.budgetStartAt !== undefined && !sameInstant(patch.budgetStartAt, existing.budgetStartAt)) return true;
  if (patch.budgetEndAt !== undefined && !sameInstant(patch.budgetEndAt, existing.budgetEndAt)) return true;
  if (patch.actualStartAt !== undefined && !sameInstant(patch.actualStartAt, existing.actualStartAt)) return true;
  if (patch.actualEndAt !== undefined && !sameInstant(patch.actualEndAt, existing.actualEndAt)) return true;
  if (patch.hangarId !== undefined && (patch.hangarId ?? null) !== (existing.hangarId ?? null)) return true;
  if (patch.layoutId !== undefined && (patch.layoutId ?? null) !== (existing.layoutId ?? null)) return true;
  return false;
}
