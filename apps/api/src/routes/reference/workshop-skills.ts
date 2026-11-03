import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { qualificationsForWorkshopSkills } from "../../lib/personnelPlanning.js";
import { assertAnyPermission } from "../../lib/rbac.js";
import { zUuid } from "../../lib/zod.js";

async function qualificationCodes(prisma: any, skillCodes: string[]) {
  if (!skillCodes.length) return [];
  const rows = await prisma.personnelCategory.findMany({
    where: { isActive: true },
    select: { code: true, department: true, isAuthorized: true, sortOrder: true }
  });
  return qualificationsForWorkshopSkills(rows, skillCodes).map((row) => row.code);
}

export const workshopSkillsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertAnyPermission(req, ["ref:read", "personnel:read"]);
    const links = await app.prisma.workshopSkill.findMany({
      include: {
        workshop: { select: { id: true, code: true, name: true } },
        skill: { select: { id: true, code: true, name: true, isActive: true } }
      },
      orderBy: [{ workshop: { code: "asc" } }, { skill: { code: "asc" } }]
    });
    const byWorkshop = new Map<string, {
      workshopId: string;
      workshop: { id: string; code: string; name: string };
      skills: Array<{ id: string; code: string; name: string }>;
    }>();
    for (const link of links) {
      const row = byWorkshop.get(link.workshopId) ?? {
        workshopId: link.workshopId,
        workshop: link.workshop,
        skills: []
      };
      row.skills.push({ id: link.skill.id, code: link.skill.code, name: link.skill.name });
      byWorkshop.set(link.workshopId, row);
    }
    return [...byWorkshop.values()];
  });

  app.put("/:workshopId", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const workshopId = zUuid.parse((req.params as { workshopId?: string }).workshopId);
    const body = z.object({ skillIds: z.array(zUuid).max(40) }).parse(req.body);
    const skillIds = [...new Set(body.skillIds)];
    const [workshop, skills, existing] = await Promise.all([
      app.prisma.workshop.findUnique({ where: { id: workshopId }, select: { id: true, code: true, name: true } }),
      app.prisma.skill.findMany({ where: { id: { in: skillIds }, isActive: true }, select: { id: true, code: true, name: true } }),
      app.prisma.workshopSkill.findMany({ where: { workshopId }, select: { skillId: true, skill: { select: { code: true } } } })
    ]);
    if (!workshop) throw app.httpErrors.notFound("Цех не найден");
    if (skills.length !== skillIds.length) throw app.httpErrors.badRequest("Выберите квалификации из справочника");
    const desired = new Set(skillIds);
    const removed = existing.filter((row) => !desired.has(row.skillId));
    if (removed.length) {
      const kept = new Set(await qualificationCodes(app.prisma, skills.map((row) => row.code)));
      const dropped = (await qualificationCodes(app.prisma, removed.map((row) => row.skill.code))).filter((code) => !kept.has(code));
      const used = await app.prisma.personnelAvailability.findFirst({
        where: {
          workshopId,
          OR: [
            { skillId: { in: removed.map((row) => row.skillId) } },
            ...(dropped.length ? [{ categoryCode: { in: dropped as never } }] : [])
          ]
        },
        select: { id: true }
      });
      if (used) throw app.httpErrors.conflict("Нельзя убрать квалификацию, по которой уже внесён ресурс");
    }
    await app.prisma.$transaction(async (tx) => {
      await tx.workshopSkill.deleteMany({ where: { workshopId } });
      if (skillIds.length) {
        await tx.workshopSkill.createMany({ data: skillIds.map((skillId) => ({ workshopId, skillId })) });
      }
    }, { timeout: 30_000, maxWait: 10_000 });
    return {
      workshopId,
      workshop,
      skills: skills.sort((a, b) => a.code.localeCompare(b.code))
    };
  });

  app.delete("/:workshopId", async (req) => {
    assertAnyPermission(req, ["ref:write", "personnel:write"]);
    const workshopId = zUuid.parse((req.params as { workshopId?: string }).workshopId);
    const links = await app.prisma.workshopSkill.findMany({
      where: { workshopId },
      select: { skill: { select: { code: true } } }
    });
    const categories = await qualificationCodes(app.prisma, links.map((row) => row.skill.code));
    const used = await app.prisma.personnelAvailability.findFirst({
      where: {
        workshopId,
        OR: [
          { skillId: { not: null } },
          ...(categories.length ? [{ categoryCode: { in: categories as never } }] : [])
        ]
      },
      select: { id: true }
    });
    if (used) throw app.httpErrors.conflict("Нельзя удалить связку, по которой уже внесён ресурс");
    await app.prisma.workshopSkill.deleteMany({ where: { workshopId } });
    return { ok: true };
  });
};
