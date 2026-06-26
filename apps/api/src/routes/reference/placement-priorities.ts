import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { zUuid } from "../../lib/zod.js";
import { assertPermission } from "../../lib/rbac.js";

const zRuleBody = z.object({
  hangarId: zUuid,
  layoutId: zUuid,
  standId: zUuid,
  priorityScore: z.number().int().min(-100000).max(100000).optional(),
  sourceEventName: z.string().trim().max(300).nullable().optional(),
  sourceAircraftTypeText: z.string().trim().max(300).nullable().optional(),
  conditionText: z.string().trim().max(1000).nullable().optional(),
  comment: z.string().trim().max(1000).nullable().optional(),
  source: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  eventTypeIds: z.array(zUuid).optional().default([]),
  aircraftTypeIds: z.array(zUuid).optional().default([])
});

const priorityRuleInclude = {
  hangar: { select: { id: true, code: true, name: true } },
  layout: { select: { id: true, code: true, name: true, description: true } },
  stand: { select: { id: true, code: true, name: true } },
  eventTypes: {
    include: { eventType: { select: { id: true, code: true, name: true } } },
    orderBy: { eventType: { name: "asc" as const } }
  },
  aircraftTypes: {
    include: { aircraftType: { select: { id: true, icaoType: true, name: true } } },
    orderBy: { aircraftType: { name: "asc" as const } }
  }
};

type ImportRow = Record<string, unknown>;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function pick(row: ImportRow, keys: string[]): string {
  const normalized = new Map(Object.entries(row).map(([k, v]) => [normalize(k), v]));
  for (const key of keys) {
    const value = normalized.get(normalize(key));
    if (value != null && text(value) !== "") return text(value);
  }
  return "";
}

function normalize(v: unknown): string {
  return text(v)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[а]/g, "a")
    .replace(/[с]/g, "c")
    .replace(/[х]/g, "x")
    .replace(/[у]/g, "y")
    .replace(/[в]/g, "b")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

function naturalNumber(v: string): string {
  return text(v).match(/\d+/)?.[0] ?? "";
}

function normalizeStandCode(v: string): string {
  const raw = text(v).toUpperCase().replace(/[МM][СC][- ]?/i, "MC-");
  const n = raw.match(/\d+/)?.[0];
  if (!n) return raw;
  if (/^MC-/i.test(raw)) return `MC-${Number(n)}`;
  return `MC-${Number(n)}`;
}

function eventAliases(source: string): string[] {
  const result = new Set<string>();
  for (const part of source.split(/[/,;+]/)) {
    const n = normalize(part);
    if (!n) continue;
    result.add(n);
    if (n === "ach" || n === "acheck" || n === "a") result.add("acheck");
    if (n === "cch" || n === "ccheck" || n === "c") result.add("ccheck");
    if (n === "add") result.add("add");
    if (n === "aog") result.add("aog");
  }
  return Array.from(result);
}

function aircraftTokens(source: string): string[] {
  const raw = text(source).toUpperCase();
  const found = new Set<string>();
  const patterns = [
    /A\s*3(?:18|19|20|21|30|50)/g,
    /B?\s*7(?:31|32|33|34|35|36|37|38|39|57|67|77|87)/g,
    /(?:RRJ|SSJ|SU)\s*100/g,
    /(?:E|EMB)\s*1(?:70|75|90|95)/g
  ];
  for (const re of patterns) {
    for (const match of raw.matchAll(re)) {
      found.add(match[0].replace(/\s+/g, "").replace(/^B(?=7)/, ""));
    }
  }
  if (/A320\/321/.test(raw)) {
    found.add("A320");
    found.add("A321");
  }
  if (/A320\/321\/737/.test(raw)) {
    found.add("A320");
    found.add("A321");
    found.add("737");
  }
  if (/737/.test(raw)) found.add("737");
  if (/RRJ|SSJ|SU\s*100/.test(raw)) found.add("RRJ100");
  return Array.from(found);
}

