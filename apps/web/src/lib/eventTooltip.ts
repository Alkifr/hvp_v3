import { laborSeriesEditable } from "./laborEditability";

const SEPARATOR = "────────";

export type LaborPresence = {
  budget: boolean;
  mps: boolean;
  actual: boolean;
};

export type EventWarningSection = "main" | "periods" | "place" | "tows" | "notes" | "labor" | "history";

export type EventWarning = {
  id: string;
  text: string;
  section: EventWarningSection;
};

export type EventTooltipModel = {
  tat: string;
  tailNumber: string;
  title: string;
  stage: string;
  operationalPeriod: string;
  workshop: string | null;
  /** Вид ТО — тип события. Пустая строка считается незаполненным. */
  maintenanceType: string | null;
  deadlineFilled: boolean;
  /** null — состав буксировок неизвестен, строку не показываем. */
  hasTows: boolean | null;
  status: string;
  actualPeriodFilled: boolean;
  /** null — трудоёмкость не пришла с сервера, строки не показываем. */
  labor: LaborPresence | null;
  statusSortOrder?: number | null;
  inProgressSortOrder?: number | null;
  /** Борт размещён в ангаре. Вместе с буксировкой даёт замечание планировщику. */
  inHangar?: boolean;
  /** Нахлёст уже разрешён или слот реально пересекается с другим. */
  allowOverlap?: boolean;
  /** Начало оперативного слота позже DeadLine. */
  slotAfterDeadline?: boolean;
};

function absent(name: string) {
  return `${name}: Отсутствует`;
}

const QUIET_STATUSES = new Set(["CANCELLED", "DELETED"]);

/** Знак «!» на баре: то, что планировщик разбирает на диаграмме. Пустой дедлайн и бюджет остаются в карточке. */
const BAR_WARNING_IDS = new Set([
  "slot-deadline",
  "tows-missing",
  "tow-in-hangar",
  "overlap",
  "actual-time",
  "labor-mps",
  "labor-actual"
]);

/**
 * Замечания планировщику по событию.
 * Факт — только у «Завершено». MPS и бюджет — пока статус не позже «В работе».
 * Буксировка при стоянке в ангаре, нахлёст и слот позже DeadLine не показываются у отменённых.
 */
export type EventWarningInput = Omit<EventTooltipModel, "tat" | "tailNumber" | "title" | "stage" | "operationalPeriod">;

export function eventWarningLines(model: EventWarningInput): EventWarning[] {
  const quiet = QUIET_STATUSES.has(model.status);
  const gaps: EventWarning[] = [];
  if (!quiet && model.slotAfterDeadline) {
    gaps.push({ id: "slot-deadline", text: "Дата начала слота позже DeadLine.", section: "periods" });
  }

  const workshop = model.workshop?.trim() ?? "";
  if (!workshop) gaps.push({ id: "workshop", text: absent("Цех"), section: "main" });
  if (!model.maintenanceType?.trim()) gaps.push({ id: "maintenance-type", text: absent("Вид ТО"), section: "main" });
  if (!model.deadlineFilled) gaps.push({ id: "deadline", text: absent("Дедлайн"), section: "main" });
  if (model.hasTows === false) gaps.push({ id: "tows-missing", text: absent("Буксировки"), section: "tows" });
  if (!quiet && model.hasTows === true && model.inHangar) {
    gaps.push({
      id: "tow-in-hangar",
      text: "Есть буксировка, а борт стоит в ангаре.",
      section: "tows"
    });
  }
  if (!quiet && model.allowOverlap) {
    gaps.push({ id: "overlap", text: "Нахлёст места.", section: "place" });
  }

  const laborArgs = {
    status: model.status,
    statusSortOrder: model.statusSortOrder,
    inProgressSortOrder: model.inProgressSortOrder
  };
  if (model.status === "DONE" && !model.actualPeriodFilled) {
    gaps.push({ id: "actual-time", text: absent("Фактическое время"), section: "periods" });
  }
  if (model.labor) {
    if (laborSeriesEditable({ ...laborArgs, series: "actual" }) && !model.labor.actual) {
      gaps.push({ id: "labor-actual", text: absent("Трудоемкость"), section: "labor" });
    }
    if (laborSeriesEditable({ ...laborArgs, series: "mps" }) && !model.labor.mps) {
      gaps.push({ id: "labor-mps", text: absent("Трудоемкость MPS"), section: "labor" });
    }
    if (laborSeriesEditable({ ...laborArgs, series: "budget" }) && !model.labor.budget) {
      gaps.push({ id: "labor-budget", text: absent("Трудоемкость Бюджет"), section: "labor" });
    }
  }
  return gaps;
}

/** Замечания, из-за которых на баре перед TAT ставится «!». */
export function barPlannerWarnings(model: EventWarningInput): EventWarning[] {
  return eventWarningLines(model).filter((item) => BAR_WARNING_IDS.has(item.id));
}

/**
 * Подсказка бара: реквизиты события и, под чертой, замечания планировщику.
 */
export function formatEventTooltip(model: EventTooltipModel): string {
  const lines = [
    `TAT: ${model.tat}`,
    `Бортовой номер: ${model.tailNumber}`,
    `Наименование события: ${model.title}`,
    `Этап: ${model.stage}`,
    `Оперативный период: ${model.operationalPeriod}`
  ];
  const workshop = model.workshop?.trim() ?? "";
  if (workshop) lines.push(`Цех: ${workshop}`);

  const gaps = eventWarningLines(model).map((item) => `- ${item.text}`);
  if (!gaps.length) return lines.join("\n");
  return [...lines, SEPARATOR, ...gaps].join("\n");
}
