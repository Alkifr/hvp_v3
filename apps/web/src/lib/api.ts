const SANDBOX_KEY = "hp_sandbox_id";
const SANDBOX_EVENT = "hangarPlanning:sandboxChanged";

export function getActiveSandboxId(): string | null {
  try {
    const v = localStorage.getItem(SANDBOX_KEY);
    return v && v.trim().length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setActiveSandboxId(id: string | null) {
  try {
    if (id) localStorage.setItem(SANDBOX_KEY, id);
    else localStorage.removeItem(SANDBOX_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(SANDBOX_EVENT, { detail: { sandboxId: id } }));
  } catch {
    /* ignore */
  }
}

export function onSandboxChange(handler: (sandboxId: string | null) => void): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<{ sandboxId: string | null }>;
    handler(ce.detail?.sandboxId ?? null);
  };
  const storageListener = (e: StorageEvent) => {
    if (e.key === SANDBOX_KEY) handler(e.newValue ?? null);
  };
  window.addEventListener(SANDBOX_EVENT, listener);
  window.addEventListener("storage", storageListener);
  return () => {
    window.removeEventListener(SANDBOX_EVENT, listener);
    window.removeEventListener("storage", storageListener);
  };
}

function withSandboxHeader(headers: Record<string, string> = {}): Record<string, string> {
  const id = getActiveSandboxId();
  if (id) return { ...headers, "X-Sandbox-Id": id };
  return headers;
}

const MAX_RAW_ERROR = 280;

function looksLikeHtml(text: string): boolean {
  const t = text.trimStart();
  return /^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t);
}

function isTimeoutStatus(status?: number): boolean {
  return status === 408 || status === 504 || status === 524;
}

function isTimeoutText(text: string): boolean {
  return /etimedout|econnreset|timed?\s*out|gateway timeout|504 gateway/i.test(text);
}

