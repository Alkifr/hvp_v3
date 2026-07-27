import { z } from "zod";

export const zUuid = z.string().uuid();

export const zDateTime = z
  .union([z.string().datetime({ offset: true }), z.string().datetime()])
  .transform((s) => new Date(s));

/** Дата без времени: `YYYY-MM-DD` или ISO datetime → UTC midnight / instant. */
export const zDateOnly = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.string().datetime({ offset: true }),
    z.string().datetime()
  ])
  .transform((s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(s)));

