import { PrismaClient, PlanningLevel, EventStatus } from "@prisma/client";
import argon2 from "argon2";
import path from "node:path";
import dotenv from "dotenv";

import { PERMISSION_SEED } from "../src/lib/permissionCatalog.js";
import { checkEventCountPresets, checkEventCountReportConfig } from "../src/lib/reportPresets.js";

const prisma = new PrismaClient();

// .env лежит в корне репо, а seed запускается из apps/api
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

function env(name: string) {
  return (process.env[name] ?? "").trim();
}

function isProd() {
  return env("NODE_ENV") === "production";
}

function isSeedDemo() {
  const v = env("SEED_DEMO").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function main() {
  console.log("Seeding…");

  const seedDemo = isSeedDemo();
  if (isProd() && seedDemo) {
    throw new Error("SEED_DEMO запрещён в production. Уберите флаг и задайте ADMIN_EMAIL / ADMIN_PASSWORD.");
  }

  // --- RBAC/Users ---
  const permissionsSeed = PERMISSION_SEED;

  const permissions = await Promise.all(
    permissionsSeed.map((p) =>
      prisma.permission.upsert({
        where: { code: p.code },
        update: { name: p.name },
        create: { code: p.code, name: p.name }
      })
    )
  );
  const permByCode = new Map(permissions.map((p) => [p.code, p] as const));

  const roleAdmin = await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: { name: "Администратор", isSystem: true },
    create: { code: "ADMIN", name: "Администратор", isSystem: true }
  });
  const rolePlanner = await prisma.role.upsert({
    where: { code: "PLANNER" },
    update: { name: "Планировщик", isSystem: true },
    create: { code: "PLANNER", name: "Планировщик", isSystem: true }
  });
  const roleViewer = await prisma.role.upsert({
    where: { code: "VIEWER" },
    update: { name: "Наблюдатель", isSystem: true },
    create: { code: "VIEWER", name: "Наблюдатель", isSystem: true }
  });
  const roleSuperAdmin = await prisma.role.upsert({
    where: { code: "SUPER_ADMIN" },
    update: { name: "Главный администратор", isSystem: true },
    create: { code: "SUPER_ADMIN", name: "Главный администратор", isSystem: true }
  });

  const setRolePerms = async (roleId: string, permCodes: string[]) => {
    const permIds = permCodes.map((c) => permByCode.get(c)!.id);
    await Promise.all(
      permIds.map((permissionId) =>
        prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId } },
          update: {},
          create: { roleId, permissionId }
        })
      )
    );
  };

  await setRolePerms(roleAdmin.id, permissionsSeed.map((p) => p.code).filter((code) => code !== "admin:cleanup") as string[]);
  const cleanupPermission = permByCode.get("admin:cleanup");
  if (cleanupPermission) {
    await prisma.rolePermission.deleteMany({
      where: { roleId: roleAdmin.id, permissionId: cleanupPermission.id }
    });
  }
  await setRolePerms(roleSuperAdmin.id, permissionsSeed.map((p) => p.code) as unknown as string[]);
  await setRolePerms(rolePlanner.id, [
    "gantt:read",
    "gantt:write",
    "hangar:read",
    "hangar:write",
    "analytics:read",
    "itp:read",
    "import:write",
    "events:read",
    "events:write",
    "ref:read",
    "mail:send",
    "resources:read",
    "resources:plan",
    "resources:actual",
    "workforce:read",
    "warehouse:read"
  ]);
  await setRolePerms(roleViewer.id, [
    "gantt:read",
    "hangar:read",
    "analytics:read",
    "itp:read",
    "events:read",
    "ref:read",
    "resources:read",
    "workforce:read",
    "warehouse:read"
  ]);

  const adminEmail = env("ADMIN_EMAIL") || "admin@local.dev";
  const adminPassword = env("ADMIN_PASSWORD") || "admin";
  const adminName = env("ADMIN_NAME") || "Администратор";

  if (isProd()) {
    if (!env("ADMIN_EMAIL") || !env("ADMIN_PASSWORD")) {
      throw new Error("ADMIN_EMAIL и ADMIN_PASSWORD обязательны в production");
    }
    if (adminPassword === "admin" || adminEmail.toLowerCase() === "admin@local.dev") {
      throw new Error("В production нельзя сидить demo-админа admin@local.dev / admin");
    }
  }

  if (!env("ADMIN_EMAIL") || !env("ADMIN_PASSWORD")) {
    console.warn(
      "ADMIN_EMAIL/ADMIN_PASSWORD не заданы — создан demo-админ admin@local.dev / admin (mustChangePassword=true)."
    );
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail.toLowerCase() } });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { displayName: adminName, isActive: true }
      })
    : await prisma.user.create({
        data: {
          email: adminEmail.toLowerCase(),
          displayName: adminName,
          passwordHash: await argon2.hash(adminPassword),
          isActive: true,
          mustChangePassword: true
        }
      });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roleAdmin.id } },
    update: {},
    create: { userId: admin.id, roleId: roleAdmin.id }
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roleSuperAdmin.id } },
    update: {},
    create: { userId: admin.id, roleId: roleSuperAdmin.id }
  });

  await prisma.eventStatusCatalog.createMany({
    data: [
      { code: EventStatus.PENDING_EXECUTOR_APPROVAL, name: "На согласовании с исполнителем", color: "#FFC182", sortOrder: 10, selectable: true, allowsAutoInProgress: false, manualOnly: true },
      { code: EventStatus.PENDING_CUSTOMER_APPROVAL, name: "На согласовании с заказчиком", color: "#F8FA7F", sortOrder: 20, selectable: true, allowsAutoInProgress: false, manualOnly: true },
      { code: EventStatus.APPROVED_BY_EXECUTOR, name: "Согласовано с исполнителем", color: "#FFC1FF", sortOrder: 30, selectable: true, allowsAutoInProgress: true, manualOnly: false },
      { code: EventStatus.APPROVED_BY_CUSTOMER, name: "Согласовано с заказчиком", color: "#7BFA7F", sortOrder: 40, selectable: true, allowsAutoInProgress: true, manualOnly: false },
      { code: EventStatus.IN_PROGRESS, name: "В работе", color: null, sortOrder: 50, selectable: true, allowsAutoInProgress: false, manualOnly: false },
      { code: EventStatus.DONE, name: "Завершено", color: "#16a34a", sortOrder: 60, selectable: true, allowsAutoInProgress: false, manualOnly: false },
      { code: EventStatus.CANCELLED, name: "Отменено", color: null, sortOrder: 70, selectable: true, allowsAutoInProgress: false, manualOnly: true },
      { code: EventStatus.DELETED, name: "Удалено", color: null, sortOrder: 80, selectable: false, allowsAutoInProgress: false, manualOnly: true }
    ],
    skipDuplicates: true
  });

  if (!seedDemo) {
    console.log("Демо-данные пропущены. Для локальной разработки: SEED_DEMO=1 npm run prisma:seed -w apps/api");
  } else {
    const ensureDemoUser = async (params: {
      email: string;
      displayName: string;
      password: string;
      roleId: string;
    }) => {
      const email = params.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: { displayName: params.displayName, isActive: true }
          })
        : await prisma.user.create({
            data: {
              email,
              displayName: params.displayName,
              passwordHash: await argon2.hash(params.password),
              isActive: true,
              mustChangePassword: true
            }
          });

      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: params.roleId } });
      return user;
    };

    await ensureDemoUser({
      email: "planner@local.dev",
      displayName: "Планировщик",
      password: "planner123",
      roleId: rolePlanner.id
    });
    await ensureDemoUser({
      email: "viewer@local.dev",
      displayName: "Просмотрщик",
      password: "viewer123",
      roleId: roleViewer.id
    });

    const operator = await prisma.operator.upsert({
      where: { code: "DEMO" },
      update: {},
      create: { code: "DEMO", name: "Демо‑оператор" }
    });

    const typeA320 = await prisma.aircraftType.upsert({
      where: { icaoType: "A320" },
      update: {},
      create: { icaoType: "A320", name: "Airbus A320", manufacturer: "Airbus" }
    });

    const aircraft = await prisma.aircraft.upsert({
      where: { tailNumber: "RA-00000" },
      update: {},
      create: {
        tailNumber: "RA-00000",
        operatorId: operator.id,
        typeId: typeA320.id
      }
    });

    const aCheck = await prisma.eventType.upsert({
      where: { code: "A_CHECK" },
      update: {},
      create: { code: "A_CHECK", name: "A‑check", color: "#3b82f6" }
    });

    const cCheck = await prisma.eventType.upsert({
      where: { code: "C_CHECK" },
      update: {},
      create: { code: "C_CHECK", name: "C‑check", color: "#f97316" }
    });

    await prisma.workshop.upsert({
      where: { code: "SHOP1" },
      update: {},
      create: { code: "SHOP1", name: "Цех 1" }
    });

    await prisma.workshop.upsert({
      where: { code: "SHOP2" },
      update: {},
      create: { code: "SHOP2", name: "Цех 2" }
    });

    const hangars = await Promise.all(
      [1, 2, 3, 4, 5].map(async (n) =>
        prisma.hangar.upsert({
          where: { code: `H${n}` },
          update: {},
          create: { code: `H${n}`, name: `Ангар ${n}` }
        })
      )
    );

    const layouts = await Promise.all(
      hangars.map(async (h) =>
        prisma.hangarLayout.upsert({
          where: { hangarId_code: { hangarId: h.id, code: "BASE" } },
          update: {},
          create: {
            hangarId: h.id,
            code: "BASE",
            name: "Базовый вариант",
            widthMeters: 60,
            heightMeters: 40
          }
        })
      )
    );

    const layout1 = layouts[0]!;
    const stands = await Promise.all(
      [
        { code: "S1", name: "Место 1", x: 5, y: 5, w: 18, h: 10 },
        { code: "S2", name: "Место 2", x: 25, y: 5, w: 18, h: 10 },
        { code: "S3", name: "Место 3", x: 5, y: 20, w: 18, h: 10 }
      ].map((s) =>
        prisma.hangarStand.upsert({
          where: { layoutId_code: { layoutId: layout1.id, code: s.code } },
          update: {},
          create: { ...s, layoutId: layout1.id }
        })
      )
    );

    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const existingEvent = await prisma.maintenanceEvent.findFirst({
      where: {
        aircraftId: aircraft.id,
        eventTypeId: aCheck.id,
        startAt: start,
        endAt: end,
        level: PlanningLevel.OPERATIONAL
      }
    });

    const event =
      existingEvent ??
      (await prisma.maintenanceEvent.create({
        data: {
          level: PlanningLevel.OPERATIONAL,
          status: EventStatus.PENDING_EXECUTOR_APPROVAL,
          planningKind: "PLANNED",
          title: "Демо: A‑check",
          aircraftId: aircraft.id,
          eventTypeId: aCheck.id,
          startAt: start,
          endAt: end,
          budgetStartAt: start,
          budgetEndAt: end,
          hangarId: hangars[0]!.id,
          layoutId: layout1.id
        }
      }));

    await prisma.standReservation.deleteMany({ where: { eventId: event.id } });
    await prisma.eventPlacement.deleteMany({ where: { eventId: event.id } });
    const placement = await prisma.eventPlacement.create({
      data: {
        eventId: event.id,
        startAt: start,
        endAt: end,
        budgetStartAt: event.budgetStartAt ?? null,
        budgetEndAt: event.budgetEndAt ?? null,
        actualStartAt: event.actualStartAt ?? null,
        actualEndAt: event.actualEndAt ?? null,
        hangarId: hangars[0]!.id,
        layoutId: layout1.id,
        standId: stands[0]!.id,
        sortOrder: 0
      }
    });
    await prisma.standReservation.create({
      data: {
        eventId: event.id,
        placementId: placement.id,
        layoutId: layout1.id,
        standId: stands[0]!.id,
        startAt: start,
        endAt: end
      }
    });

    const shiftDay = await prisma.shift.upsert({
      where: { code: "DAY" },
      update: { name: "Дневная", startMin: 8 * 60, endMin: 20 * 60, isActive: true },
      create: { code: "DAY", name: "Дневная", startMin: 8 * 60, endMin: 20 * 60, isActive: true }
    });
    await prisma.shift.upsert({
      where: { code: "NIGHT" },
      update: { name: "Ночная", startMin: 20 * 60, endMin: 8 * 60, isActive: true },
      create: { code: "NIGHT", name: "Ночная", startMin: 20 * 60, endMin: 8 * 60, isActive: true }
    });

    const skillDefs = [
      { code: "ME", name: "ME (Mechanic)" },
      { code: "AV", name: "AV (Avionics)" },
      { code: "INT", name: "INT (Interior)" },
      { code: "NDT", name: "NDT / BORO" },
      { code: "SHOP", name: "SHOP" },
      { code: "CAB_REP", name: "CabRep" }
    ] as const;
    const skillsByCode: Record<string, { id: string }> = {};
    for (const def of skillDefs) {
      skillsByCode[def.code] = await prisma.skill.upsert({
        where: { code: def.code },
        update: { name: def.name, isActive: true },
        create: { code: def.code, name: def.name, isActive: true }
      });
    }
    await prisma.skill.updateMany({
      where: { code: { in: ["MECH", "AVIO"] } },
      data: { isActive: false }
    });
    const skillMe = skillsByCode.ME!;
    const skillAv = skillsByCode.AV!;

    const p1 = await prisma.person.upsert({
      where: { code: "P001" },
      update: { name: "Иванов И.И.", isActive: true },
      create: { code: "P001", name: "Иванов И.И.", isActive: true }
    });
    const p2 = await prisma.person.upsert({
      where: { code: "P002" },
      update: { name: "Петров П.П.", isActive: true },
      create: { code: "P002", name: "Петров П.П.", isActive: true }
    });

    await prisma.personSkill.upsert({
      where: { personId_skillId: { personId: p1.id, skillId: skillMe.id } },
      update: { level: 5 },
      create: { personId: p1.id, skillId: skillMe.id, level: 5 }
    });
    await prisma.personSkill.upsert({
      where: { personId_skillId: { personId: p2.id, skillId: skillAv.id } },
      update: { level: 4 },
      create: { personId: p2.id, skillId: skillAv.id, level: 4 }
    });

    const wh = await prisma.warehouse.upsert({
      where: { code: "MAIN" },
      update: { name: "Основной склад", isActive: true },
      create: { code: "MAIN", name: "Основной склад", isActive: true }
    });

    const matOil = await prisma.material.upsert({
      where: { code: "OIL-01" },
      update: { name: "Масло", uom: "L", isActive: true },
      create: { code: "OIL-01", name: "Масло", uom: "L", isActive: true }
    });
    const matFilter = await prisma.material.upsert({
      where: { code: "FLT-01" },
      update: { name: "Фильтр", uom: "EA", isActive: true },
      create: { code: "FLT-01", name: "Фильтр", uom: "EA", isActive: true }
    });

    const ensureSeedIn = async (materialId: string, qty: number) => {
      const exists = await prisma.stockMovement.findFirst({
        where: { materialId, warehouseId: wh.id, type: "IN", notes: "Seed IN" }
      });
      if (exists) return;
      await prisma.stockMovement.create({
        data: { materialId, warehouseId: wh.id, type: "IN", qty, notes: "Seed IN" }
      });
    };
    await ensureSeedIn(matOil.id, 100);
    await ensureSeedIn(matFilter.id, 50);

    const startDayUtc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0));
    await prisma.eventWorkPlanLine.upsert({
      where: { eventId_date_shiftId_skillId: { eventId: event.id, date: startDayUtc, shiftId: shiftDay.id, skillId: skillMe.id } },
      update: { plannedMinutes: 8 * 60, notes: "План" },
      create: { eventId: event.id, date: startDayUtc, shiftId: shiftDay.id, skillId: skillMe.id, plannedMinutes: 8 * 60, notes: "План" }
    });
    await prisma.eventWorkPlanLine.upsert({
      where: { eventId_date_shiftId_skillId: { eventId: event.id, date: startDayUtc, shiftId: shiftDay.id, skillId: skillAv.id } },
      update: { plannedMinutes: 4 * 60, notes: "План" },
      create: { eventId: event.id, date: startDayUtc, shiftId: shiftDay.id, skillId: skillAv.id, plannedMinutes: 4 * 60, notes: "План" }
    });

    await prisma.materialReservation.upsert({
      where: { eventId_materialId_warehouseId_needByDate: { eventId: event.id, materialId: matOil.id, warehouseId: wh.id, needByDate: start } },
      update: { qtyReserved: 10, notes: "План" },
      create: { eventId: event.id, materialId: matOil.id, warehouseId: wh.id, qtyReserved: 10, needByDate: start, notes: "План" }
    });
    await prisma.materialReservation.upsert({
      where: { eventId_materialId_warehouseId_needByDate: { eventId: event.id, materialId: matFilter.id, warehouseId: wh.id, needByDate: start } },
      update: { qtyReserved: 2, notes: "План" },
      create: { eventId: event.id, materialId: matFilter.id, warehouseId: wh.id, qtyReserved: 2, needByDate: start, notes: "План" }
    });

    for (const preset of checkEventCountPresets({ aCheck: aCheck.name, cCheck: cCheck.name })) {
      const config = checkEventCountReportConfig(preset.eventTypeName);
      const existing = await prisma.savedReport.findFirst({
        where: { ownerId: admin.id, name: preset.name }
      });
      if (existing) {
        await prisma.savedReport.update({
          where: { id: existing.id },
          data: { description: preset.description, config }
        });
      } else {
        await prisma.savedReport.create({
          data: {
            name: preset.name,
            description: preset.description,
            ownerId: admin.id,
            config
          }
        });
      }
    }
  }

  const counts = {
    users: await prisma.user.count(),
    roles: await prisma.role.count(),
    permissions: await prisma.permission.count(),
    operator: await prisma.operator.count(),
    aircraftType: await prisma.aircraftType.count(),
    aircraft: await prisma.aircraft.count(),
    eventType: await prisma.eventType.count(),
    hangar: await prisma.hangar.count(),
    layout: await prisma.hangarLayout.count(),
    stand: await prisma.hangarStand.count(),
    event: await prisma.maintenanceEvent.count(),
    reservation: await prisma.standReservation.count(),
    shift: await prisma.shift.count(),
    skill: await prisma.skill.count(),
    person: await prisma.person.count(),
    warehouse: await prisma.warehouse.count(),
    material: await prisma.material.count()
  };

  console.table(counts);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
