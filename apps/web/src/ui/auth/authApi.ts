export type MeResponse =
  | {
      ok: true;
      user: {
        id: string;
        email: string;
        displayName?: string | null;
        roles: string[];
        permissions: string[];
        mustChangePassword: boolean;
      };
    }
  | { ok: false; error: string };

export async function authMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  return (await res.json()) as MeResponse;
}

export type AuthLoginResponse = { ok: true; mustChangePassword: boolean } | { ok: false; error: string; message: string };
export type AuthActionResponse = { ok: true } | { ok: false; error: string; message: string };

function authErrorMessage(error: string): string {
  if (error === "INVALID_CREDENTIALS") return "Неверный email или пароль";
  if (error === "UNAUTHORIZED") return "Требуется авторизация";
  if (error === "OLD_PASSWORD_INVALID") return "Текущий пароль указан неверно";
  if (error === "CHANGE_PASSWORD_FAILED") return "Не удалось сменить пароль";
  return error || "Ошибка авторизации";
}

export async function authLogin(email: string, password: string): Promise<AuthLoginResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = (await res.json()) as any;
  if (!res.ok) {
    const error = data?.error ?? "LOGIN_FAILED";
    return { ok: false, error, message: authErrorMessage(error) };
  }
  return { ok: true, mustChangePassword: Boolean(data?.mustChangePassword) };
}

export async function authLogout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function authChangePassword(oldPassword: string, newPassword: string): Promise<AuthActionResponse> {
  const res = await fetch("/api/auth/change-password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ oldPassword, newPassword })
  });
  const data = (await res.json()) as any;
  if (!res.ok) {
    const error = data?.error ?? "CHANGE_PASSWORD_FAILED";
    return { ok: false, error, message: authErrorMessage(error) };
  }
  return { ok: true };
}

export type MyActivityItem = {
  id: string;
  action: "CREATE" | "UPDATE" | "RESERVE" | "UNRESERVE";
  reason: string | null;
  changes: any;
  createdAt: string;
  eventId: string;
  event: {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    tailNumber: string | null;
  } | null;
};

export type MyActivityResponse = {
  ok: true;
  total: number;
  limit: number;
  offset: number;
  byAction: Record<"CREATE" | "UPDATE" | "RESERVE" | "UNRESERVE", number>;
  items: MyActivityItem[];
};

export async function authMyActivity(params: {
  limit?: number;
  offset?: number;
  action?: "CREATE" | "UPDATE" | "RESERVE" | "UNRESERVE";
  q?: string;
} = {}): Promise<MyActivityResponse> {
  const u = new URLSearchParams();
  if (params.limit != null) u.set("limit", String(params.limit));
  if (params.offset != null) u.set("offset", String(params.offset));
  if (params.action) u.set("action", params.action);
  if (params.q) u.set("q", params.q);
  const res = await fetch(`/api/auth/me/activity?${u.toString()}`, { credentials: "include" });
  if (!res.ok) {
    return {
      ok: true,
      total: 0,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
      byAction: { CREATE: 0, UPDATE: 0, RESERVE: 0, UNRESERVE: 0 },
      items: []
    };
  }
  return (await res.json()) as MyActivityResponse;
}

