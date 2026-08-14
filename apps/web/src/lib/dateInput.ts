import dayjs from "dayjs";

/** Для `<input type="date">`: пусто или неполный ввод — ещё не валидная дата. */
export function isValidDateInput(v: string): boolean {
  if (!v) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = dayjs(v);
  return d.isValid() && d.format("YYYY-MM-DD") === v;
}

export function parseDateInputStart(v: string): dayjs.Dayjs | null {
  if (!isValidDateInput(v)) return null;
  return dayjs(v).startOf("day");
}

export function parseDateInputEnd(v: string): dayjs.Dayjs | null {
  if (!isValidDateInput(v)) return null;
  return dayjs(v).endOf("day");
}

const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isValidDateTimeLocal(v: string): boolean {
  if (!v || !DATETIME_LOCAL_RE.test(v)) return false;
  const d = dayjs(v);
  return d.isValid() && d.format("YYYY-MM-DDTHH:mm") === v;
}

export function formatDateTimeDisplay(v: string): string {
  if (!isValidDateTimeLocal(v)) return "";
  return dayjs(v).format("DD.MM.YYYY HH:mm");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function expandTwoDigitYear(yy: number): number {
  return yy <= 68 ? 2000 + yy : 1900 + yy;
}

function makeDateTimeLocal(year: number, month: number, day: number, hour: number, minute: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (year < 1900 || year > 9999) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const isoDate = `${year}-${pad2(month)}-${pad2(day)}`;
  const d = dayjs(isoDate);
  if (!d.isValid() || d.format("YYYY-MM-DD") !== isoDate) return null;
  return `${isoDate}T${pad2(hour)}:${pad2(minute)}`;
}

function parseTimeToken(raw: string): { hour: number; minute: number } | null {
  const token = raw.trim();
  if (!token) return null;
  const colon = /^(\d{1,2})[:.](\d{2})$/.exec(token);
  if (colon) return { hour: Number(colon[1]), minute: Number(colon[2]) };
  if (/^\d{3,4}$/.test(token)) {
    const padded = token.padStart(4, "0");
    return { hour: Number(padded.slice(0, 2)), minute: Number(padded.slice(2, 4)) };
  }
  if (/^\d{1,2}$/.test(token)) return { hour: Number(token), minute: 0 };
  return null;
}

function parseYearMonthDay(year: number, month: number, day: number, hour: number, minute: number): string | null {
  return makeDateTimeLocal(year, month, day, hour, minute);
}

function parseDayMonthYear(day: number, month: number, yearRaw: number, hour: number, minute: number): string | null {
  const year = yearRaw < 100 ? expandTwoDigitYear(yearRaw) : yearRaw;
  return makeDateTimeLocal(year, month, day, hour, minute);
}

function parseDigitDate(digits: string, hour: number, minute: number): string | null {
  if (digits.length === 6) {
    return parseDayMonthYear(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4, 6)), hour, minute);
  }
  if (digits.length !== 8) return null;
  const asIso = parseYearMonthDay(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)),
    Number(digits.slice(6, 8)),
    hour,
    minute
  );
  const yearPrefix = Number(digits.slice(0, 4));
  if (asIso && yearPrefix >= 1900 && yearPrefix <= 2099) return asIso;
  return parseDayMonthYear(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4, 8)), hour, minute);
}

/**
 * Разбирает дату/время из привычных пользовательских масок.
 * Примеры: `03012026`, `030126`, `03.01.2026`, `03/01/2026 14:00`,
 * `030120261400`, `2026-01-03T14:00`, `20260103`.
 * Возвращает `YYYY-MM-DDTHH:mm` или `null`, если ввод ещё неполный/невалидный.
 */
