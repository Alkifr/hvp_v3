import {
  AUTO_IN_PROGRESS_STATUSES,
  EventStatus,
  MANUAL_ONLY_STATUSES
} from "./eventStatusCatalog.js";

/** Truncate to minute precision (seconds/ms = 0). */
export function floorToMinute(d: Date): Date {
  const x = new Date(d.getTime());
  x.setUTCSeconds(0, 0);
  return x;
}

export type StatusReconcileInput = {
  status: string;
  startAt: Date;
  endAt: Date;
  actualStartAt: Date | null | undefined;
  actualEndAt: Date | null | undefined;
  now?: Date;
  /** User explicitly requested DONE (manual). */
  forceDone?: boolean;
  autoInProgressStatuses?: Set<string>;
  manualOnlyStatuses?: Set<string>;
};

export type StatusReconcileResult = {
  status: string;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  statusChanged: boolean;
  actualFilledFromOper: boolean;
};

const TERMINAL_MANUAL = new Set<string>([EventStatus.CANCELLED, EventStatus.DELETED]);

/**
 * Auto status rules:
 * - CANCELLED / DELETED — untouched
 * - PENDING_* — no auto IN_PROGRESS; fact whose end has arrived / forceDone still → DONE
 * - APPROVED_BY_* + now >= startAt (minute) → IN_PROGRESS
 * - both actual dates and actual end <= now (minute) → DONE
 * - future actual end does not complete the event; an automatic DONE is returned to IN_PROGRESS / APPROVED
 * - forceDone with empty actual → fill actual from operational period and stay DONE
 * - DONE with empty actual and operational end already reached → fill fact and stay DONE
 * - DONE with actual cleared → recompute APPROVED_BY_EXECUTOR / IN_PROGRESS
 */
export function reconcileEventStatus(input: StatusReconcileInput): StatusReconcileResult {
  const now = floorToMinute(input.now ?? new Date());
  const startAt = floorToMinute(input.startAt);
  const endAt = input.endAt;

  const autoInProgress = input.autoInProgressStatuses ?? AUTO_IN_PROGRESS_STATUSES;

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

  // Explicit completion always copies an empty fact from the operational period.
  // An already completed event does the same only after that period has ended,
  // so a future end date is not written in as fact and then cleared from DONE.
  if ((input.forceDone || status === EventStatus.DONE) && (!actualStartAt || !actualEndAt)) {
    const operationalEnded = floorToMinute(endAt).valueOf() <= now.valueOf();
    if (input.forceDone || operationalEnded) {
      actualStartAt = input.startAt;
      actualEndAt = endAt;
      actualFilledFromOper = true;
      status = EventStatus.DONE;
    }
  }

  const hasFact = Boolean(actualStartAt && actualEndAt);
  const actualEnded =
    actualEndAt != null && floorToMinute(actualEndAt).valueOf() <= now.valueOf();

  if (hasFact && actualEnded && status !== EventStatus.DONE) {
    status = EventStatus.DONE;
  } else if (!input.forceDone && status === EventStatus.DONE && hasFact && !actualEnded) {
    // Actual end is still ahead — automatic completion does not hold.
    status = now.valueOf() >= startAt.valueOf() ? EventStatus.IN_PROGRESS : EventStatus.APPROVED_BY_EXECUTOR;
  } else if (!hasFact && status === EventStatus.DONE) {
    // Fact cleared while DONE → fall back by time
    status = now.valueOf() >= startAt.valueOf() ? EventStatus.IN_PROGRESS : EventStatus.APPROVED_BY_EXECUTOR;
  } else if (
    status !== EventStatus.DONE &&
    autoInProgress.has(status) &&
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
  status: string;
  endAt: Date;
  actualStartAt: Date | null | undefined;
  actualEndAt: Date | null | undefined;
  now?: Date;
  manualOnlyStatuses?: Set<string>;
}): boolean {
  const manualOnly = params.manualOnlyStatuses ?? MANUAL_ONLY_STATUSES;
  // Pending approval / cancelled / deleted / done — no overdue nag
  if (manualOnly.has(params.status) || params.status === EventStatus.DONE) return false;
  if (params.actualStartAt && params.actualEndAt) return false;
  const now = floorToMinute(params.now ?? new Date());
  return now.valueOf() > floorToMinute(params.endAt).valueOf();
}

/** Schedule/type/placement stay locked while DONE unless status is explicitly changed away. */
export function isDoneScheduleLocked(
  existingStatus: string,
  requestedStatus?: string | null
): boolean {
  if (existingStatus !== EventStatus.DONE) return false;
  if (requestedStatus != null && requestedStatus !== EventStatus.DONE) return false;
  return true;
}

export const DONE_SCHEDULE_LOCK_MESSAGE =
  "Нельзя менять расписание, тип и размещение у завершённого события. Сначала смените статус.";

export const DONE_DEADLINE_LOCK_MESSAGE =
  "Нельзя менять DeadLine у завершённого события. Сначала смените статус.";

/** DeadLine stays locked while DONE unless status is explicitly changed away. */
export function deadlineChangeBlockedWhileDone(params: {
  existingStatus: string;
  requestedStatus?: string | null;
  existingDeadlineAt?: Date | null;
  requestedDeadlineAt?: Date | null;
  requestedProvided: boolean;
}): boolean {
  if (!params.requestedProvided) return false;
  if (!isDoneScheduleLocked(params.existingStatus, params.requestedStatus)) return false;
  return !sameInstant(params.requestedDeadlineAt ?? null, params.existingDeadlineAt ?? null);
}

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
  status: string;
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
  requestedStatus?: string | null
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
