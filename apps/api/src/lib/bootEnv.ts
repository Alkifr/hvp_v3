const WEAK_JWT = new Set(["", "change_me_dev_secret", "dev_insecure_jwt_secret_change_me"]);

export function parseCorsOrigins(raw: string | undefined, nodeEnv: string): boolean | string[] {
  const items = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length > 0) return items;
  // Dev: Vite на другом порту. Prod без списка — только same-origin (nginx).
  if (nodeEnv === "production") return false;
  return true;
}

export function resolveJwtSecret(secret: string | undefined, nodeEnv: string): string {
  const jwt = String(secret ?? "").trim();
  if (nodeEnv === "production") {
    if (WEAK_JWT.has(jwt) || jwt.length < 24) {
      throw new Error("JWT_SECRET must be set to a strong value in production (min 24 characters)");
    }
    return jwt;
  }
  return jwt || "dev_insecure_jwt_secret_change_me";
}

export function assertBootEnv(env: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = String(env.NODE_ENV ?? "development").trim() || "development";
  const databaseUrl = String(env.DATABASE_CLOUD_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_CLOUD_URL is required");
  }
  return {
    nodeEnv,
    isProd: nodeEnv === "production",
    jwtSecret: resolveJwtSecret(env.JWT_SECRET, nodeEnv),
    corsOrigin: parseCorsOrigins(env.CORS_ORIGINS, nodeEnv)
  };
}
