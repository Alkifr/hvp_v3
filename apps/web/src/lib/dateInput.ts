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
