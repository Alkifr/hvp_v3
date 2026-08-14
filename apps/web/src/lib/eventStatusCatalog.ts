export const EVENT_STATUS_CODES = [
  "PENDING_EXECUTOR_APPROVAL",
  "PENDING_CUSTOMER_APPROVAL",
  "APPROVED_BY_EXECUTOR",
  "APPROVED_BY_CUSTOMER",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
  "DELETED"
] as const;

export type EventStatusCode = (typeof EVENT_STATUS_CODES)[number];

export type EventStatusCatalogItem = {
  code: EventStatusCode;
  name: string;
  color?: string | null;
  sortOrder: number;
  selectable: boolean;
  manualOnly: boolean;
  allowsAutoInProgress: boolean;
  isSystem?: boolean;
};

export const EVENT_STATUS_CATALOG: EventStatusCatalogItem[] = [
  {
    code: "PENDING_EXECUTOR_APPROVAL",
    name: "На согласовании с исполнителем",
    color: "#FFC182",
    sortOrder: 10,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: "PENDING_CUSTOMER_APPROVAL",
    name: "На согласовании с заказчиком",
    color: "#F8FA7F",
    sortOrder: 20,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: "APPROVED_BY_EXECUTOR",
    name: "Согласовано с исполнителем",
    color: "#FFC1FF",
    sortOrder: 30,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true
  },
  {
    code: "APPROVED_BY_CUSTOMER",
    name: "Согласовано с заказчиком",
    color: "#7BFA7F",
    sortOrder: 40,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true
  },
  {
    code: "IN_PROGRESS",
    name: "В работе",
    color: null,
    sortOrder: 50,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false
  },
  {
    code: "DONE",
    name: "Завершено",
    color: "#16a34a",
    sortOrder: 60,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false
  },
  {
    code: "CANCELLED",
    name: "Отменено",
    color: null,
    sortOrder: 70,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: "DELETED",
    name: "Удалено",
    color: null,
    sortOrder: 80,
    selectable: false,
    manualOnly: true,
    allowsAutoInProgress: false,
    isSystem: true
  }
];

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_STATUS_CATALOG.map((item) => [item.code, item.name])
);

export const SELECTABLE_EVENT_STATUSES = EVENT_STATUS_CATALOG.filter((item) => item.selectable).map(
  (item) => item.code
);

export const DEFAULT_EVENT_STATUS: EventStatusCode = "PENDING_EXECUTOR_APPROVAL";

export const AIRCRAFT_EDITABLE_STATUSES = new Set<string>([
  "PENDING_EXECUTOR_APPROVAL",
  "PENDING_CUSTOMER_APPROVAL"
]);

/** Цвета полоски статуса на баре Гантта по умолчанию (справочник может переопределить). */
export const STATUS_GANTT_STRIPE: Partial<Record<EventStatusCode, string>> = Object.fromEntries(
  EVENT_STATUS_CATALOG.filter((item) => item.color).map((item) => [item.code, item.color as string])
);

export function overlayStatusCatalog(
  rows: Array<Partial<EventStatusCatalogItem> & { code: string }> | null | undefined
): EventStatusCatalogItem[] {
  if (!rows?.length) return EVENT_STATUS_CATALOG;
  const byCode = new Map(rows.map((row) => [row.code, row]));
  return EVENT_STATUS_CATALOG.map((item) => {
    const overlay = byCode.get(item.code);
    if (!overlay) return item;
    return {
      ...item,
      name: overlay.name?.trim() || item.name,
      color: overlay.color !== undefined ? overlay.color : item.color,
      sortOrder: overlay.sortOrder ?? item.sortOrder,
      selectable: overlay.selectable ?? item.selectable
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
}

export function statusCatalogLabel(
  status: string | null | undefined,
  catalog?: EventStatusCatalogItem[] | null
): string {
  if (!status) return "—";
  const fromCat = catalog?.find((item) => item.code === status)?.name;
  return fromCat || STATUS_LABEL[status] || status;
}

export function ganttStatusStripeColor(
  status: string | null | undefined,
  catalog?: Array<{ code: string; color?: string | null }> | null
): string | null {
  if (!status) return null;
  const fromCat = catalog?.find((item) => item.code === status)?.color?.trim();
  if (fromCat) return fromCat;
  if (catalog) {
    const hit = catalog.find((item) => item.code === status);
    if (hit && (hit.color === null || hit.color === "")) return null;
  }
  return STATUS_GANTT_STRIPE[status as EventStatusCode] ?? null;
}

export function isPendingApprovalStatus(status: string | null | undefined): boolean {
  return status === "PENDING_EXECUTOR_APPROVAL" || status === "PENDING_CUSTOMER_APPROVAL";
}

export function isApprovedStatus(status: string | null | undefined): boolean {
  return status === "APPROVED_BY_EXECUTOR" || status === "APPROVED_BY_CUSTOMER";
}
