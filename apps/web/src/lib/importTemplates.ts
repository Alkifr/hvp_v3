import * as XLSX from "xlsx";

type SheetRow = Record<string, string | number>;

function downloadWorkbook(filename: string, sheets: Array<{ name: string; rows: SheetRow[] }>) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

/** Шаблон XLSX для пакетного массового планирования. */
export function downloadMassPlanBatchTemplate(params?: {
  operator?: string;
  aircraftType?: string;
  eventType?: string;
  startFrom?: string;
  endTo?: string;
}) {
  const operator = params?.operator || "DEMO";
  const aircraftType = params?.aircraftType || "A320";
  const eventType = params?.eventType || "A_CHECK";
  const startFrom = params?.startFrom || "2026-07-01";
  const endTo = params?.endTo || "2026-08-31";

  downloadWorkbook("mass-plan-batch-template.xlsx", [
    {
      name: "Данные",
      rows: [
        {
          operator,
          aircraftType,
          eventType,
          tatHours: 72,
          count: 2,
          startFrom,
          endTo,
          titleTemplate: "A-check %",
          spacingHours: 0,
          cadenceHours: 168
        }
      ]
    },
    {
      name: "Инструкция",
      rows: [
        { Колонка: "operator", Обязательно: "да", Описание: "Оператор: код, название или id из справочника" },
        { Колонка: "aircraftType", Обязательно: "да", Описание: "Тип ВС: ICAO, название или id" },
        { Колонка: "eventType", Обязательно: "да", Описание: "Тип события: код, название или id" },
        { Колонка: "tatHours", Обязательно: "да", Описание: "Длительность TAT, часы (по умолчанию 72)" },
        { Колонка: "count", Обязательно: "да", Описание: "Количество событий в серии (по умолчанию 1)" },
        { Колонка: "startFrom", Обязательно: "да", Описание: "Начало периода планирования, дата YYYY-MM-DD или ДД.ММ.ГГГГ" },
        { Колонка: "endTo", Обязательно: "да", Описание: "Крайний старт события, дата YYYY-MM-DD или ДД.ММ.ГГГГ" },
        { Колонка: "titleTemplate", Обязательно: "нет", Описание: "Шаблон названия; % заменяется на номер" },
        { Колонка: "spacingHours", Обязательно: "нет", Описание: "Пауза между событиями, ч (режим «Последовательно»)" },
        { Колонка: "cadenceHours", Обязательно: "нет", Описание: "Шаг cadence, ч (режим «Фикс. cadence»)" },
        {
          Колонка: "Алиасы",
          Обязательно: "—",
          Описание:
            "operator←оператор; aircraftType←тип вс|тип; eventType←тип события|событие; tatHours←tat|тат; count←количество|qty; startFrom←начало периода|дата начала|start; endTo←конец периода|дата окончания|end; titleTemplate←название|шаблон"
        }
      ]
    }
  ]);
}

/** Шаблон XLSX для импорта событий. */
export function downloadEventImportTemplate(params?: {
  operator?: string;
  aircraft?: string;
  aircraftType?: string;
  eventName?: string;
  hangar?: string;
  hangarStand?: string;
}) {
  const operator = params?.operator || "DEMO";
  const aircraft = params?.aircraft || "RA-00000";
  const aircraftType = params?.aircraftType || "A320";
  const eventName = params?.eventName || "A_CHECK";
  const hangar = params?.hangar || "";
  const hangarStand = params?.hangarStand || "";

  downloadWorkbook("event-import-template.xlsx", [
    {
      name: "Данные",
      rows: [
        {
          Operator: operator,
          Aircraft: aircraft,
          AircraftType: aircraftType,
          Event_Title: "A-check пример",
          Event_name: eventName,
          startAt: "2026-07-15 09:00",
          endAt: "2026-07-18 18:00",
          budgetStartAt: "2026-07-15 09:00",
          budgetEndAt: "2026-07-18 18:00",
          actualStartAt: "",
          actualEndAt: "",
          towStartAt: "",
          towEndAt: "",
          Hangar: hangar,
          HangarStand: hangarStand
        }
      ]
    },
    {
      name: "Инструкция",
      rows: [
        { Колонка: "Aircraft", Обязательно: "да", Описание: "Бортовой номер из справочника" },
        { Колонка: "Event_name", Обязательно: "да", Описание: "Тип события: код или название" },
        { Колонка: "startAt", Обязательно: "да", Описание: "Оперативное начало (местное время MSK)" },
        { Колонка: "endAt", Обязательно: "да", Описание: "Оперативное окончание (местное время MSK)" },
        { Колонка: "Operator", Обязательно: "нет", Описание: "Оператор (для проверки/создания контекста)" },
        { Колонка: "AircraftType", Обязательно: "нет", Описание: "Тип ВС" },
        { Колонка: "Event_Title", Обязательно: "нет", Описание: "Название события" },
        { Колонка: "budgetStartAt / budgetEndAt", Обязательно: "нет", Описание: "Бюджетный период (обе даты или пусто)" },
        { Колонка: "actualStartAt / actualEndAt", Обязательно: "нет", Описание: "Фактический период (обе даты или пусто)" },
        { Колонка: "towStartAt / towEndAt", Обязательно: "нет", Описание: "Период буксировки (обе даты или пусто)" },
        { Колонка: "Hangar", Обязательно: "нет", Описание: "Ангар: код или название (активный)" },
        { Колонка: "HangarStand", Обязательно: "нет", Описание: "Место в активном варианте расстановки" },
        {
          Колонка: "Даты",
          Обязательно: "—",
          Описание: "Без часового пояса = MSK. Форматы: YYYY-MM-DD HH:mm, ДД.ММ.ГГГГ HH:mm, Excel-дата"
        }
      ]
    }
  ]);
}
