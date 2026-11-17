import {
  availabilityIncluded,
  availabilityRowVisible,
  balanceColumns,
  calculatePersonnelWeek,
  PERSONNEL_DEPARTMENTS,
  resourceQualifications,
  sliceAircraftTypeId,
  summarizeResourceSlices,
  UNTYPED_AIRCRAFT_TYPE_ID,
  weekDateKeys,
  type CatalogSkill,
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
  const plannedSkills = (workshopSkills as any[]).map((link: any) => ({
    id: link.skill.id as string,
    code: String(link.skill.code),
    name: link.skill.name as string | undefined,
    countsInPlannedResource: link.skill.countsInPlannedResource !== false
  }));
  const fromSkills = resourceQualifications(catalogQualifications, plannedSkills).map((row) => ({
    workshopId: params.workshopId,
    categoryCode: row.code,
    skillId: row.skillId,
    department: row.department,
    sortOrder: row.sortOrder,
    isActive: true,
    countsInPlannedResource: row.countsInPlannedResource,
    category: {
      code: row.code,
      name: row.name,
      department: row.department,
      isAuthorized: row.isAuthorized,
      countsInPlannedResource: row.countsInPlannedResource,
      sortOrder: row.sortOrder
    }
  }));
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

  const [availability, norms, factors, rawEvents, assignedAircraft, statusRows, workshopFlags] = await Promise.all([
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
    prisma.eventStatusCatalog.findMany({ select: { code: true, name: true } }),
    prisma.workshop.findMany({
      where: { id: { in: workshopIds } },
      select: { id: true, withoutAircraftType: true }
    })
  ]);
  const untypedWorkshopIds = new Set<string>(
    (workshopFlags as Array<{ id: string; withoutAircraftType?: boolean }>)
      .filter((row) => row.withoutAircraftType)
      .map((row) => row.id)
  );

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
      isAuthorized: row.category?.isAuthorized ?? false,
      countsInPlannedResource: row.countsInPlannedResource !== false
    }));
  const normInput = norms.map((row: any) => ({
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      value: numberOf(row.hours)
    }));
  const availabilityInput = (row: any) => ({
    date: row.date.toISOString().slice(0, 10),
    categoryCode: row.skill?.code ?? row.categoryCode,
    headcount: numberOf(row.headcount)
  });
  const calculate = (aircraftTypeId?: string) =>
    calculatePersonnelWeek({
      weekStart: params.weekStart,
      dates,
      events: calculationEvents.filter((event: any) => (!aircraftTypeId || event.aircraftTypeId === aircraftTypeId) && (!selectedTypeIds || selectedTypeIds.has(event.aircraftTypeId))),
      availability: availability
        .filter((row: any) => availabilityIncluded(row, untypedWorkshopIds, selectedTypeIds, aircraftTypeId))
        .map(availabilityInput),
      categories: categoryRules,
      demandDepartments,
      norms: normInput,
      factorsByAircraftType: factorInput,
      timezoneOffsetMinutes: LOCAL_OFFSET_MINUTES,
      includeEventDemand: Boolean(params.includeEventDemand) && !aircraftTypeId
    });
  const calculation = calculate();
  const aircraftTypeIds = new Set<string>([
    ...availability.flatMap((row: any) => row.aircraftTypeId ? [row.aircraftTypeId as string] : []),
    ...calculationEvents.map((event: any) => event.aircraftTypeId)
  ]);
  const calculationByAircraftType = Object.fromEntries(
    [...aircraftTypeIds].map((aircraftTypeId) => [aircraftTypeId, calculate(aircraftTypeId)])
  );
  const resourceSlices = params.includeEventDemand
    ? summarizeResourceSlices({
        weekStart: params.weekStart,
        dates,
        events: calculationEvents
          .filter((event: any) => !selectedTypeIds || selectedTypeIds.has(event.aircraftTypeId))
          .map((event: any) => ({
            ...event,
            aircraftTypeId: sliceAircraftTypeId(event.workshopId, event.aircraftTypeId, untypedWorkshopIds)
          })),
        availability: availability
          .filter((row: any) => availabilityIncluded(row, untypedWorkshopIds, selectedTypeIds))
          .map((row: any) => ({
            date: row.date.toISOString().slice(0, 10),
            workshopId: row.workshopId as string,
            aircraftTypeId: sliceAircraftTypeId(row.workshopId, row.aircraftTypeId, untypedWorkshopIds),
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
  countsInPlannedResource: boolean;
  category: { code: string; name: string; department: string | null; isAuthorized: boolean; countsInPlannedResource: boolean };
};

function resourceCategoriesForWorkshop(
  workshopId: string,
  catalog: Array<{ code: string; department: string | null; isAuthorized: boolean; sortOrder: number; name: string }>,
  skills: CatalogSkill[],
  mappings: Array<{ categoryCode: string; department?: string | null; isActive?: boolean; category?: { name?: string; department?: string | null; isAuthorized?: boolean } | null }>
): ResourceCategory[] {
  const toRow = (
    row: { code: string; name?: string; department: string | null; isAuthorized: boolean; countsInPlannedResource?: boolean; skillId?: string | null },
    isActive = true
  ): ResourceCategory => ({
    workshopId,
    categoryCode: row.code,
    skillId: row.skillId ?? null,
    department: row.department,
    isActive,
    countsInPlannedResource: row.countsInPlannedResource !== false,
    category: {
      code: row.code,
      name: row.name ?? row.code,
      department: row.department,
      isAuthorized: row.isAuthorized,
      countsInPlannedResource: row.countsInPlannedResource !== false
    }
  });
  if (skills.length) return resourceQualifications(catalog, skills).map((row) => toRow(row));
  return mappings.map((mapping) => {
    const department = mapping.category?.department ?? mapping.department ?? null;
    return toRow({
      code: mapping.categoryCode,
      name: mapping.category?.name ?? mapping.categoryCode,
      department,
      isAuthorized: Boolean(mapping.category?.isAuthorized)
    }, mapping.isActive !== false);
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
      select: { id: true, code: true, name: true, withoutAircraftType: true }
    })
  ]);
  const catalog = categories.map((row: any) => ({
    code: row.code as string,
    department: (row.department ?? null) as string | null,
    isAuthorized: Boolean(row.isAuthorized),
    sortOrder: Number(row.sortOrder ?? 0),
    name: row.name as string
  }));
  const skillsByWorkshop = new Map<string, CatalogSkill[]>();
  for (const link of workshopSkills) {
    const list = skillsByWorkshop.get(link.workshopId) ?? [];
    list.push({
      id: link.skill.id as string,
      code: String(link.skill.code),
      name: link.skill.name as string | undefined,
      countsInPlannedResource: link.skill.countsInPlannedResource !== false
    });
    skillsByWorkshop.set(link.workshopId, list);
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
  const workshopById = new Map<string, { id: string; code: string; name: string; withoutAircraftType?: boolean }>(workshops.map((row: any) => [row.id, row]));
  const untypedWorkshopIds = new Set<string>(
    workshops.filter((row: { withoutAircraftType?: boolean }) => row.withoutAircraftType).map((row: { id: string }) => row.id)
  );
  const untypedAircraftType = { id: UNTYPED_AIRCRAFT_TYPE_ID, name: "Без типа", icaoType: null };
  return workshopIds.map((workshopId) => {
    const workshop = workshopById.get(workshopId);
    const withoutAircraftType = Boolean(workshop?.withoutAircraftType);
    const aircraftTypes = withoutAircraftType
      ? [untypedAircraftType]
      : [...(typesByWorkshop.get(workshopId) ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return {
      workshopId,
      code: workshop?.code ?? "",
      name: workshop?.name ?? "",
      withoutAircraftType,
      aircraftTypes,
      mappedCategories: resourceCategoriesForWorkshop(
        workshopId,
        catalog,
        skillsByWorkshop.get(workshopId) ?? [],
        mappingsByWorkshop.get(workshopId) ?? []
      ),
      items: (itemsByWorkshop.get(workshopId) ?? [])
        .filter((row: { workshopId: string; aircraftTypeId: string | null }) => availabilityRowVisible(row, untypedWorkshopIds))
        .map((row: { aircraftTypeId: string | null }) => ({ ...row, aircraftTypeId: row.aircraftTypeId ?? UNTYPED_AIRCRAFT_TYPE_ID }))
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

function archiveDateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
}

function slimArchiveSheet(sheet: any) {
  return {
    workshopId: String(sheet.workshopId ?? ""),
    code: String(sheet.code ?? ""),
    name: String(sheet.name ?? ""),
    withoutAircraftType: Boolean(sheet.withoutAircraftType),
    aircraftTypes: sheet.aircraftTypes ?? [],
    mappedCategories: (sheet.mappedCategories ?? []).map((row: any) => ({
      categoryCode: row.categoryCode ?? row.code ?? "",
      skillId: row.skillId ?? null,
      department: row.department ?? row.category?.department ?? null,
      countsInPlannedResource: row.countsInPlannedResource !== false && row.category?.countsInPlannedResource !== false
    })),
    items: (sheet.items ?? []).map((item: any) => ({
      date: String(item.date instanceof Date ? item.date.toISOString() : item.date ?? "").slice(0, 10),
      shiftId: String(item.shiftId ?? ""),
      aircraftTypeId: item.aircraftTypeId ?? "",
      categoryCode: item.skill?.code || item.categoryCode || "",
      skillId: item.skillId ?? item.skill?.id ?? null,
      headcount: Number(item.headcount ?? 0)
    })),
    weeks: (sheet.weeks ?? []).map((week: any) => ({
      weekStart: String(week.weekStart instanceof Date ? week.weekStart.toISOString() : week.weekStart ?? "").slice(0, 10),
      version: Number(week.version ?? 0),
      isLocked: Boolean(week.isLocked)
    }))
  };
}

function archiveTypeId(event: { aircraftType?: { id?: string | null } | null }) {
  return event.aircraftType?.id || "";
}

/** Frozen weekly plan: the live chart keeps following the Gantt, this copy does not. */
export function buildPersonnelPlanArchive(input: {
  from: string;
  to: string;
  weekStart: string;
  workshopIds: string[];
  aircraftTypeIds: string[];
  workshops: Array<{ id: string; code: string; name: string }>;
  data: {
    aircraftTypes?: Array<{ id: string; name: string; icaoType?: string | null }>;
    demandDepartments?: string[];
    events?: any[];
    calculation?: any[];
    resourceSlices?: any[];
    balanceLines?: any[];
    shifts?: any[];
    sheets?: any[];
  };
}) {
  const allowed = new Set(input.aircraftTypeIds);
  const events = (input.data.events ?? []).flatMap((event) => {
    const typeId = archiveTypeId(event);
    if (allowed.size ? !allowed.has(typeId) : !typeId) return [];
    return [{
      id: event.id,
      title: event.title,
      aircraftLabel: event.aircraftLabel,
      status: event.status,
      statusLabel: event.statusLabel,
      planningKind: event.planningKind,
      startAt: event.startAt,
      endAt: event.endAt,
      budgetStartAt: event.budgetStartAt ?? null,
      budgetEndAt: event.budgetEndAt ?? null,
      actualStartAt: event.actualStartAt ?? null,
      actualEndAt: event.actualEndAt ?? null,
      workshopId: event.workshopId ?? event.workshop?.id ?? "",
      aircraft: event.aircraft?.tailNumber ? { tailNumber: event.aircraft.tailNumber } : null,
      aircraftType: typeId ? { id: typeId, name: event.aircraftType?.name ?? null, icaoType: event.aircraftType?.icaoType ?? null } : null,
      operator: event.operator ? { id: event.operator.id, code: event.operator.code, name: event.operator.name } : null,
      workshop: event.workshop ? { id: event.workshop.id, code: event.workshop.code, name: event.workshop.name } : null,
      hangar: event.hangar ? { code: event.hangar.code, name: event.hangar.name } : null,
      placements: (event.placements ?? []).map((placement: any) => ({
        id: placement.id,
        startAt: placement.startAt,
        endAt: placement.endAt,
        hangar: placement.hangar ? { code: placement.hangar.code, name: placement.hangar.name } : null,
        stand: placement.stand ? { code: placement.stand.code, name: placement.stand.name } : null
      })),
      towSegments: (event.towSegments ?? []).map((tow: any) => ({ id: tow.id, startAt: tow.startAt, endAt: tow.endAt })),
      reportMetrics: event.reportMetrics ?? []
    }];
  });
  const knownWorkshops = new Map(input.workshops.map((row) => [row.id, row]));
  const workshops = input.workshopIds.flatMap((id) => {
    const row = knownWorkshops.get(id);
    return row ? [row] : [];
  });
  const workshopLabel = workshops.map((row) => row.code || row.name).join(", ");
  const title = `План ${archiveDateLabel(input.from)}–${archiveDateLabel(input.to)}${workshopLabel ? ` · ${workshopLabel}` : ""}`;
  const payload = {
    from: input.from,
    to: input.to,
    weekStart: input.weekStart,
    workshopIds: input.workshopIds,
    aircraftTypeIds: input.aircraftTypeIds,
    workshops,
    aircraftTypes: input.data.aircraftTypes ?? [],
    departments: input.data.demandDepartments ?? [],
    events,
    calculation: (input.data.calculation ?? []).map((day) => ({
      date: String(day.date).slice(0, 10),
      normHours: Number(day.normHours ?? 0),
      demand: day.demand ?? {},
      authorizedSupply: day.authorizedSupply ?? {},
      strictBalance: day.strictBalance ?? {},
      overallDemand: Number(day.overallDemand ?? 0),
      overallSupply: Number(day.overallSupply ?? 0),
      overallBalance: Number(day.overallBalance ?? day.overallPtoBalance ?? 0),
      qualificationSupply: day.qualificationSupply ?? {},
      eventDemand: day.eventDemand ?? []
    })),
    resourceSlices: input.data.resourceSlices ?? [],
    balanceLines: input.data.balanceLines ?? [],
    shifts: (input.data.shifts ?? []).map((shift) => ({
      id: String(shift.id),
      code: String(shift.code ?? ""),
      name: String(shift.name ?? ""),
      startMin: Number(shift.startMin ?? 0)
    })),
    sheets: (input.data.sheets ?? []).map(slimArchiveSheet)
  };
  return {
    title,
    workshopLabel,
    eventCount: events.length,
    payload: JSON.parse(JSON.stringify(payload))
  };
}
