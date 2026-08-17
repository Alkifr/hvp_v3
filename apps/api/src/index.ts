import dotenv from "dotenv";
import path from "node:path";

import { assertBootEnv } from "./lib/bootEnv.js";
import { buildServer } from "./server.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
const boot = assertBootEnv();

// Dev: Vite занимает :3000, API — :3001. Стенд (NODE_ENV=production): всё на :3000.
const port = Number(process.env.PORT ?? (boot.nodeEnv === "production" ? 3000 : 3001));
const host = process.env.HOST ?? "0.0.0.0";

const server = await buildServer();

await server.listen({ port, host });

server.log.info({ port, host, nodeEnv: boot.nodeEnv }, "API started");
