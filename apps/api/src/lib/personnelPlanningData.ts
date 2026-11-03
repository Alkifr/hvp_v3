import {
  balanceColumns,
  calculatePersonnelWeek,
  PERSONNEL_DEPARTMENTS,
  qualificationsForWorkshopSkills,
  summarizeResourceSlices,
  weekDateKeys,
  type EffectiveValue,
  type PersonnelDepartment
} from "./personnelPlanning.js";

const LOCAL_OFFSET_MINUTES = 180;
const DAY_MS = 86_400_000;

function dateFromKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function numberOf(value: unknown) {
  return Number(value);
}

function virtualString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field ? field : null;
}

function aircraftTypeIdOf(event: any): string | null {
  return event.aircraft?.typeId ?? virtualString(event.virtualAircraft, "aircraftTypeId");
}

function comparable(value: unknown): string {
  return JSON.stringify(value);
}

export async function loadPersonnelWeekData(
  prisma: any,
  params: {
    workshopId: string;
    workshopIds?: string[];
    weekStart: string;
    dates?: string[];
    aircraftTypeIds?: string[];
    includeEventDemand?: boolean;
  }
) {
  const workshopIds = params.workshopIds?.length ? params.workshopIds : [params.workshopId];
  const dates = params.dates?.length ? params.dates : weekDateKeys(params.weekStart);
  const rangeStart = dateFromKey(dates[0]!);
  const rangeEnd = new Date(dateFromKey(dates[dates.length - 1]!).getTime() + DAY_MS);
  const instantStart = new Date(rangeStart.getTime() - LOCAL_OFFSET_MINUTES * 60_000);
  const instantEnd = new Date(rangeEnd.getTime() - LOCAL_OFFSET_MINUTES * 60_000);

  const [categories, mappings, workshopSkills] = await Promise.all([
    prisma.personnelCategory.findMany({ where: { isActive: true } }),
    prisma.personnelWorkshopCategory.findMany({
      where: { workshopId: { in: workshopIds }, isActive: true },
      include: { category: true },
      orderBy: { categoryCode: "asc" }
    }),
    prisma.workshopSkill.findMany({
      where: { workshopId: { in: workshopIds }, skill: { isActive: true } },
      include: { skill: true },
      orderBy: { skill: { code: "asc" } }
    })
  ]);
  const categoryByCode = new Map<string, any>(categories.map((row: any) => [row.code, row]));
  const catalogQualifications = categories.map((row: any) => ({
    code: row.code as string,
    department: (row.department ?? null) as string | null,
    isAuthorized: Boolean(row.isAuthorized),
    sortOrder: Number(row.sortOrder ?? 0),
    name: row.name as string
  }));
  const workshopsWithSkills = new Set((workshopSkills as any[]).map((link: any) => link.workshopId));
  const workshopSkillCodes = [
    ...new Set((workshopSkills as any[]).map((link: any) => String(link.skill.code)))
  ] as string[];
  const fromSkills = workshopSkillCodes.length
    ? qualificationsForWorkshopSkills(catalogQualifications, workshopSkillCodes).map((row) => ({
        workshopId: params.workshopId,
        categoryCode: row.code,
        skillId: null,
        department: row.department,
        sortOrder: row.sortOrder ?? 0,
        isActive: true,
        category: {
          code: row.code,
          name: row.name ?? row.code,
          department: row.department,
          isAuthorized: row.isAuthorized,
          sortOrder: row.sortOrder ?? 0
        }
      }))
    : [];
  const seenCategories = new Set(fromSkills.map((row) => row.categoryCode));
  const legacyCategories = mappings
    .filter((mapping: any) => !workshopsWithSkills.has(mapping.workshopId) && !seenCategories.has(mapping.categoryCode))
    .map((mapping: any) => {
      const category = categoryByCode.get(mapping.categoryCode) ?? mapping.category;
      const department = category?.department ?? mapping.department ?? null;
      return {
        workshopId: mapping.workshopId,
        categoryCode: mapping.categoryCode,
        skillId: null,
        department,
        isActive: mapping.isActive,
        category: category ? { ...category, department, isAuthorized: Boolean(category.isAuthorized) } : category
      };
    });
  const mappedCategories = [...fromSkills, ...legacyCategories];
  const columns = balanceColumns(
    mappedCategories.map((row: any) => ({
      code: String(row.categoryCode),
      department: (row.department ?? null) as string | null,
      sortOrder: Number(row.sortOrder ?? row.category?.sortOrder ?? 0)
    }))
  );
  const demandDepartments = columns.departments;
  const balanceLines = columns.lines;

  const [availability, norms, factors, rawEvents, assignedAircraft, statusRows] = await Promise.all([
    prisma.personnelAvailability.findMany({
      where: { workshopId: { in: workshopIds }, date: { gte: rangeStart, lt: rangeEnd } },
      include: { skill: { select: { id: true, code: true } } },
      orderBy: [{ date: "asc" }, { shiftId: "asc" }, { categoryCode: "asc" }]
    }),
    prisma.personnelHoursNorm.findMany({
      where: { effectiveFrom: { lt: rangeEnd } },
      orderBy: { effectiveFrom: "asc" }
    }),
    prisma.personnelAircraftTypeMpsFactor.findMany({
      where: { effectiveFrom: { lt: rangeEnd } },
      orderBy: [{ aircraftTypeId: "asc" }, { effectiveFrom: "asc" }]
    }),
    prisma.maintenanceEvent.findMany({
          where: {
            sandboxId: null,
            startAt: { lt: instantEnd },
            endAt: { gt: instantStart },
            status: { notIn: ["CANCELLED", "DELETED"] }
          },
          select: {
            id: true,
            title: true,
            status: true,
            planningKind: true,
            startAt: true,
            endAt: true,
            budgetStartAt: true,
            budgetEndAt: true,
            actualStartAt: true,
            actualEndAt: true,
            workshopId: true,
            aircraftId: true,
            hangarId: true,
            virtualAircraft: true,
            workshop: { select: { id: true, code: true, name: true } },
            aircraft: {
              select: {
                tailNumber: true,
                typeId: true,
                operator: { select: { id: true, code: true, name: true } },
                type: { select: { id: true, name: true, icaoType: true } }
              }
            },
            hangar: { select: { id: true, code: true, name: true } },
            eventType: { select: { id: true, code: true, name: true } },
            placements: {
              orderBy: [{ sortOrder: "asc" }, { startAt: "asc" }],
              select: {
                id: true,
                startAt: true,
                endAt: true,
                budgetStartAt: true,
                budgetEndAt: true,
                actualStartAt: true,
                actualEndAt: true,
                hangarId: true,
                layoutId: true,
                standId: true,
                sortOrder: true,
                hangar: { select: { id: true, code: true, name: true } },
                stand: { select: { id: true, code: true, name: true } }
              }
            },
            reportMetrics: {
              where: { block: "WP_PLAN_MPS", department: { in: [...PERSONNEL_DEPARTMENTS] } },
              select: { department: true, manHours: true }
            },
            towSegments: {
              orderBy: { startAt: "asc" },
              select: { id: true, startAt: true, endAt: true }
            }
          },
          orderBy: [{ startAt: "asc" }, { id: "asc" }]
        }),
    prisma.aircraft.findMany({
      where: { workshopAssignments: { some: { workshopId: { in: workshopIds } } } },
      distinct: ["typeId"],
      select: { typeId: true, type: { select: { id: true, name: true, icaoType: true } } }
    }),
    prisma.eventStatusCatalog.findMany({ select: { code: true, name: true } })
  ]);

  const virtualOperatorIds = Array.from(
    new Set(
      rawEvents
        .map((event: any) => virtualString(event.virtualAircraft, "operatorId"))
        .filter((id: string | null): id is string => Boolean(id))
    )
  );
  const virtualOperators = virtualOperatorIds.length
    ? await prisma.operator.findMany({
        where: { id: { in: virtualOperatorIds } },
        select: { id: true, code: true, name: true }
      })
    : [];
  const operatorById = new Map<string, any>(virtualOperators.map((row: any) => [row.id, row]));
  const statusByCode = new Map<string, string>(statusRows.map((row: any) => [row.code, row.name]));
  const selectedWorkshops = new Set(workshopIds);
  const events = rawEvents.flatMap((event: any) => {
    if (!selectedWorkshops.has(event.workshopId)) return [];
    const virtualOperatorId = virtualString(event.virtualAircraft, "operatorId");
    return [{
      ...event,
      aircraftLabel: event.aircraft?.tailNumber ?? virtualString(event.virtualAircraft, "label") ?? "—",
      statusLabel: statusByCode.get(event.status) ?? event.status,
      operator:
        event.aircraft?.operator ??
        (virtualOperatorId ? operatorById.get(virtualOperatorId) ?? null : null),
      aircraftType: event.aircraft?.type ?? {
        id: virtualString(event.virtualAircraft, "aircraftTypeId"),
        name: virtualString(event.virtualAircraft, "aircraftTypeName"),
        icaoType: virtualString(event.virtualAircraft, "aircraftTypeCode")
      },
      hangar: event.hangar ?? event.placements[0]?.hangar ?? null
    }];
  });

  const factorInput: Record<string, EffectiveValue[]> = {};
  for (const row of factors) {
    (factorInput[row.aircraftTypeId] ??= []).push({
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      value: numberOf(row.factor)
    });
  }
  const calculationEvents = events.flatMap((event: any) => {
      const aircraftTypeId = aircraftTypeIdOf(event);
      if (!aircraftTypeId) return [];
      const mpsHours: Partial<Record<PersonnelDepartment, number>> = {};
      for (const metric of event.reportMetrics) mpsHours[metric.department as PersonnelDepartment] = numberOf(metric.manHours);
      return [{
        id: event.id,
        startAt: event.startAt,
        endAt: event.endAt,
        status: event.status,
        aircraftTypeId,
        mpsHours,
        title: event.title as string,
        aircraftLabel: event.aircraftLabel as string,
        eventType: (event.eventType?.name || event.eventType?.code || "") as string,
        operator: (event.operator?.code || event.operator?.name || "") as string,
        workshopId: (event.workshopId ?? event.workshop?.id ?? "") as string,
        placements: (event.placements ?? []).map((placement: any) => ({
          startAt: placement.startAt as Date,
          endAt: placement.endAt as Date,
          label: `${placement.hangar?.code || placement.hangar?.name || "Ангар"} / ${placement.stand?.code || placement.stand?.name || "—"}`
        }))
      }];
    });
  const selectedTypeIds = params.aircraftTypeIds?.length ? new Set(params.aircraftTypeIds) : null;
  const categoryRules = mappedCategories.map((row: any) => ({
      code: row.categoryCode,
      department: row.department,
      isAuthorized: row.category?.isAuthorized ?? false
    }));
  const normInput = norms.map((row: any) => ({
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      value: numberOf(row.hours)
    }));
  const calculate = (aircraftTypeId?: string) =>
    calculatePersonnelWeek({
      weekStart: params.weekStart,
      dates,
      events: calculationEvents.filter((event: any) => (!aircraftTypeId || event.aircraftTypeId === aircraftTypeId) && (!selectedTypeIds || selectedTypeIds.has(event.aircraftTypeId))),
      availability: availability
        .filter((row: any) => (!aircraftTypeId || row.aircraftTypeId === aircraftTypeId) && (!selectedTypeIds || selectedTypeIds.has(row.aircraftTypeId)))
        .map((row: any) => ({
          date: row.date.toISOString().slice(0, 10),
          categoryCode: row.skill?.code ?? row.categoryCode,
          headcount: numberOf(row.headcount)
        })),
      categories: categoryRules,
      demandDepartments,
      norms: normInput,
      factorsByAircraftType: factorInput,
      timezoneOffsetMinutes: LOCAL_OFFSET_MINUTES,
      includeEventDemand: Boolean(params.includeEventDemand) && !aircraftTypeId
    });
  const calculation = calculate();
  const aircraftTypeIds = new Set<string>([
    ...availability.map((row: any) => row.aircraftTypeId),
    ...calculationEvents.map((event: any) => event.aircraftTypeId)
  ]);
  const calculationByAircraftType = Object.fromEntries(
    [...aircraftTypeIds].map((aircraftTypeId) => [aircraftTypeId, calculate(aircraftTypeId)])
  );
  const resourceSlices = params.includeEventDemand
    ? summarizeResourceSlices({
        weekStart: params.weekStart,
        dates,
        events: calculationEvents.filter((event: any) => !selectedTypeIds || selectedTypeIds.has(event.aircraftTypeId)),
        availability: availability
          .filter((row: any) => !selectedTypeIds || selectedTypeIds.has(row.aircraftTypeId))
          .map((row: any) => ({
            date: row.date.toISOString().slice(0, 10),
            workshopId: row.workshopId as string,
            aircraftTypeId: row.aircraftTypeId as string,
            categoryCode: (row.skill?.code ?? row.categoryCode) as string,
            headcount: numberOf(row.headcount)
          })),
        categories: categoryRules,
        demandDepartments,
        norms: normInput,
        factorsByAircraftType: factorInput,
        timezoneOffsetMinutes: LOCAL_OFFSET_MINUTES
      })
    : [];

  const aircraftTypes = assignedAircraft
    .map((row: { type: { id: string; name: string; icaoType: string | null } | null }) => row.type)
    .filter((type: { id: string; name: string; icaoType: string | null } | null): type is { id: string; name: string; icaoType: string | null } => Boolean(type))
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ru"));

  return {
    workshopId: params.workshopId,
    weekStart: params.weekStart,
    aircraftTypes,
    mappedCategories,
    demandDepartments,
    balanceLines,
    availability,
    norms,
    factors,
    events,
    calculation,
    calculationByAircraftType,
    resourceSlices
  };
}

