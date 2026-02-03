import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zDateTime, zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

export const personsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "workforce:read");
    return await app.prisma.person.findMany({
      include: { skills: { include: { skill: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "workforce:write");
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).optional(),
        name: z.string().trim().min(1).max(200),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.person.create({ data: body });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "workforce:write");
    const id = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        code: z.string().trim().min(1).max(32).nullable().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        isActive: z.boolean().optional()
      })
      .parse(req.body);
    return await app.prisma.person.update({ where: { id }, data: body });
  });

  // Перезаписать набор квалификаций сотрудника
  app.put("/:id/skills", async (req) => {
    assertPermission(req as any, "workforce:write");
    const personId = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        skills: z
          .array(
            z.object({
              skillId: zUuid,
              level: z.number().int().min(1).max(10).optional(),
              validFrom: zDateTime.optional(),
              validTo: zDateTime.optional()
            })
          )
          .default([])
      })
      .parse(req.body);

    await app.prisma.personSkill.deleteMany({ where: { personId } });
    await Promise.all(
      body.skills.map((s) =>
        app.prisma.personSkill.create({
          data: {
            personId,
            skillId: s.skillId,
            level: s.level,
            validFrom: s.validFrom ? new Date(s.validFrom) : undefined,
            validTo: s.validTo ? new Date(s.validTo) : undefined
          }
        })
      )
    );

    return await app.prisma.person.findUniqueOrThrow({
      where: { id: personId },
      include: { skills: { include: { skill: true } } }
    });
  });

  // Добавить период недоступности (MVP)
  app.post("/:id/unavailability", async (req) => {
    assertPermission(req as any, "workforce:write");
    const personId = zUuid.parse((req.params as any).id);
    const body = z
      .object({
        startAt: zDateTime,
        endAt: zDateTime,
        reason: z.string().trim().min(1).max(300).optional()
      })
      .refine((v) => new Date(v.endAt) > new Date(v.startAt), { message: "endAt must be after startAt" })
      .parse(req.body);

    return await app.prisma.personUnavailability.create({
      data: { personId, startAt: new Date(body.startAt), endAt: new Date(body.endAt), reason: body.reason }
    });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "workforce:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.person.delete({ where: { id } });
    return { ok: true };
  });
};

