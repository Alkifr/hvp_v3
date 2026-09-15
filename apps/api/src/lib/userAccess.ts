import { applyPermissionOverrides } from "./permissionCatalog.js";

export const USER_ACCESS_INCLUDE = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  permissionOverrides: { include: { permission: true } }
} as const;

type RoleJoin = { role: { permissions: Array<{ permission: { code: string } }> } };
type OverrideJoin = { effect: "GRANT" | "DENY"; permission: { code: string } };

export function effectivePermissionCodes(user: {
  roles: RoleJoin[];
  permissionOverrides?: OverrideJoin[];
}): string[] {
  const roleCodes = user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code));
  const overrides = (user.permissionOverrides ?? []).map((row) => ({
    code: row.permission.code,
    effect: row.effect
  }));
  return applyPermissionOverrides(roleCodes, overrides);
}
