import { PrismaClient, PlanningLevel, EventStatus } from "@prisma/client";
import argon2 from "argon2";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

const prisma = new PrismaClient();

// .env лежит в корне репо, а seed запускается из apps/api
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

function env(name: string) {
  return (process.env[name] ?? "").trim();
}

function omit<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const out: any = { ...obj };
  for (const k of keys) delete out[k as any];
  return out;
}

async function tryImportDemoSnapshot(changeReason: string) {
  const demoPath = path.resolve(process.cwd(), "prisma/demo-data.json");
  try {
    await fs.access(demoPath);
  } catch {
    return { imported: false as const, path: demoPath };
  }

  const raw = await fs.readFile(demoPath, "utf8");
  const data = JSON.parse(raw) as any;

  const upsertById = async (items: any[], delegate: any) => {
    for (const it of items ?? []) {
      await delegate.upsert({
        where: { id: it.id },
        update: omit(it, ["id"]),
        create: it
      });
    }
  };

  // --- справочники ---
  await upsertById(data.operators ?? [], prisma.operator);
  await upsertById(data.aircraftTypes ?? [], prisma.aircraftType);
  await upsertById(data.eventTypes ?? [], prisma.eventType);
  await upsertById(data.hangars ?? [], prisma.hangar);
  await upsertById(data.layouts ?? [], prisma.hangarLayout);
  await upsertById(data.stands ?? [], prisma.hangarStand);
  await upsertById(data.aircraft ?? [], prisma.aircraft);

  // палитра (уникальна по operatorId+aircraftTypeId)
  for (const p of data.palettes ?? []) {
    await (prisma as any).aircraftTypePalette.upsert({
      where: { operatorId_aircraftTypeId: { operatorId: p.operatorId, aircraftTypeId: p.aircraftTypeId } },
      update: { color: p.color, isActive: p.isActive ?? true },
      create: p
    });
  }

  // --- workforce / склад ---
  await upsertById(data.shifts ?? [], prisma.shift);
  await upsertById(data.skills ?? [], prisma.skill);
  await upsertById(data.persons ?? [], prisma.person);
  await upsertById(data.warehouses ?? [], prisma.warehouse);
  await upsertById(data.materials ?? [], prisma.material);

  // m2m
  for (const ps of data.personSkills ?? []) {
    await prisma.personSkill.upsert({
      where: { personId_skillId: { personId: ps.personId, skillId: ps.skillId } },
      update: { level: ps.level ?? null, validFrom: ps.validFrom ?? null, validTo: ps.validTo ?? null },
      create: ps
    });
  }

  // --- события / резервы ---
  await upsertById(data.events ?? [], prisma.maintenanceEvent);

  for (const r of data.reservations ?? []) {
    await prisma.standReservation.upsert({
      where: { eventId: r.eventId },
      update: omit(r, ["id"]),
      create: r
    });
  }

  await upsertById(data.tows ?? [], (prisma as any).eventTow);
  await upsertById(data.personUnavailability ?? [], prisma.personUnavailability);

  // уникальные строки ресурсов по композитным ключам
  for (const l of data.workPlanLines ?? []) {
    await prisma.eventWorkPlanLine.upsert({
      where: {
        eventId_date_shiftId_skillId: { eventId: l.eventId, date: new Date(l.date), shiftId: l.shiftId, skillId: l.skillId }
      },
      update: { plannedHeadcount: l.plannedHeadcount ?? null, plannedMinutes: l.plannedMinutes, notes: l.notes ?? null },
      create: { ...l, date: new Date(l.date) }
    });
  }
  for (const l of data.workActualLines ?? []) {
    await prisma.eventWorkActualLine.upsert({
      where: {
        eventId_date_shiftId_skillId: { eventId: l.eventId, date: new Date(l.date), shiftId: l.shiftId, skillId: l.skillId }
      },
      update: { actualHeadcount: l.actualHeadcount, notes: l.notes ?? null },
      create: { ...l, date: new Date(l.date) }
    });
  }
  await upsertById(data.timeEntries ?? [], prisma.timeEntry);

  // складские операции (id-шники)
  await upsertById(data.stockMovements ?? [], prisma.stockMovement);

  // резервы материалов (композитный уникальный)
  for (const mr of data.materialReservations ?? []) {
    await prisma.materialReservation.upsert({
      where: {
        eventId_materialId_warehouseId_needByDate: {
          eventId: mr.eventId,
          materialId: mr.materialId,
          warehouseId: mr.warehouseId,
          needByDate: new Date(mr.needByDate)
        }
      },
      update: { qtyReserved: mr.qtyReserved, notes: mr.notes ?? null },
      create: { ...mr, needByDate: new Date(mr.needByDate) }
    });
  }
  await upsertById(data.materialIssues ?? [], prisma.materialIssue);

  // аудит (id-шники). Не обязателен для работы, но полезен для демо.
  // Чтобы избежать дубликатов, upsert по id.
  await upsertById(data.audits ?? [], prisma.maintenanceEventAudit);

  console.log(`Imported demo snapshot from ${demoPath} (reason: ${changeReason})`);
  return { imported: true as const, path: demoPath };
}

