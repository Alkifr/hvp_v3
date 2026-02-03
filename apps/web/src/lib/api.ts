async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (j?.error === "DB_NOT_CONNECTED") {
      return `Нет соединения с БД (проверьте DATABASE_URL). ${j?.detail ?? ""}`.trim();
    }
    if (j?.message) return String(j.message);
    return text;
  } catch {
    return text;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" }, credentials: "include" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Actor": "browser" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Actor": "browser" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Actor": "browser" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { Accept: "application/json" },
    credentials: "include"
  });
  if (!res.ok) throw new Error(await readError(res));
  // некоторые DELETE возвращают пустое тело
  const text = await res.text();
  if (!text) return { ok: true } as T;
  return JSON.parse(text) as T;
}

