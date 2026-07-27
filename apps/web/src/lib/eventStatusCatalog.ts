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
    sortOrder: 10,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: "PENDING_CUSTOMER_APPROVAL",
    name: "На согласовании с заказчиком",
    sortOrder: 20,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: "APPROVED_BY_EXECUTOR",
    name: "Согласовано с исполнителем",
    sortOrder: 30,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true
  },
  {
    code: "APPROVED_BY_CUSTOMER",
    name: "Согласовано с заказчиком",
    sortOrder: 40,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true
  },
  {
    code: "IN_PROGRESS",
    name: "В работе",
    sortOrder: 50,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false
  },
  {
    code: "DONE",
    name: "Завершено",
    sortOrder: 60,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false
  },
  {
    code: "CANCELLED",
    name: "Отменено",
    sortOrder: 70,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: "DELETED",
    name: "Удалено",
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

export function isPendingApprovalStatus(status: string | null | undefined): boolean {
  return status === "PENDING_EXECUTOR_APPROVAL" || status === "PENDING_CUSTOMER_APPROVAL";
}

export function isApprovedStatus(status: string | null | undefined): boolean {
  return status === "APPROVED_BY_EXECUTOR" || status === "APPROVED_BY_CUSTOMER";
}
