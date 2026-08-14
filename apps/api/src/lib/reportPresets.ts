import { EVENT_COUNT_FIELD } from "./reportAggregates.js";

/** Поля сводных отчётов по количеству C/A-check (Первичная таблица). */
export const CHECK_EVENT_COUNT_FIELDS = [
  "primary.a", // Фюзеляж
  "primary.b", // Год
  "primary.e", // Заказчик
  "primary.g", // Номер ВС
  "primary.h", // Тип ВС
  "primary.k", // Наименование события (Форма ТО)
  "primary.l", // Тип события (Нормализованная форма)
  "primary.y", // Дата начала слота (план)
  "primary.z", // Дата окончания слота (план)
  "primary.ab", // ТАТ (план), дни
  "primary.ai", // Статус
  "primary.af", // Номер ангара
  "primary.ag", // Номер стоянки
  "primary.al", // Дата начала (факт)
  "primary.am", // Дата окончания (факт)
  "primary.ao" // Продолжительность (факт), дни
] as const;

export type CheckEventCountPreset = {
  name: string;
  description: string;
  eventTypeName: string;
};

export function checkEventCountReportConfig(eventTypeName: string) {
  return {
    dataset: "primary_events" as const,
    fields: [...CHECK_EVENT_COUNT_FIELDS],
    filters: {
      conditions: [{ field: "primary.l", op: "eq" as const, value: eventTypeName }]
    },
    sort: [
      { field: "primary.b", dir: "desc" as const },
      { field: "primary.e", dir: "asc" as const },
      { field: "primary.g", dir: "asc" as const }
    ],
    grain: "week" as const,
    compareA: "prod",
    compareB: "",
    periodFrom: "2026-01-01",
    periodTo: "2026-06-30",
    groupBy: [...CHECK_EVENT_COUNT_FIELDS],
    aggregates: [{ field: EVENT_COUNT_FIELD, fn: "count" as const }]
  };
}

export function checkEventCountPresets(eventTypeNames: { aCheck: string; cCheck: string }): CheckEventCountPreset[] {
  return [
    {
      name: "C-check · количество событий",
      description: "Первичная таблица: C-check, сводка по количеству событий",
      eventTypeName: eventTypeNames.cCheck
    },
    {
      name: "A-check · количество событий",
      description: "Первичная таблица: A-check, сводка по количеству событий",
      eventTypeName: eventTypeNames.aCheck
    }
  ];
}