export function parseFlexibleDateTime(raw: string, defaultTime?: { hour: number; minute: number }): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const hourDefault = defaultTime?.hour ?? 0;
  const minuteDefault = defaultTime?.minute ?? 0;

  if (isValidDateTimeLocal(text)) return text;

  const isoDateTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text);
  if (isoDateTime) {
    const [year, month, day] = isoDateTime[1].split("-").map(Number);
    return makeDateTimeLocal(year, month, day, Number(isoDateTime[2]), Number(isoDateTime[3]));
  }

  if (isValidDateInput(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return makeDateTimeLocal(year, month, day, hourDefault, minuteDefault);
  }

  const separated = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T,](\d{1,2}[:.]?\d{0,2}))?$/.exec(text);
  if (separated) {
    let hour = hourDefault;
    let minute = minuteDefault;
    if (separated[4]) {
      const time = parseTimeToken(separated[4].includes(":") || separated[4].includes(".") ? separated[4] : separated[4].padStart(4, "0"));
      if (!time) return null;
      hour = time.hour;
      minute = time.minute;
    }
    return parseDayMonthYear(Number(separated[1]), Number(separated[2]), Number(separated[3]), hour, minute);
  }

  const isoCompact = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T,](\d{1,2}[:.]?\d{0,2}))?$/.exec(text);
  if (isoCompact && Number(isoCompact[1]) >= 1900) {
    let hour = hourDefault;
    let minute = minuteDefault;
    if (isoCompact[4]) {
      const time = parseTimeToken(isoCompact[4].includes(":") || isoCompact[4].includes(".") ? isoCompact[4] : isoCompact[4].padStart(4, "0"));
      if (!time) return null;
      hour = time.hour;
      minute = time.minute;
    }
    return parseYearMonthDay(Number(isoCompact[1]), Number(isoCompact[2]), Number(isoCompact[3]), hour, minute);
  }

  const spaced = /^(\d{6,8})(?:[ T,](\d{1,4}))?$/.exec(text);
  if (spaced) {
    let hour = hourDefault;
    let minute = minuteDefault;
    if (spaced[2]) {
      const time = parseTimeToken(spaced[2]);
      if (!time) return null;
      hour = time.hour;
      minute = time.minute;
    }
    return parseDigitDate(spaced[1], hour, minute);
  }

  const compact = text.replace(/[^\d]/g, "");
  if (compact.length === 12) {
    return parseDigitDate(compact.slice(0, 8), Number(compact.slice(8, 10)), Number(compact.slice(10, 12)));
  }
  if (compact.length === 10) {
    return parseDigitDate(compact.slice(0, 8), Number(compact.slice(8, 10)), 0);
  }
  if (compact.length === 8 || compact.length === 6) {
    return parseDigitDate(compact, hourDefault, minuteDefault);
  }

  return null;
}

const DATE_INPUT_SELECTOR = 'input[type="date"], input[type="datetime-local"]';

/** Убирает расширенный год, который Safari/Chromium допускают до 6 цифр. */
export function clampDateInputYear(value: string): string {
  const match = value.match(/^\+?(\d{4})\d+(-.*)$/);
  return match ? `${match[1]}${match[2]}` : value;
}

/**
 * Глобально ограничивает нативные date/datetime-local четырёхзначным годом.
 * `max` ограничивает picker, capture-input нормализует ручной ввод в браузерах,
 * которые всё равно позволяют ввести расширенный год.
 */
export function installFourDigitDateYearLimit(): () => void {
  const applyMax = (root: ParentNode) => {
    root.querySelectorAll<HTMLInputElement>(DATE_INPUT_SELECTOR).forEach((input) => {
      input.max = input.type === "date" ? "9999-12-31" : "9999-12-31T23:59";
      input.inputMode = "numeric";
    });
  };

  const onInput = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== "date" && input.type !== "datetime-local") return;
    const next = clampDateInputYear(input.value);
    if (next !== input.value) input.value = next;
  };

  applyMax(document);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(DATE_INPUT_SELECTOR)) applyMax(node.parentNode ?? document);
        else applyMax(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("input", onInput, true);

  return () => {
    observer.disconnect();
    document.removeEventListener("input", onInput, true);
  };
}