async function main() {
  console.log("Seeding…");
  console.log("DATABASE_URL:", process.env.DATABASE_URL);

  // --- RBAC/Users ---
  const permissionsSeed = [
    { code: "events:read", name: "Просмотр событий" },
    { code: "events:write", name: "Редактирование событий" },
    { code: "ref:read", name: "Просмотр справочников" },
    { code: "ref:write", name: "Редактирование справочников" },
    { code: "admin:users", name: "Администрирование пользователей" },
    { code: "admin:roles", name: "Администрирование ролей/прав" },
    { code: "resources:read", name: "Просмотр ресурсов по событиям" },
    { code: "resources:plan", name: "Планирование ресурсов по событиям" },
    { code: "resources:actual", name: "Факт ресурсов по событиям" },
    { code: "workforce:read", name: "Просмотр персонала/квалификаций/смен" },
    { code: "workforce:write", name: "Редактирование персонала/квалификаций/смен" },
    { code: "warehouse:read", name: "Просмотр материалов/складов/остатков" },
    { code: "warehouse:write", name: "Редактирование материалов/складов/движений" }
  ] as const;

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

  const setRolePerms = async (roleId: string, permCodes: string[]) => {
    const permIds = permCodes.map((c) => permByCode.get(c)!.id);
    // idempotent: ensure each link exists
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

  await setRolePerms(roleAdmin.id, permissionsSeed.map((p) => p.code) as unknown as string[]);
  await setRolePerms(rolePlanner.id, [
    "events:read",
    "events:write",
    "ref:read",
    "resources:read",
    "resources:plan",
    "resources:actual",
    "workforce:read",
    "warehouse:read"
  ]);
  await setRolePerms(roleViewer.id, ["events:read", "ref:read", "resources:read", "workforce:read", "warehouse:read"]);

  const adminEmail = env("ADMIN_EMAIL") || "admin@local.dev";
  const adminPassword = env("ADMIN_PASSWORD") || "admin";
  const adminName = env("ADMIN_NAME") || "Администратор";

  if (!env("ADMIN_EMAIL") || !env("ADMIN_PASSWORD")) {
    console.warn(
      "ADMIN_EMAIL/ADMIN_PASSWORD не заданы — создан demo-админ admin@local.dev / admin (mustChangePassword=true)."
    );
  }

  const adminHash = await argon2.hash(adminPassword);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    update: { displayName: adminName, passwordHash: adminHash, isActive: true },
    create: {
      email: adminEmail.toLowerCase(),
      displayName: adminName,
      passwordHash: adminHash,
      isActive: true,
      mustChangePassword: true
    }
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roleAdmin.id } },
    update: {},
    create: { userId: admin.id, roleId: roleAdmin.id }
  });

  // Справочники (минимальный набор для старта)
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

  // 5 ангаров (как в текущем описании)
  const hangars = await Promise.all(
    [1, 2, 3, 4, 5].map(async (n) =>
      prisma.hangar.upsert({
        where: { code: `H${n}` },
        update: {},
        create: { code: `H${n}`, name: `Ангар ${n}` }
      })
    )
  );

  // По одному варианту расстановки на ангар для демо (дальше можно добавлять через UI)
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

  // Несколько мест в первом ангаре/варианте, чтобы сразу увидеть визуализацию
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

  // Демо‑событие + резерв
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
        status: EventStatus.PLANNED,
        title: "Демо: A‑check",
        aircraftId: aircraft.id,
        eventTypeId: aCheck.id,
        startAt: start,
        endAt: end,
        hangarId: hangars[0]!.id,
        layoutId: layout1.id
      }
    }));

  await prisma.standReservation.upsert({
    where: { eventId: event.id },
    update: {
      layoutId: layout1.id,
      standId: stands[0]!.id,
      startAt: start,
      endAt: end
    },
    create: {
      eventId: event.id,
      layoutId: layout1.id,
      standId: stands[0]!.id,
      startAt: start,
      endAt: end
    }
  });

  // Чтобы справочник не был пустым
  void cCheck;

  // --- Ресурсы (MVP) ---
  const shiftDay = await prisma.shift.upsert({
    where: { code: "DAY" },
    update: { name: "Дневная", startMin: 8 * 60, endMin: 20 * 60, isActive: true },
    create: { code: "DAY", name: "Дневная", startMin: 8 * 60, endMin: 20 * 60, isActive: true }
  });
  const shiftNight = await prisma.shift.upsert({
    where: { code: "NIGHT" },
    update: { name: "Ночная", startMin: 20 * 60, endMin: 8 * 60, isActive: true },
    create: { code: "NIGHT", name: "Ночная", startMin: 20 * 60, endMin: 8 * 60, isActive: true }
  });
  void shiftNight;

  const skillMech = await prisma.skill.upsert({
    where: { code: "MECH" },
    update: { name: "Механик", isActive: true },
    create: { code: "MECH", name: "Механик", isActive: true }
  });
  const skillAvio = await prisma.skill.upsert({
    where: { code: "AVIO" },
    update: { name: "Авионика", isActive: true },
    create: { code: "AVIO", name: "Авионика", isActive: true }
  });

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
    where: { personId_skillId: { personId: p1.id, skillId: skillMech.id } },
    update: { level: 5 },
    create: { personId: p1.id, skillId: skillMech.id, level: 5 }
  });
  await prisma.personSkill.upsert({
    where: { personId_skillId: { personId: p2.id, skillId: skillAvio.id } },
    update: { level: 4 },
    create: { personId: p2.id, skillId: skillAvio.id, level: 4 }
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

  // приход на склад (для демо остатков)
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

  // демо-план по событию: 2 дня по дневной смене
  const startDayUtc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0, 0));
  await prisma.eventWorkPlanLine.upsert({
    where: { eventId_date_shiftId_skillId: { eventId: event.id, date: startDayUtc, shiftId: shiftDay.id, skillId: skillMech.id } },
    update: { plannedMinutes: 8 * 60, notes: "План" },
    create: { eventId: event.id, date: startDayUtc, shiftId: shiftDay.id, skillId: skillMech.id, plannedMinutes: 8 * 60, notes: "План" }
  });
  await prisma.eventWorkPlanLine.upsert({
    where: { eventId_date_shiftId_skillId: { eventId: event.id, date: startDayUtc, shiftId: shiftDay.id, skillId: skillAvio.id } },
    update: { plannedMinutes: 4 * 60, notes: "План" },
    create: { eventId: event.id, date: startDayUtc, shiftId: shiftDay.id, skillId: skillAvio.id, plannedMinutes: 4 * 60, notes: "План" }
  });

  // резерв материалов
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

  // Если рядом лежит snapshot демо-данных, импортируем его поверх "минимального" seed
  // (нужно для развертываний в другом месте с теми же данными, что в вашей текущей БД).
  await tryImportDemoSnapshot("seed:demo-snapshot");

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

