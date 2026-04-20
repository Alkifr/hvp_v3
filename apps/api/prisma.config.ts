import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: fileURLToPath(new URL("../../.env", import.meta.url))
});

export default defineConfig({
  schema: "prisma/schema.prisma"
});

