import type { PrismaClient } from "@prisma/client";

/** Системные коды — логика планирования. Остальные коды задаются в справочнике. */
export const EventStatus = {
  PENDING_EXECUTOR_APPROVAL: "PENDING_EXECUTOR_APPROVAL",
  PENDING_CUSTOMER_APPROVAL: "PENDING_CUSTOMER_APPROVAL",
  APPROVED_BY_EXECUTOR: "APPROVED_BY_EXECUTOR",
  APPROVED_BY_CUSTOMER: "APPROVED_BY_CUSTOMER",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
  CANCELLED: "CANCELLED",
  DELETED: "DELETED"
} as const;

export type EventStatusCatalogItem = {
  code: string;
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
    allowsAutoInProgress: false,
    isSystem: true
  },
  {
    code: EventStatus.PENDING_CUSTOMER_APPROVAL,
    name: "На согласовании с заказчиком",
    color: "#F8FA7F",
    sortOrder: 20,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false,
    isSystem: true
  },
  {
    code: EventStatus.APPROVED_BY_EXECUTOR,
    name: "Согласовано с исполнителем",
    color: "#FFC1FF",
    sortOrder: 30,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true,
    isSystem: true
  },
  {
    code: EventStatus.APPROVED_BY_CUSTOMER,
    name: "Согласовано с заказчиком",
    color: "#7BFA7F",
    sortOrder: 40,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true,
    isSystem: true
  },
  {
    code: EventStatus.IN_PROGRESS,
    name: "В работе",
    color: null,
    sortOrder: 50,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false,
    isSystem: true
  },
  {
    code: EventStatus.DONE,
    name: "Завершено",
    color: "#16a34a",
    sortOrder: 60,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false,
    isSystem: true
  },
  {
    code: EventStatus.CANCELLED,
    name: "Отменено",
    color: null,
    sortOrder: 70,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false,
    isSystem: true
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

export const SYSTEM_EVENT_STATUS_CODES = new Set(EVENT_STATUS_CATALOG.map((item) => item.code));

export function isSystemEventStatusCode(code: string): boolean {
  return SYSTEM_EVENT_STATUS_CODES.has(code);
}

export function normalizeEventStatusCode(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function isEventStatusCodeFormat(code: string): boolean {
  return code.length >= 2 && code.length <= 64 && /^[A-Z][A-Z0-9_]*$/.test(code);
}

function statusMatchKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[\s-]+/g, "_");
}

/** Код статуса из ячейки импорта: код каталога или русское название. Пустая ячейка → null. */
export function resolveImportEventStatus(
  raw: string,
  catalog: Array<{ code: string; name: string }>
): string | null {
  const key = statusMatchKey(raw);
  if (!key) return null;
  const normalizedCode = normalizeEventStatusCode(raw);
  for (const item of catalog) {
    if (item.code === normalizedCode) return item.code;
    if (statusMatchKey(item.code) === key || statusMatchKey(item.name) === key) return item.code;
  }
  for (const item of EVENT_STATUS_CATALOG) {
    if (item.code === normalizedCode) return item.code;
    if (statusMatchKey(item.code) === key || statusMatchKey(item.name) === key) return item.code;
  }
  return null;
}

export function eventStatusLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return byCode.get(code)?.name ?? code;
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
export const AIRCRAFT_EDITABLE_STATUSES = new Set<string>([
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
  code: string;
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
  const isSystem = isSystemEventStatusCode(stored.code);
  const selectable = stored.code === EventStatus.DELETED ? false : stored.selectable;
  const allowsAutoInProgress =
    stored.code === EventStatus.DELETED || stored.code === EventStatus.CANCELLED
      ? false
      : (stored.allowsAutoInProgress ?? base?.allowsAutoInProgress ?? false);
  const manualOnly =
    stored.code === EventStatus.DELETED ? true : (stored.manualOnly ?? base?.manualOnly ?? false);
  return {
    id: stored.code,
    code: stored.code,
    name: stored.name || base?.name || stored.code,
    color: stored.color,
    sortOrder: stored.sortOrder ?? base?.sortOrder ?? 0,
    selectable,
    manualOnly,
    allowsAutoInProgress,
    isSystem,
    isActive: selectable
  };
}

export async function loadStatusAutomation(prisma: PrismaClient): Promise<{
  autoInProgressStatuses: Set<string>;
  manualOnlyStatuses: Set<string>;
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

export async function loadSelectableEventStatusCodes(prisma: PrismaClient): Promise<Set<string>> {
  await ensureEventStatusCatalogRows(prisma);
  const rows = await prisma.eventStatusCatalog.findMany({
    select: { code: true, selectable: true }
  });
  return new Set(
    rows.filter((row) => row.selectable && row.code !== EventStatus.DELETED).map((row) => row.code)
  );
}