type ResourceCategory = {
  workshopId: string;
  categoryCode: string;
  skillId: string | null;
  department: string | null;
  isActive: boolean;
  category: { code: string; name: string; department: string | null; isAuthorized: boolean };
};

function resourceCategoriesForWorkshop(
  workshopId: string,
  catalog: Array<{ code: string; department: string | null; isAuthorized: boolean; sortOrder: number; name: string }>,
  skillCodes: string[],
  mappings: Array<{ categoryCode: string; department?: string | null; isActive?: boolean; category?: { name?: string; department?: string | null; isAuthorized?: boolean } | null }>
): ResourceCategory[] {
  const uniqueSkills = [...new Set(skillCodes)];
  const fromSkills = uniqueSkills.length
    ? qualificationsForWorkshopSkills(catalog, uniqueSkills).map((row) => ({
        workshopId,
        categoryCode: row.code,
        skillId: null,
        department: row.department,
        isActive: true,
        category: { code: row.code, name: row.name ?? row.code, department: row.department, isAuthorized: row.isAuthorized }
      }))
    : [];
  if (fromSkills.length) return fromSkills;
  const seen = new Set<string>();
  return mappings.flatMap((mapping) => {
    if (seen.has(mapping.categoryCode)) return [];
    seen.add(mapping.categoryCode);
    const department = mapping.category?.department ?? mapping.department ?? null;
    return [{
      workshopId,
      categoryCode: mapping.categoryCode,
      skillId: null,
      department,
      isActive: mapping.isActive !== false,
      category: {
        code: mapping.categoryCode,
        name: mapping.category?.name ?? mapping.categoryCode,
        department,
        isAuthorized: Boolean(mapping.category?.isAuthorized)
      }
    }];
  });
}