function proxyOrTimeoutMessage(status?: number): string {
  return [
    "Превышено время ожидания ответа сети или прокси (часто UserGate/nginx: ETIMEDOUT).",
    "Операция на сервере могла уже выполниться.",
    "Проверьте план и не запускайте тот же файл повторно без проверки.",
    status ? `(HTTP ${status})` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function humanizeFetchFailure(err: unknown): string {
  const msg = String((err as { message?: unknown })?.message ?? err);
  if (/failed to fetch|networkerror|load failed|network request failed|aborted/i.test(msg)) {
    return "Нет связи с сервером или запрос оборвался. Если импорт уже был запущен, часть данных могла сохраниться — проверьте план.";
  }
  return msg;
}

const ERROR_CODE_TEXT: Record<string, string> = {
  UNAUTHORIZED: "Требуется авторизация",
  INVALID_CREDENTIALS: "Неверный email или пароль",
  OLD_PASSWORD_INVALID: "Текущий пароль указан неверно",
  FORBIDDEN: "Недостаточно прав для выполнения операции",
  SANDBOX_NOT_FOUND: "Песочница не найдена",
  SANDBOX_ACCESS_DENIED: "Нет доступа к песочнице",
  SANDBOX_READ_ONLY: "Нет прав на запись в песочнице",
  SANDBOX_WRITE_DENIED: "Нет прав на запись в песочнице",
  USER_NOT_FOUND: "Пользователь не найден",
  CANNOT_ADD_SELF: "Нельзя добавить самого себя",
  CANNOT_SHARE_SELF: "Нельзя поделиться с самим собой",
  REPORT_NOT_FOUND: "Отчёт не найден",
  REPORT_ACCESS_DENIED: "Нет доступа к отчёту",
  REPORT_EDIT_DENIED: "Недостаточно прав, чтобы изменить отчёт",
  REPORT_DELETE_DENIED: "Недостаточно прав, чтобы удалить отчёт",
  REPORT_SHARE_DENIED: "Недостаточно прав, чтобы поделиться отчётом",
  CONFIG_REQUIRED: "Заполните конфигурацию отчёта",
  COMPARE_SIDES_REQUIRED: "Для сравнения нужно выбрать обе стороны",
  TABLE_VIEW_NAME_TAKEN: "Представление с таким именем уже есть",
  TABLE_VIEW_NOT_FOUND: "Представление таблицы не найдено",
  PRIMARY_FIELDS_REQUIRED: "Выберите хотя бы одно поле таблицы",
  INVALID_CURSOR: "Некорректный курсор постраничной загрузки. Обновите таблицу.",
  EVENT_NOT_FOUND: "Событие не найдено",
  EVENTS_NOT_FOUND: "События не найдены",
  NOTIFICATION_NOT_FOUND: "Уведомление не найдено",
  ANNOUNCEMENT_NOT_FOUND: "Объявление не найдено",
  PLAN_LINE_NOT_FOUND: "Строка плана не найдена",
  ACTUAL_LINE_NOT_FOUND: "Строка факта не найдена",
  DB_NOT_CONNECTED: "Нет соединения с базой данных. Повторите попытку позже или обратитесь к администратору.",
  VALIDATION: "Проверьте заполненные поля",
  INTERNAL: "Не удалось выполнить операцию. Если ошибка повторяется, обратитесь к администратору.",
  RECORD_NOT_FOUND: "Запись не найдена",
  RECORD_CONFLICT: "Такая запись уже существует",
  RECORD_IN_USE: "Нельзя изменить запись: она связана с другими данными",
  NOT_FOUND: "Запись не найдена",
  CONFLICT: "Конфликт данных. Обновите страницу и повторите.",
  BAD_REQUEST: "Проверьте заполненные поля"
};

function looksLikeErrorCode(text: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(text.trim());
}

function userTextFromCodeOrMessage(code?: unknown, message?: unknown): string | null {
  const msg = message != null ? String(message).trim() : "";
  const err = code != null ? String(code).trim() : "";
  if (msg && ERROR_CODE_TEXT[msg]) return ERROR_CODE_TEXT[msg];
  if (/^internal server error$/i.test(msg)) return ERROR_CODE_TEXT.INTERNAL;
  if (msg && !looksLikeErrorCode(msg) && !msg.startsWith("[")) return msg;
  if (err && ERROR_CODE_TEXT[err]) return ERROR_CODE_TEXT[err];
  if (msg) return msg;
  return null;
}

function formatApiErrorBody(text: string, status?: number): string {
  const trimmed = String(text ?? "").trim();
  if (trimmed) {
    try {
      const j = JSON.parse(trimmed);
      const fromFields = userTextFromCodeOrMessage(j?.error, j?.message);
      if (fromFields) {
        if (String(j?.message ?? "").trim().startsWith("[")) {
          try {
            const issues = JSON.parse(String(j.message));
            if (Array.isArray(issues)) return formatZodIssuesMessage(issues);
          } catch {
            /* keep mapped text */
          }
        }
        return fromFields;
      }
      if (Array.isArray(j)) return formatZodIssuesMessage(j);
    } catch {
      /* not JSON — HTML/plain from proxy */
    }
  }

  if (
    isTimeoutStatus(status) ||
    isTimeoutText(trimmed) ||
    (looksLikeHtml(trimmed) && (isTimeoutStatus(status) || status === 502 || status === 503))
  ) {
    return proxyOrTimeoutMessage(status);
  }
  if (looksLikeHtml(trimmed)) {
    return `Прокси или шлюз вернул страницу ошибки${status ? ` (HTTP ${status})` : ""}. Повторите попытку; если сообщение повторяется, проверьте сеть.`;
  }
  if (trimmed) {
    const asCode = ERROR_CODE_TEXT[trimmed];
    if (asCode) return asCode;
    return trimmed.length > MAX_RAW_ERROR ? `${trimmed.slice(0, MAX_RAW_ERROR)}…` : trimmed;
  }
  return status ? `Ошибка запроса (HTTP ${status})` : "Ошибка запроса";
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (err: unknown) {
    throw new Error(humanizeFetchFailure(err));
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(formatApiErrorBody(text, res.status));
  if (!text) return { ok: true } as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(formatApiErrorBody(text, res.status));
  }
}

function formatZodIssuesMessage(issues: unknown[]): string {
  const fields = new Set<string>();
  let rows = 0;
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const path = (issue as { path?: unknown }).path;
    if (!Array.isArray(path) || path[0] !== "rows") continue;
    if (typeof path[1] === "number") rows += 1;
    if (typeof path[2] === "string") fields.add(path[2]);
  }
  if (fields.size === 0) {
    return "Файл имеет неверный формат. Проверьте шапку и обязательные колонки.";
  }
  return [
    "Файл не подходит для импорта событий.",
    `Проблемные колонки: ${[...fields].join(", ")}.`,
    rows > 0 ? `Затронуто строк: ${Math.ceil(rows / Math.max(fields.size, 1))}.` : "",
    "Ожидаются колонки Aircraft, Event_name, startAt, endAt."
  ]
    .filter(Boolean)
    .join(" ");
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path, {
    headers: withSandboxHeader({ Accept: "application/json" }),
    credentials: "include"
  });
  return readJson<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: withSandboxHeader({
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Actor": "browser"
    }),
    credentials: "include",
    body: JSON.stringify(body)
  });
  return readJson<T>(res);
}

export async function apiPostBlob(path: string, body: unknown): Promise<Blob> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: withSandboxHeader({
      "Content-Type": "application/json",
      Accept: "application/octet-stream",
      "X-Actor": "browser"
    }),
    credentials: "include",
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(formatApiErrorBody(await res.text(), res.status));
  return await res.blob();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PATCH",
    headers: withSandboxHeader({
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Actor": "browser"
    }),
    credentials: "include",
    body: JSON.stringify(body)
  });
  return readJson<T>(res);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PUT",
    headers: withSandboxHeader({
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Actor": "browser"
    }),
    credentials: "include",
    body: JSON.stringify(body)
  });
  return readJson<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await apiFetch(path, {
    method: "DELETE",
    headers: withSandboxHeader({ Accept: "application/json" }),
    credentials: "include"
  });
  return readJson<T>(res);
}
