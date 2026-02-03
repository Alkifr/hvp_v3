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

export async function authLogin(email: string, password: string): Promise<{ ok: boolean; mustChangePassword?: boolean; error?: string }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = (await res.json()) as any;
  if (!res.ok) return { ok: false, error: data?.error ?? "LOGIN_FAILED" };
  return data;
}

export async function authLogout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function authChangePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/auth/change-password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ oldPassword, newPassword })
  });
  const data = (await res.json()) as any;
  if (!res.ok) return { ok: false, error: data?.error ?? "CHANGE_PASSWORD_FAILED" };
  return data;
}

