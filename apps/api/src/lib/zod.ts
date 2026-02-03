import { z } from "zod";

export const zUuid = z.string().uuid();

export const zDateTime = z
  .union([z.string().datetime({ offset: true }), z.string().datetime()])
  .transform((s) => new Date(s));

