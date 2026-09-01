import type { FastifyRequest } from "fastify";

import { hasPermission } from "./permissionCatalog.js";

export function requirePermission(req: FastifyRequest, permission: string) {
  const u = (req as any).auth as { permissions?: string[] } | undefined;
  if (!u) return false;
  return hasPermission(u.permissions ?? [], permission);
}

export function assertPermission(req: FastifyRequest, permission: string) {
  if (!requirePermission(req, permission)) {
    const err: any = new Error("FORBIDDEN");
    err.statusCode = 403;
    throw err;
  }
}

export function assertAnyPermission(req: FastifyRequest, permissions: string[]) {
  if (!permissions.some((p) => requirePermission(req, p))) {
    const err: any = new Error("FORBIDDEN");
    err.statusCode = 403;
    throw err;
  }
}

/** Системный администратор: видит все песочницы (как наблюдатель), без прав владельца. */
export function isSystemAdmin(roles: string[] | null | undefined): boolean {
  const list = roles ?? [];
  return list.includes("ADMIN") || list.includes("SUPER_ADMIN");
}

export function assertSystemAdmin(req: FastifyRequest) {
  const roles = (req as any).auth?.roles as string[] | undefined;
  if (!isSystemAdmin(roles)) {
    const err: any = new Error("FORBIDDEN");
    err.statusCode = 403;
    throw err;
  }
}

