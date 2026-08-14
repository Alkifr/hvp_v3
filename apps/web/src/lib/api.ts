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

function formatApiErrorBody(text: string, status?: number): string {
  const trimmed = String(text ?? "").trim();
  if (trimmed) {
    try {
      const j = JSON.parse(trimmed);
      if (j?.error === "DB_NOT_CONNECTED") {
        return `Нет соединения с БД (проверьте DATABASE_CLOUD_URL). ${j?.detail ?? ""}`.trim();
      }
      if (j?.error === "SANDBOX_NOT_FOUND") return "Песочница не найдена";
      if (j?.error === "SANDBOX_ACCESS_DENIED") return "Нет доступа к песочнице";
      if (j?.error === "SANDBOX_READ_ONLY") return "Нет прав на запись в песочнице";
      if (j?.error === "FORBIDDEN") return "Недостаточно прав для выполнения операции";
      if (j?.message) {
        const msg = String(j.message);
        // Иногда Fastify/Zod отдаёт message как JSON-массив issues
        if (msg.trim().startsWith("[")) {
          try {
            const issues = JSON.parse(msg);
            if (Array.isArray(issues)) return formatZodIssuesMessage(issues);
          } catch {
            /* keep original */
          }
        }
        return msg;
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