/** Строки доступного ресурса по нескольким цехам: квалификации, типы ВС и численность. */
export async function loadPersonnelResourceSheets(
  prisma: any,
  params: { workshopIds: string[]; from: string; to: string }
) {
  const workshopIds = [...new Set(params.workshopIds)];
  const rangeStart = dateFromKey(params.from);
  const rangeEnd = dateFromKey(params.to);
  const [categories, mappings, workshopSkills, assignments, availability, workshops] = await Promise.all([
    prisma.personnelCategory.findMany({ where: { isActive: true } }),
    prisma.personnelWorkshopCategory.findMany({
      where: { workshopId: { in: workshopIds }, isActive: true },
      include: { category: true },
      orderBy: { categoryCode: "asc" }
    }),
    prisma.workshopSkill.findMany({
      where: { workshopId: { in: workshopIds }, skill: { isActive: true } },
      include: { skill: true },
      orderBy: { skill: { code: "asc" } }
    }),
    prisma.aircraftWorkshopAssignment.findMany({
      where: { workshopId: { in: workshopIds } },
      select: { workshopId: true, aircraft: { select: { type: { select: { id: true, name: true, icaoType: true } } } } }
    }),
    prisma.personnelAvailability.findMany({
      where: { workshopId: { in: workshopIds }, date: { gte: rangeStart, lte: rangeEnd } },
      include: { skill: { select: { id: true, code: true } } },
      orderBy: [{ date: "asc" }, { shiftId: "asc" }, { categoryCode: "asc" }]
    }),
    prisma.workshop.findMany({
      where: { id: { in: workshopIds } },
      select: { id: true, code: true, name: true }
    })
  ]);
  const catalog = categories.map((row: any) => ({
    code: row.code as string,
    department: (row.department ?? null) as string | null,
    isAuthorized: Boolean(row.isAuthorized),
    sortOrder: Number(row.sortOrder ?? 0),
    name: row.name as string
  }));
  const skillsByWorkshop = new Map<string, string[]>();
  for (const link of workshopSkills) {
    const codes = skillsByWorkshop.get(link.workshopId) ?? [];
    codes.push(String(link.skill.code));
    skillsByWorkshop.set(link.workshopId, codes);
  }
  const mappingsByWorkshop = new Map<string, any[]>();
  for (const mapping of mappings) {
    mappingsByWorkshop.set(mapping.workshopId, [...(mappingsByWorkshop.get(mapping.workshopId) ?? []), mapping]);
  }
  const typesByWorkshop = new Map<string, Array<{ id: string; name: string; icaoType: string | null }>>();
  for (const row of assignments) {
    const type = row.aircraft?.type;
    if (!type?.id) continue;
    const list = typesByWorkshop.get(row.workshopId) ?? [];
    if (!list.some((item) => item.id === type.id)) list.push(type);
    typesByWorkshop.set(row.workshopId, list);
  }
  const itemsByWorkshop = new Map<string, any[]>();
  for (const row of availability) {
    itemsByWorkshop.set(row.workshopId, [...(itemsByWorkshop.get(row.workshopId) ?? []), row]);
  }
  const workshopById = new Map<string, { id: string; code: string; name: string }>(workshops.map((row: any) => [row.id, row]));
  return workshopIds.map((workshopId) => {
    const workshop = workshopById.get(workshopId);
    const aircraftTypes = [...(typesByWorkshop.get(workshopId) ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return {
      workshopId,
      code: workshop?.code ?? "",
      name: workshop?.name ?? "",
      aircraftTypes,
      mappedCategories: resourceCategoriesForWorkshop(
        workshopId,
        catalog,
        skillsByWorkshop.get(workshopId) ?? [],
        mappingsByWorkshop.get(workshopId) ?? []
      ),
      items: itemsByWorkshop.get(workshopId) ?? []
    };
  });
}

export function personnelBaselineDelta(current: any, baseline: any | null | undefined) {
  if (!baseline) return null;
  const calculationDelta = (currentDays: any[], baselineDaysInput: any[]) => {
    const baselineDays = new Map<string, any>((baselineDaysInput ?? []).map((day: any) => [day.date, day]));
    return (currentDays ?? []).map((day: any) => {
      const before = baselineDays.get(day.date);
      const departments = Object.fromEntries(
        PERSONNEL_DEPARTMENTS.map((department) => [
          department,
          {
            demand: (day.demand?.[department] ?? 0) - (before?.demand?.[department] ?? 0),
            authorizedSupply:
              (day.authorizedSupply?.[department] ?? 0) - (before?.authorizedSupply?.[department] ?? 0),
            strictBalance: (day.strictBalance?.[department] ?? 0) - (before?.strictBalance?.[department] ?? 0)
          }
        ])
      );
      return {
        date: day.date,
        overallDemand: day.overallDemand - (before?.overallDemand ?? 0),
        overallSupply: day.overallSupply - (before?.overallSupply ?? 0),
        overallBalance: day.overallBalance - (before?.overallBalance ?? before?.overallPtoBalance ?? 0),
        overallPtoBalance: day.overallPtoBalance - (before?.overallPtoBalance ?? 0),
        departments
      };
    });
  };
  const calculation = calculationDelta(current.calculation, baseline.calculation);
  const typeIds = new Set<string>([
    ...Object.keys(current.calculationByAircraftType ?? {}),
    ...Object.keys(baseline.calculationByAircraftType ?? {})
  ]);
  const calculationByAircraftType = Object.fromEntries(
    [...typeIds].map((aircraftTypeId) => [
      aircraftTypeId,
      calculationDelta(
        current.calculationByAircraftType?.[aircraftTypeId] ?? [],
        baseline.calculationByAircraftType?.[aircraftTypeId] ?? []
      )
    ])
  );
  const currentEventIds = new Set<string>((current.events ?? []).map((event: any) => event.id));
  const baselineEventIds = new Set<string>((baseline.events ?? []).map((event: any) => event.id));
  return {
    calculation,
    calculationByAircraftType,
    events: {
      added: [...currentEventIds].filter((id) => !baselineEventIds.has(id)),
      removed: [...baselineEventIds].filter((id) => !currentEventIds.has(id))
    },
    availabilityChanged: comparable(current.availability) !== comparable(baseline.availability),
    normsChanged: comparable(current.norms) !== comparable(baseline.norms),
    factorsChanged: comparable(current.factors) !== comparable(baseline.factors)
  };
}