function aircraftMatchesToken(aircraftType: { icaoType: string | null; name: string }, token: string): boolean {
  const haystack = normalize(`${aircraftType.icaoType ?? ""} ${aircraftType.name}`);
  const normalizedToken = normalize(token.replace(/^7/, "B7"));
  const alternatives = new Set([normalize(token), normalizedToken]);
  if (/^7\d+/.test(token)) alternatives.add(normalize(`B${token}`));
  if (token === "RRJ100") {
    alternatives.add("rrj100");
    alternatives.add("ssj100");
    alternatives.add("su100");
  }
  return Array.from(alternatives).some((alias) => alias && haystack.includes(alias));
}

function eventTypeMatchesAlias(eventType: { code: string; name: string }, alias: string): boolean {
  const haystack = normalize(`${eventType.code} ${eventType.name}`);
  if (alias === "acheck") return haystack.includes("acheck") || haystack.includes("ach") || haystack === "a";
  if (alias === "ccheck") return haystack.includes("ccheck") || haystack.includes("cch") || haystack === "c";
  return haystack.includes(alias);
}

export const placementPrioritiesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    assertPermission(req as any, "ref:read");
    const hangarId = zUuid.optional().parse((req.query as any)?.hangarId);
    const layoutId = zUuid.optional().parse((req.query as any)?.layoutId);
    const standId = zUuid.optional().parse((req.query as any)?.standId);
    const activeOnly = ["1", "true", "yes"].includes(String((req.query as any)?.activeOnly ?? "").toLowerCase());
    return await app.prisma.placementPriorityRule.findMany({
      where: {
        ...(hangarId ? { hangarId } : {}),
        ...(layoutId ? { layoutId } : {}),
        ...(standId ? { standId } : {}),
        ...(activeOnly ? { isActive: true } : {})
      },
      include: priorityRuleInclude,
      orderBy: [{ isActive: "desc" }, { priorityScore: "desc" }, { updatedAt: "desc" }]
    });
  });

  app.post("/", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = zRuleBody.parse(req.body);
    const { eventTypeIds, aircraftTypeIds, ...data } = body;
    return await app.prisma.$transaction(async (tx: any) => {
      const rule = await tx.placementPriorityRule.create({ data });
      if (eventTypeIds.length > 0) {
        await tx.placementPriorityRuleEventType.createMany({
          data: eventTypeIds.map((eventTypeId) => ({ ruleId: rule.id, eventTypeId })),
          skipDuplicates: true
        });
      }
      if (aircraftTypeIds.length > 0) {
        await tx.placementPriorityRuleAircraftType.createMany({
          data: aircraftTypeIds.map((aircraftTypeId) => ({ ruleId: rule.id, aircraftTypeId })),
          skipDuplicates: true
        });
      }
      return await tx.placementPriorityRule.findUniqueOrThrow({ where: { id: rule.id }, include: priorityRuleInclude });
    });
  });

  app.patch("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    const body = zRuleBody.partial().parse(req.body);
    const { eventTypeIds, aircraftTypeIds, ...data } = body;
    return await app.prisma.$transaction(async (tx: any) => {
      await tx.placementPriorityRule.update({ where: { id }, data });
      if (eventTypeIds) {
        await tx.placementPriorityRuleEventType.deleteMany({ where: { ruleId: id } });
        if (eventTypeIds.length > 0) {
          await tx.placementPriorityRuleEventType.createMany({
            data: eventTypeIds.map((eventTypeId) => ({ ruleId: id, eventTypeId })),
            skipDuplicates: true
          });
        }
      }
      if (aircraftTypeIds) {
        await tx.placementPriorityRuleAircraftType.deleteMany({ where: { ruleId: id } });
        if (aircraftTypeIds.length > 0) {
          await tx.placementPriorityRuleAircraftType.createMany({
            data: aircraftTypeIds.map((aircraftTypeId) => ({ ruleId: id, aircraftTypeId })),
            skipDuplicates: true
          });
        }
      }
      return await tx.placementPriorityRule.findUniqueOrThrow({ where: { id }, include: priorityRuleInclude });
    });
  });

  app.delete("/:id", async (req) => {
    assertPermission(req as any, "ref:write");
    const id = zUuid.parse((req.params as any).id);
    await app.prisma.placementPriorityRule.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/import", async (req) => {
    assertPermission(req as any, "ref:write");
    const body = z
      .object({
        rows: z.array(z.record(z.string(), z.unknown())).min(1),
        replace: z.boolean().optional().default(false),
        source: z.string().trim().max(200).optional().default("Список_приоритетов_в_ангарах")
      })
      .parse(req.body);

    const [hangars, layouts, eventTypes, aircraftTypes] = await Promise.all([
      app.prisma.hangar.findMany({ include: { layouts: true } }),
      app.prisma.hangarLayout.findMany({ include: { stands: true, hangar: true } }),
      app.prisma.eventType.findMany(),
      app.prisma.aircraftType.findMany()
    ]);
    const layoutsByHangar = new Map<string, typeof layouts>();
    for (const layout of layouts) {
      const list = layoutsByHangar.get(layout.hangarId) ?? [];
      list.push(layout);
      layoutsByHangar.set(layout.hangarId, list);
    }

    const warnings: string[] = [];
    const prepared: Array<{
      rowNumber: number;
      hangarId: string;
      layoutId: string;
      standId: string;
      eventTypeIds: string[];
      aircraftTypeIds: string[];
      sourceEventName: string | null;
      sourceAircraftTypeText: string | null;
      conditionText: string | null;
      comment: string | null;
      source: string;
    }> = [];

    const rowsByHangarVariant = new Map<string, Set<string>>();
    body.rows.forEach((row) => {
      const hangarText = pick(row, ["Номер ангара", "Ангар", "hangar", "hangarCode"]);
      const variantText = pick(row, ["Вариант расстановки", "Вариант", "Схема", "layout", "layoutCode"]);
      const standText = pick(row, ["Номер стоянки", "Стоянка", "Место", "stand", "standCode"]);
      const key = `${normalize(hangarText)}::${normalize(variantText)}`;
      if (!rowsByHangarVariant.has(key)) rowsByHangarVariant.set(key, new Set());
      if (standText) rowsByHangarVariant.get(key)!.add(normalizeStandCode(standText));
    });

    for (const [idx, row] of body.rows.entries()) {
      const rowNumber = idx + 2;
      const hangarText = pick(row, ["Номер ангара", "Ангар", "hangar", "hangarCode"]);
      const variantText = pick(row, ["Вариант расстановки", "Вариант", "Схема", "layout", "layoutCode"]);
      const standText = pick(row, ["Номер стоянки", "Стоянка", "Место", "stand", "standCode"]);
      const eventText = pick(row, ["Наименование события", "Событие", "Тип события", "eventType", "event"]);
      const aircraftText = pick(row, ["Тип ВС", "Тип воздушного судна", "ВС", "aircraftType"]);
      const comment = pick(row, ["Комментарий", "comment", "notes"]) || null;
      if (!hangarText || !variantText || !standText) {
        warnings.push(`Строка ${rowNumber}: пропущена, не заполнены ангар/вариант/место`);
        continue;
      }

      const hangarNo = naturalNumber(hangarText);
      const hangar = hangars.find((h) => {
        const hText = normalize(`${h.code} ${h.name}`);
        return normalize(hangarText) === normalize(h.code) || normalize(hangarText) === normalize(h.name) || (hangarNo && hText.includes(hangarNo));
      });
      if (!hangar) {
        warnings.push(`Строка ${rowNumber}: не найден ангар "${hangarText}"`);
        continue;
      }

      const groupKey = `${normalize(hangarText)}::${normalize(variantText)}`;
      const groupStandCodes = rowsByHangarVariant.get(groupKey) ?? new Set<string>();
      const hangarLayouts = layoutsByHangar.get(hangar.id) ?? [];
      const variantNorm = normalize(variantText);
      const layout =
        hangarLayouts.find((l) => normalize(`${l.code} ${l.name} ${l.description ?? ""}`).includes(variantNorm)) ??
        hangarLayouts.find((l) => {
          if (groupStandCodes.size === 0) return false;
          const codes = new Set(l.stands.map((s) => normalizeStandCode(s.code)));
          return Array.from(groupStandCodes).every((code) => codes.has(code));
        }) ??
        (hangarLayouts.filter((l) => l.isActive).length === 1 ? hangarLayouts.filter((l) => l.isActive)[0] : null);
      if (!layout) {
        warnings.push(`Строка ${rowNumber}: не найден вариант "${variantText}" для ангара "${hangarText}"`);
        continue;
      }

      const standCode = normalizeStandCode(standText);
      const stand = layout.stands.find((s) => normalizeStandCode(s.code) === standCode || normalizeStandCode(s.name) === standCode);
      if (!stand) {
        warnings.push(`Строка ${rowNumber}: не найдено место "${standText}" в варианте "${layout.name}"`);
        continue;
      }

      const eventTypeIds = eventAliases(eventText)
        .flatMap((alias) => eventTypes.filter((eventType) => eventTypeMatchesAlias(eventType, alias)).map((eventType) => eventType.id))
        .filter((id, pos, arr) => arr.indexOf(id) === pos);
      if (eventText && eventTypeIds.length === 0) warnings.push(`Строка ${rowNumber}: не найдены типы событий для "${eventText}"`);

      const aircraftTypeIds = aircraftTokens(aircraftText)
        .flatMap((token) => aircraftTypes.filter((aircraftType) => aircraftMatchesToken(aircraftType, token)).map((aircraftType) => aircraftType.id))
        .filter((id, pos, arr) => arr.indexOf(id) === pos);
      if (aircraftText && aircraftTypeIds.length === 0) warnings.push(`Строка ${rowNumber}: не найдены типы ВС для "${aircraftText}"`);

      prepared.push({
        rowNumber,
        hangarId: hangar.id,
        layoutId: layout.id,
        standId: stand.id,
        eventTypeIds,
        aircraftTypeIds,
        sourceEventName: eventText || null,
        sourceAircraftTypeText: aircraftText || null,
        conditionText: [eventText, aircraftText].filter(Boolean).join(" / ") || null,
        comment,
        source: body.source
      });
    }

    const result = await app.prisma.$transaction(async (tx: any) => {
      if (body.replace) await tx.placementPriorityRule.deleteMany({ where: { source: body.source } });
      for (const item of prepared) {
        const rule = await tx.placementPriorityRule.create({
          data: {
            hangarId: item.hangarId,
            layoutId: item.layoutId,
            standId: item.standId,
            priorityScore: 500,
            sourceEventName: item.sourceEventName,
            sourceAircraftTypeText: item.sourceAircraftTypeText,
            conditionText: item.conditionText,
            comment: item.comment,
            source: item.source,
            isActive: true
          }
        });
        if (item.eventTypeIds.length > 0) {
          await tx.placementPriorityRuleEventType.createMany({
            data: item.eventTypeIds.map((eventTypeId) => ({ ruleId: rule.id, eventTypeId })),
            skipDuplicates: true
          });
        }
        if (item.aircraftTypeIds.length > 0) {
          await tx.placementPriorityRuleAircraftType.createMany({
            data: item.aircraftTypeIds.map((aircraftTypeId) => ({ ruleId: rule.id, aircraftTypeId })),
            skipDuplicates: true
          });
        }
      }
      return { imported: prepared.length };
    });

    return { ok: true, ...result, warnings };
  });
};
