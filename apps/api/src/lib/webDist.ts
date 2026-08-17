import fs from "node:fs";
import path from "node:path";

export function resolveWebDist(cwd = process.cwd(), envDist = process.env.WEB_DIST): string | null {
  const fromEnv = String(envDist ?? "").trim();
  const candidates = [
    fromEnv,
    path.resolve(cwd, "../web/dist"),
    path.resolve(cwd, "apps/web/dist"),
    path.resolve(cwd, "../../apps/web/dist")
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}
