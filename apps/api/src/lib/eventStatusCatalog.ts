import { EventStatus } from "@prisma/client";

export type EventStatusCatalogItem = {
  code: EventStatus;
  name: string;
  sortOrder: number;
  /** Показывать в селектах формы события */
  selectable: boolean;
  /** Автоматика статусов не трогает */
  manualOnly: boolean;
  /** Допускает автопереход в IN_PROGRESS по startAt */
  allowsAutoInProgress: boolean;
};

export const EVENT_STATUS_CATALOG: EventStatusCatalogItem[] = [
  {
    code: EventStatus.PENDING_EXECUTOR_APPROVAL,
    name: "На согласовании с исполнителем",
    sortOrder: 10,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.PENDING_CUSTOMER_APPROVAL,
    name: "На согласовании с заказчиком",
    sortOrder: 20,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.APPROVED_BY_EXECUTOR,
    name: "Согласовано с исполнителем",
    sortOrder: 30,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true
  },
  {
    code: EventStatus.APPROVED_BY_CUSTOMER,
    name: "Согласовано с заказчиком",
    sortOrder: 40,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: true
  },
  {
    code: EventStatus.IN_PROGRESS,
    name: "В работе",
    sortOrder: 50,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.DONE,
    name: "Завершено",
    sortOrder: 60,
    selectable: true,
    manualOnly: false,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.CANCELLED,
    name: "Отменено",
    sortOrder: 70,
    selectable: true,
    manualOnly: true,
    allowsAutoInProgress: false
  },
  {
    code: EventStatus.DELETED,
    name: "Удалено",
    sortOrder: 80,
    selectable: false,
    manualOnly: true,
    allowsAutoInProgress: false
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
