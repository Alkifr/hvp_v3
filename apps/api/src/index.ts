import dotenv from "dotenv";
import path from "node:path";

import { buildServer } from "./server.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const server = await buildServer();

await server.listen({ port, host });

server.log.info({ port, host }, "API started");
