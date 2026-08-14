import { EventStatus, type PrismaClient } from "@prisma/client";

export type EventStatusCatalogItem = {
  code: EventStatus;
  name: string;
  color: string | null;
  sortOrder: number;
  /** Показывать в селектах формы события */
  selectable: boolean;
  /** Автоматика статусов не трогает */
  manualOnly: boolean;
  /** Допускает автопереход в IN_PROGRESS по startAt */
  allowsAutoInProgress: boolean;
  isSystem?: boolean;
};

export const EVENT_STATUS_CATALOG: EventStatusCatalogItem[] = [
  {
    code: EventStatus.PENDING_EXECUTOR_APPROVAL,
    name: "На согласовании с исполнителем",
    color: "#FFC182",
    sortOrder: 10,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.PENDING_CUSTOMER_APPROVAL,
    name: "На согласовании с заказчиком",
    color: "#F8FA7F",
    sortOrder: 20,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.APPROVED_BY_EXECUTOR,
    name: "Согласовано с исполнителем",
    color: "#FFC1FF",
    sortOrder: 30,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true
  },
  {
    code: EventStatus.APPROVED_BY_CUSTOMER,
    name: "Согласовано с заказчиком",
    color: "#7BFA7F",
    sortOrder: 40,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true
  },
  {
    code: EventStatus.IN_PROGRESS,
    name: "В работе",
    color: null,
    sortOrder: 50,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.DONE,
    name: "Завершено",
    color: "#16a34a",
    sortOrder: 60,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.CANCELLED,
    name: "Отменено",
    color: null,
    sortOrder: 70,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.DELETED,
    name: "Удалено",
    color: null,
    sortOrder: 80,
    selectable: false,
    manualOnly: true,
    allowsAutoInProgress: false,
    isSystem: true
  }
];

const byCode = new Map(EVENT_STATUS_CATALOG.map((item) => [item.code, item]));

export function eventStatusLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return byCode.get(code as EventStatus)?.name ?? code;
}

export function selectableEventStatuses(): EventStatusCatalogItem[] {
  return EVENT_STATUS_CATALOG.filter((item) => item.selectable);
}

export const DEFAULT_EVENT_STATUS = EventStatus.PENDING_EXECUTOR_APPROVAL;

export const MANUAL_ONLY_STATUSES = new Set(
  EVENT_STATUS_CATALOG.filter((item) => item.manualOnly).map((item) => item.code)
);

export const AUTO_IN_PROGRESS_STATUSES = new Set(
  EVENT_STATUS_CATALOG.filter((item) => item.allowsAutoInProgress).map((item) => item.code)
);

/** Статусы «на согласовании» — борт ещё можно менять */
export const AIRCRAFT_EDITABLE_STATUSES = new Set<EventStatus>([
  EventStatus.PENDING_EXECUTOR_APPROVAL,
  EventStatus.PENDING_CUSTOMER_APPROVAL
]);

export async function ensureEventStatusCatalogRows(prisma: PrismaClient): Promise<void> {
  await prisma.eventStatusCatalog.createMany({
    data: EVENT_STATUS_CATALOG.map((item) => ({
      code: item.code,
      name: item.name,
      color: item.color,
      sortOrder: item.sortOrder,
      selectable: item.selectable,
      allowsAutoInProgress: item.allowsAutoInProgress,
      manualOnly: item.manualOnly
    })),
    skipDuplicates: true
  });
}

export type EventStatusStoredRow = {
  code: EventStatus;
  name: string;
  color: string | null;
  sortOrder: number;
  selectable: boolean;
  allowsAutoInProgress?: boolean;
  manualOnly?: boolean;
};

export function mergeEventStatusCatalogRow(
  stored: EventStatusStoredRow
): EventStatusCatalogItem & { id: string; isActive: boolean } {
  const base = byCode.get(stored.code);
  const selectable = stored.code === EventStatus.DELETED ? false : stored.selectable;
  const allowsAutoInProgress =
    stored.code === EventStatus.DELETED || stored.code === EventStatus.CANCELLED
      ? false
      : (stored.allowsAutoInProgress ?? base?.allowsAutoInProgress ?? false);
  const manualOnly =
    stored.code === EventStatus.DELETED
      ? true
      : (stored.manualOnly ?? base?.manualOnly ?? false);
  return {
    id: stored.code,
    code: stored.code,
    name: stored.name || base?.name || stored.code,
    color: stored.color,
    sortOrder: stored.sortOrder ?? base?.sortOrder ?? 0,
    selectable,
    manualOnly,
    allowsAutoInProgress,
    isSystem: stored.code === EventStatus.DELETED,
    isActive: selectable
  };
}

export async function loadStatusAutomation(prisma: PrismaClient): Promise<{
  autoInProgressStatuses: Set<EventStatus>;
  manualOnlyStatuses: Set<EventStatus>;
}> {
  await ensureEventStatusCatalogRows(prisma);
  const rows = await prisma.eventStatusCatalog.findMany({
    select: { code: true, allowsAutoInProgress: true, manualOnly: true }
  });
  if (rows.length === 0) {
    return {
      autoInProgressStatuses: AUTO_IN_PROGRESS_STATUSES,
      manualOnlyStatuses: MANUAL_ONLY_STATUSES
    };
  }
  return {
    autoInProgressStatuses: new Set(rows.filter((row) => row.allowsAutoInProgress).map((row) => row.code)),
    manualOnlyStatuses: new Set(rows.filter((row) => row.manualOnly).map((row) => row.code))
  };
}
