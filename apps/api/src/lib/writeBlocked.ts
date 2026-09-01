import { hasPermission } from "./permissionCatalog.js";

export const RUNTIME_CONFIG_ID = "default";

export async function getRuntimeConfig(prisma: {
  appRuntimeConfig: {
    upsert: (args: never) => Promise<{ writeBlocked: boolean; updatedAt: Date }>;
  };
}): Promise<{ writeBlocked: boolean; updatedAt: Date }> {
  return prisma.appRuntimeConfig.upsert({
    where: { id: RUNTIME_CONFIG_ID },
    create: { id: RUNTIME_CONFIG_ID },
    update: {}
  } as never);
}

export function isMutatingHttpMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

/** Запросы, которые админ и служебные ping могут делать при техрежиме. */
export function isWriteBlockedExempt(url: string, permissions: readonly string[]): boolean {
  const path = (url.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  if (path.startsWith("/api/auth")) return true;
  if (path.startsWith("/api/presence")) return true;
  if (path.startsWith("/api/admin")) {
    return (
      hasPermission(permissions, "admin:users") ||
      hasPermission(permissions, "admin:roles") ||
      hasPermission(permissions, "admin:mail") ||
      hasPermission(permissions, "admin:cleanup")
    );
  }
  return false;
}
