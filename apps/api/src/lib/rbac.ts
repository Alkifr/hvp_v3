import type { FastifyRequest } from "fastify";

export function requirePermission(req: FastifyRequest, permission: string) {
  const u = (req as any).auth as { permissions?: string[] } | undefined;
  if (!u) return false;
  return (u.permissions ?? []).includes(permission);
}

export function assertPermission(req: FastifyRequest, permission: string) {
  if (!requirePermission(req, permission)) {
    const err: any = new Error("FORBIDDEN");
    err.statusCode = 403;
    throw err;
  }
}

