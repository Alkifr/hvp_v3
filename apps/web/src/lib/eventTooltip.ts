import { laborSeriesEditable } from "./laborEditability";

const SEPARATOR = "────────";

export type LaborPresence = {
  budget: boolean;
  mps: boolean;
  actual: boolean;
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
};

function absent(name: string) {
  return `- ${name}: Отсутствует`;
}

/**
 * Подсказка бара: реквизиты события и, под чертой, то, что не заполнено.
 * Факт — только у «Завершено». MPS и бюджет — пока статус не позже «В работе».
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

  const gaps: string[] = [];
  if (!workshop) gaps.push(absent("Цех"));
  if (!model.maintenanceType?.trim()) gaps.push(absent("Вид ТО"));
  if (!model.deadlineFilled) gaps.push(absent("Дедлайн"));
  if (model.hasTows === false) gaps.push(absent("Буксировки"));

  const laborArgs = {
    status: model.status,
    statusSortOrder: model.statusSortOrder,
    inProgressSortOrder: model.inProgressSortOrder
  };
  if (model.status === "DONE" && !model.actualPeriodFilled) gaps.push(absent("Фактическое время"));
  if (model.labor) {
    if (laborSeriesEditable({ ...laborArgs, series: "actual" }) && !model.labor.actual) {
      gaps.push(absent("Трудоемкость"));
    }
    if (laborSeriesEditable({ ...laborArgs, series: "mps" }) && !model.labor.mps) {
      gaps.push(absent("Трудоемкость MPS"));
    }
    if (laborSeriesEditable({ ...laborArgs, series: "budget" }) && !model.labor.budget) {
      gaps.push(absent("Трудоемкость Бюджет"));
    }
  }

  if (!gaps.length) return lines.join("\n");
  return [...lines, SEPARATOR, ...gaps].join("\n");
}
