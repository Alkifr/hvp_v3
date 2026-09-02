/** Схема данных Hangar Planning для ER-диаграммы в инструкции. Сгенерировано из Prisma. */

export type ErGroupId =
  | "auth"
  | "sandbox"
  | "fleet"
  | "hangar"
  | "event"
  | "eventExt"
  | "tech"
  | "labor"
  | "material"
  | "comms"
  | "analytics";

export type ErColumn = {
  name: string;
  type: string;
  pk?: boolean;
  fk?: boolean;
  unique?: boolean;
};

export type ErTable = {
  id: string;
  label: string;
  group: ErGroupId;
  columns: ErColumn[];
};

export type ErEdge = {
  from: string;
  fromCol: string;
  to: string;
  toCol: string;
  rel: "1:1" | "N:1";
};

export const ER_GROUPS: { id: ErGroupId; title: string; color: string }[] = [
  { id: "auth", title: "Пользователи и права", color: "#7c3aed" },
  { id: "sandbox", title: "Песочницы", color: "#0ea5e9" },
  { id: "fleet", title: "Флот и справочники ТО", color: "#2563eb" },
  { id: "hangar", title: "Ангары и расстановка", color: "#059669" },
  { id: "event", title: "События и размещение", color: "#d97706" },
  { id: "eventExt", title: "Расширения события", color: "#ea580c" },
  { id: "tech", title: "Техплан ИТП", color: "#db2777" },
  { id: "labor", title: "Персонал и трудоёмкость", color: "#4f46e5" },
  { id: "material", title: "Материалы и склады", color: "#0f766e" },
  { id: "comms", title: "Уведомления и рассылка", color: "#be123c" },
  { id: "analytics", title: "Отчёты и журналы", color: "#334155" }
];

export const ER_TABLES: ErTable[] = [
  {
    "id": "Shift",
    "label": "Смена",
    "group": "labor",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "startMin",
        "type": "Int"
      },
      {
        "name": "endMin",
        "type": "Int"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Person",
    "label": "Сотрудник",
    "group": "labor",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String?",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Skill",
    "label": "Квалификация",
    "group": "labor",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "PersonSkill",
    "label": "Квалификация сотрудника",
    "group": "labor",
    "columns": [
      {
        "name": "personId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "skillId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "level",
        "type": "Int?"
      },
      {
        "name": "validFrom",
        "type": "DateTime?"
      },
      {
        "name": "validTo",
        "type": "DateTime?"
      }
    ]
  },
  {
    "id": "PersonUnavailability",
    "label": "Недоступность сотрудника",
    "group": "labor",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "personId",
        "type": "String",
        "fk": true
      },
      {
        "name": "startAt",
        "type": "DateTime"
      },
      {
        "name": "endAt",
        "type": "DateTime"
      },
      {
        "name": "reason",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventWorkPlanLine",
    "label": "План трудоёмкости (смена)",
    "group": "labor",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "date",
        "type": "DateTime"
      },
      {
        "name": "shiftId",
        "type": "String",
        "fk": true
      },
      {
        "name": "skillId",
        "type": "String",
        "fk": true
      },
      {
        "name": "plannedHeadcount",
        "type": "Int?"
      },
      {
        "name": "plannedMinutes",
        "type": "Int"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventWorkActualLine",
    "label": "Факт численности (смена)",
    "group": "labor",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "date",
        "type": "DateTime"
      },
      {
        "name": "shiftId",
        "type": "String",
        "fk": true
      },
      {
        "name": "skillId",
        "type": "String",
        "fk": true
      },
      {
        "name": "actualHeadcount",
        "type": "Int"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "TimeEntry",
    "label": "Учёт времени",
    "group": "labor",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "personId",
        "type": "String",
        "fk": true
      },
      {
        "name": "skillId",
        "type": "String",
        "fk": true
      },
      {
        "name": "shiftId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "startAt",
        "type": "DateTime"
      },
      {
        "name": "endAt",
        "type": "DateTime"
      },
      {
        "name": "minutes",
        "type": "Int"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Warehouse",
    "label": "Склад",
    "group": "material",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Material",
    "label": "Материал",
    "group": "material",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "uom",
        "type": "String"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "StockMovement",
    "label": "Движение запасов",
    "group": "material",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "materialId",
        "type": "String",
        "fk": true
      },
      {
        "name": "warehouseId",
        "type": "String",
        "fk": true
      },
      {
        "name": "type",
        "type": "StockMovementType"
      },
      {
        "name": "qty",
        "type": "Float"
      },
      {
        "name": "eventId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "MaterialReservation",
    "label": "Резерв материала",
    "group": "material",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "materialId",
        "type": "String",
        "fk": true
      },
      {
        "name": "warehouseId",
        "type": "String",
        "fk": true
      },
      {
        "name": "qtyReserved",
        "type": "Float"
      },
      {
        "name": "needByDate",
        "type": "DateTime"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "MaterialIssue",
    "label": "Выдача материала",
    "group": "material",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "materialId",
        "type": "String",
        "fk": true
      },
      {
        "name": "warehouseId",
        "type": "String",
        "fk": true
      },
      {
        "name": "qtyIssued",
        "type": "Float"
      },
      {
        "name": "issuedAt",
        "type": "DateTime"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "User",
    "label": "Пользователь",
    "group": "auth",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "email",
        "type": "String",
        "unique": true
      },
      {
        "name": "displayName",
        "type": "String?"
      },
      {
        "name": "passwordHash",
        "type": "String"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "mustChangePassword",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      },
      {
        "name": "lastLoginAt",
        "type": "DateTime?"
      },
      {
        "name": "lastSeenAt",
        "type": "DateTime?"
      },
      {
        "name": "tokenVersion",
        "type": "Int"
      },
      {
        "name": "homePage",
        "type": "String?"
      },
      {
        "name": "mutedNotificationKinds",
        "type": "Json"
      },
      {
        "name": "dbAccessEnabled",
        "type": "Boolean"
      },
      {
        "name": "pgRoleName",
        "type": "String?"
      },
      {
        "name": "pgPassword",
        "type": "String?"
      }
    ]
  },
  {
    "id": "Sandbox",
    "label": "Песочница",
    "group": "sandbox",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "description",
        "type": "String?"
      },
      {
        "name": "status",
        "type": "SandboxStatus"
      },
      {
        "name": "ownerId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sharedWithAllRole",
        "type": "SandboxMemberRole?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "SandboxMember",
    "label": "Участник песочницы",
    "group": "sandbox",
    "columns": [
      {
        "name": "sandboxId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "userId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "role",
        "type": "SandboxMemberRole"
      },
      {
        "name": "addedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Role",
    "label": "Роль",
    "group": "auth",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "isSystem",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Permission",
    "label": "Право доступа",
    "group": "auth",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "UserRole",
    "label": "Роль пользователя",
    "group": "auth",
    "columns": [
      {
        "name": "userId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "roleId",
        "type": "String",
        "pk": true,
        "fk": true
      }
    ]
  },
  {
    "id": "RolePermission",
    "label": "Право роли",
    "group": "auth",
    "columns": [
      {
        "name": "roleId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "permissionId",
        "type": "String",
        "pk": true,
        "fk": true
      }
    ]
  },
  {
    "id": "Operator",
    "label": "Оператор (заказчик)",
    "group": "fleet",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "AircraftType",
    "label": "Тип ВС",
    "group": "fleet",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "icaoType",
        "type": "String?",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "manufacturer",
        "type": "String?"
      },
      {
        "name": "bodyType",
        "type": "BodyType?"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "AircraftTypePalette",
    "label": "Палитра оператор + тип ВС",
    "group": "fleet",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "operatorId",
        "type": "String",
        "fk": true
      },
      {
        "name": "aircraftTypeId",
        "type": "String",
        "fk": true
      },
      {
        "name": "color",
        "type": "String"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Aircraft",
    "label": "Борт (ВС)",
    "group": "fleet",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "tailNumber",
        "type": "String",
        "unique": true
      },
      {
        "name": "serialNumber",
        "type": "String?"
      },
      {
        "name": "manufactureDate",
        "type": "DateTime?"
      },
      {
        "name": "operatorId",
        "type": "String",
        "fk": true
      },
      {
        "name": "typeId",
        "type": "String",
        "fk": true
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventType",
    "label": "Тип события",
    "group": "fleet",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "color",
        "type": "String?"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventStatusCatalog",
    "label": "Каталог статусов",
    "group": "fleet",
    "columns": [
      {
        "name": "code",
        "type": "EventStatus",
        "pk": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "color",
        "type": "String?"
      },
      {
        "name": "sortOrder",
        "type": "Int"
      },
      {
        "name": "selectable",
        "type": "Boolean"
      },
      {
        "name": "allowsAutoInProgress",
        "type": "Boolean"
      },
      {
        "name": "manualOnly",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Workshop",
    "label": "Цех",
    "group": "fleet",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "defaultLineBase",
        "type": "EventLineBase?"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "Hangar",
    "label": "Ангар",
    "group": "hangar",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "station",
        "type": "String?"
      },
      {
        "name": "isPhysical",
        "type": "Boolean"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "HangarLayout",
    "label": "Схема расстановки",
    "group": "hangar",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "hangarId",
        "type": "String",
        "fk": true
      },
      {
        "name": "code",
        "type": "String"
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "description",
        "type": "String?"
      },
      {
        "name": "widthMeters",
        "type": "Float?"
      },
      {
        "name": "heightMeters",
        "type": "Float?"
      },
      {
        "name": "obstacles",
        "type": "Json?"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "HangarStand",
    "label": "Место стоянки",
    "group": "hangar",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "layoutId",
        "type": "String",
        "fk": true
      },
      {
        "name": "code",
        "type": "String"
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "bodyType",
        "type": "BodyType?"
      },
      {
        "name": "x",
        "type": "Float"
      },
      {
        "name": "y",
        "type": "Float"
      },
      {
        "name": "w",
        "type": "Float"
      },
      {
        "name": "h",
        "type": "Float"
      },
      {
        "name": "rotate",
        "type": "Float"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "HangarStandAircraftType",
    "label": "Совместимость места и типа ВС",
    "group": "hangar",
    "columns": [
      {
        "name": "standId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "aircraftTypeId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "PlacementPriorityRule",
    "label": "Правило приоритета места",
    "group": "hangar",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "hangarId",
        "type": "String",
        "fk": true
      },
      {
        "name": "layoutId",
        "type": "String",
        "fk": true
      },
      {
        "name": "standId",
        "type": "String",
        "fk": true
      },
      {
        "name": "priorityScore",
        "type": "Int"
      },
      {
        "name": "sourceEventName",
        "type": "String?"
      },
      {
        "name": "sourceAircraftTypeText",
        "type": "String?"
      },
      {
        "name": "conditionText",
        "type": "String?"
      },
      {
        "name": "comment",
        "type": "String?"
      },
      {
        "name": "source",
        "type": "String?"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "PlacementPriorityRuleEventType",
    "label": "Приоритет × тип события",
    "group": "hangar",
    "columns": [
      {
        "name": "ruleId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "eventTypeId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "PlacementPriorityRuleAircraftType",
    "label": "Приоритет × тип ВС",
    "group": "hangar",
    "columns": [
      {
        "name": "ruleId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "aircraftTypeId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "OptimizationProfile",
    "label": "Профиль оптимизации",
    "group": "hangar",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "code",
        "type": "String",
        "unique": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "description",
        "type": "String?"
      },
      {
        "name": "isDefault",
        "type": "Boolean"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "OptimizationScoreRule",
    "label": "Правило скоринга",
    "group": "hangar",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "profileId",
        "type": "String",
        "fk": true
      },
      {
        "name": "code",
        "type": "String"
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "category",
        "type": "OptimizationScoreCategory"
      },
      {
        "name": "scope",
        "type": "OptimizationScoreScope"
      },
      {
        "name": "value",
        "type": "Float"
      },
      {
        "name": "unit",
        "type": "OptimizationScoreUnit"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "MaintenanceEvent",
    "label": "Событие ТО",
    "group": "event",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "level",
        "type": "PlanningLevel"
      },
      {
        "name": "status",
        "type": "EventStatus"
      },
      {
        "name": "planningKind",
        "type": "EventPlanningKind"
      },
      {
        "name": "title",
        "type": "String"
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "aircraftId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "eventTypeId",
        "type": "String",
        "fk": true
      },
      {
        "name": "virtualAircraft",
        "type": "Json?"
      },
      {
        "name": "startAt",
        "type": "DateTime"
      },
      {
        "name": "endAt",
        "type": "DateTime"
      },
      {
        "name": "budgetStartAt",
        "type": "DateTime?"
      },
      {
        "name": "budgetEndAt",
        "type": "DateTime?"
      },
      {
        "name": "actualStartAt",
        "type": "DateTime?"
      },
      {
        "name": "actualEndAt",
        "type": "DateTime?"
      },
      {
        "name": "hangarId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "layoutId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "workshopId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "lineBase",
        "type": "EventLineBase?"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "allowOverlap",
        "type": "Boolean"
      },
      {
        "name": "originEventId",
        "type": "String?"
      },
      {
        "name": "sourceEventId",
        "type": "String?"
      },
      {
        "name": "sourceSandboxId",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventPrimaryExtension",
    "label": "Реквизиты первичной таблицы",
    "group": "eventExt",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true,
        "unique": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "fleetCode",
        "type": "String?"
      },
      {
        "name": "externalExecution",
        "type": "Boolean?"
      },
      {
        "name": "normalizedForm",
        "type": "String?"
      },
      {
        "name": "normalizedFormDetail",
        "type": "String?"
      },
      {
        "name": "stationCode",
        "type": "String?"
      },
      {
        "name": "phaseKind",
        "type": "String?"
      },
      {
        "name": "agreementStatus",
        "type": "String?"
      },
      {
        "name": "iiCCheckFact",
        "type": "Boolean?"
      },
      {
        "name": "wpNumberFact",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventCustomerSlot",
    "label": "Слот заказчика",
    "group": "eventExt",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true,
        "unique": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "startAt",
        "type": "DateTime?"
      },
      {
        "name": "endAt",
        "type": "DateTime?"
      },
      {
        "name": "dlFlag",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventSlotDeviation",
    "label": "Отклонение слота",
    "group": "eventExt",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "kind",
        "type": "String"
      },
      {
        "name": "reason",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventReportMetric",
    "label": "Метрика отчёта (блок/цех)",
    "group": "eventExt",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "block",
        "type": "PrimaryMetricBlock"
      },
      {
        "name": "department",
        "type": "PrimaryMetricDepartment"
      },
      {
        "name": "manHours",
        "type": "Decimal(18, 4)?"
      },
      {
        "name": "costAmount",
        "type": "Decimal(18, 4)?"
      },
      {
        "name": "currency",
        "type": "String?"
      },
      {
        "name": "source",
        "type": "PrimaryMetricSource"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventReportScalar",
    "label": "Скаляр отчёта",
    "group": "eventExt",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "metricKey",
        "type": "String"
      },
      {
        "name": "valueNum",
        "type": "Decimal(18, 4)?"
      },
      {
        "name": "valueText",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventPtoRollingEntry",
    "label": "Запись ПТО rolling",
    "group": "eventExt",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "externalKey",
        "type": "String?"
      },
      {
        "name": "status",
        "type": "String?"
      },
      {
        "name": "kippHours",
        "type": "Decimal(18, 4)?"
      },
      {
        "name": "laborTotal",
        "type": "Decimal(18, 4)?"
      },
      {
        "name": "amount",
        "type": "Decimal(18, 4)?"
      },
      {
        "name": "category",
        "type": "String?"
      },
      {
        "name": "comments",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventACheckAnalysis",
    "label": "Анализ A-check",
    "group": "eventExt",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true,
        "unique": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "status",
        "type": "String?"
      },
      {
        "name": "quantity",
        "type": "Int?"
      },
      {
        "name": "program",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventTechnicalPlan",
    "label": "Техплан ИТП",
    "group": "tech",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true,
        "unique": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "status",
        "type": "TechnicalPlanStatus"
      },
      {
        "name": "leadEngineer",
        "type": "String?"
      },
      {
        "name": "readinessPct",
        "type": "Int"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventTechnicalNeed",
    "label": "Потребность техплана",
    "group": "tech",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "planId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "category",
        "type": "TechnicalNeedCategory"
      },
      {
        "name": "description",
        "type": "String"
      },
      {
        "name": "quantity",
        "type": "String?"
      },
      {
        "name": "requiredAt",
        "type": "DateTime?"
      },
      {
        "name": "responsible",
        "type": "String?"
      },
      {
        "name": "status",
        "type": "TechnicalNeedStatus"
      },
      {
        "name": "isBlocker",
        "type": "Boolean"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventTechnicalStep",
    "label": "Этап техплана",
    "group": "tech",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "planId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "seq",
        "type": "Int"
      },
      {
        "name": "title",
        "type": "String"
      },
      {
        "name": "description",
        "type": "String?"
      },
      {
        "name": "responsible",
        "type": "String?"
      },
      {
        "name": "plannedStartAt",
        "type": "DateTime?"
      },
      {
        "name": "plannedEndAt",
        "type": "DateTime?"
      },
      {
        "name": "actualStartAt",
        "type": "DateTime?"
      },
      {
        "name": "actualEndAt",
        "type": "DateTime?"
      },
      {
        "name": "status",
        "type": "TechnicalStepStatus"
      },
      {
        "name": "progressPct",
        "type": "Int"
      },
      {
        "name": "isBlocker",
        "type": "Boolean"
      },
      {
        "name": "notes",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventTechnicalStepDependency",
    "label": "Зависимость этапов",
    "group": "tech",
    "columns": [
      {
        "name": "predecessorStepId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "successorStepId",
        "type": "String",
        "pk": true,
        "fk": true
      }
    ]
  },
  {
    "id": "EventPlacement",
    "label": "Этап размещения",
    "group": "event",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "origin",
        "type": "EventPlacementOrigin"
      },
      {
        "name": "startAt",
        "type": "DateTime"
      },
      {
        "name": "endAt",
        "type": "DateTime"
      },
      {
        "name": "budgetStartAt",
        "type": "DateTime?"
      },
      {
        "name": "budgetEndAt",
        "type": "DateTime?"
      },
      {
        "name": "actualStartAt",
        "type": "DateTime?"
      },
      {
        "name": "actualEndAt",
        "type": "DateTime?"
      },
      {
        "name": "hangarId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "layoutId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "standId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "sortOrder",
        "type": "Int"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "EventTow",
    "label": "Буксировка",
    "group": "event",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "startAt",
        "type": "DateTime"
      },
      {
        "name": "endAt",
        "type": "DateTime"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "AppNotification",
    "label": "Уведомление",
    "group": "comms",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "kind",
        "type": "String"
      },
      {
        "name": "title",
        "type": "String"
      },
      {
        "name": "body",
        "type": "String?"
      },
      {
        "name": "eventId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?"
      },
      {
        "name": "dedupeKey",
        "type": "String",
        "unique": true
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "AppNotificationRead",
    "label": "Прочтение уведомления",
    "group": "comms",
    "columns": [
      {
        "name": "notificationId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "userId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "readAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "AppAnnouncement",
    "label": "Объявление",
    "group": "comms",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "kind",
        "type": "String"
      },
      {
        "name": "title",
        "type": "String"
      },
      {
        "name": "body",
        "type": "String"
      },
      {
        "name": "startsAt",
        "type": "DateTime?"
      },
      {
        "name": "endsAt",
        "type": "DateTime?"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "createdById",
        "type": "String?",
        "fk": true
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "AppAnnouncementDismissal",
    "label": "Закрытие объявления",
    "group": "comms",
    "columns": [
      {
        "name": "announcementId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "userId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "dismissedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "MaintenanceEventAudit",
    "label": "Аудит события",
    "group": "event",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "action",
        "type": "EventAuditAction"
      },
      {
        "name": "actor",
        "type": "String"
      },
      {
        "name": "reason",
        "type": "String?"
      },
      {
        "name": "changes",
        "type": "Json?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "UserActivityLog",
    "label": "Журнал действий",
    "group": "analytics",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "userId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "actor",
        "type": "String"
      },
      {
        "name": "action",
        "type": "UserActivityAction"
      },
      {
        "name": "reason",
        "type": "String?"
      },
      {
        "name": "title",
        "type": "String?"
      },
      {
        "name": "sourceKind",
        "type": "String"
      },
      {
        "name": "sandboxId",
        "type": "String?"
      },
      {
        "name": "sandboxName",
        "type": "String?"
      },
      {
        "name": "changes",
        "type": "Json?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "UserPresenceEvent",
    "label": "Событие присутствия",
    "group": "analytics",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "userId",
        "type": "String",
        "fk": true
      },
      {
        "name": "kind",
        "type": "String"
      },
      {
        "name": "page",
        "type": "String?"
      },
      {
        "name": "detail",
        "type": "String?"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "MailDigestSettings",
    "label": "SMTP рассылки",
    "group": "comms",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "smtpHost",
        "type": "String?"
      },
      {
        "name": "smtpPort",
        "type": "Int"
      },
      {
        "name": "smtpSecure",
        "type": "Boolean"
      },
      {
        "name": "smtpUser",
        "type": "String?"
      },
      {
        "name": "smtpPass",
        "type": "String?"
      },
      {
        "name": "mailFrom",
        "type": "String?"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "MailDigestVariant",
    "label": "Вариант рассылки",
    "group": "comms",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "subjectTemplate",
        "type": "String"
      },
      {
        "name": "description",
        "type": "String?"
      },
      {
        "name": "recipients",
        "type": "Json"
      },
      {
        "name": "periodMode",
        "type": "String"
      },
      {
        "name": "periodCustomFrom",
        "type": "String?"
      },
      {
        "name": "periodCustomTo",
        "type": "String?"
      },
      {
        "name": "scheduleMode",
        "type": "String"
      },
      {
        "name": "scheduleTime",
        "type": "String"
      },
      {
        "name": "scheduleWeekdays",
        "type": "Json"
      },
      {
        "name": "scheduleMonthDay",
        "type": "Int"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "lastAutoSentAt",
        "type": "DateTime?"
      },
      {
        "name": "columns",
        "type": "Json"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "MailDigestSendLog",
    "label": "Журнал отправки",
    "group": "comms",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "variantId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "variantName",
        "type": "String?"
      },
      {
        "name": "status",
        "type": "String"
      },
      {
        "name": "target",
        "type": "String"
      },
      {
        "name": "actorEmail",
        "type": "String?"
      },
      {
        "name": "recipients",
        "type": "Json"
      },
      {
        "name": "subject",
        "type": "String"
      },
      {
        "name": "error",
        "type": "String?"
      },
      {
        "name": "stats",
        "type": "Json?"
      },
      {
        "name": "periodFrom",
        "type": "DateTime?"
      },
      {
        "name": "periodTo",
        "type": "DateTime?"
      }
    ]
  },
  {
    "id": "StandReservation",
    "label": "Резерв места стоянки",
    "group": "event",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "eventId",
        "type": "String",
        "fk": true
      },
      {
        "name": "placementId",
        "type": "String?",
        "fk": true,
        "unique": true
      },
      {
        "name": "sandboxId",
        "type": "String?",
        "fk": true
      },
      {
        "name": "layoutId",
        "type": "String",
        "fk": true
      },
      {
        "name": "standId",
        "type": "String",
        "fk": true
      },
      {
        "name": "startAt",
        "type": "DateTime"
      },
      {
        "name": "endAt",
        "type": "DateTime"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "SavedReport",
    "label": "Сохранённый отчёт",
    "group": "analytics",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "description",
        "type": "String?"
      },
      {
        "name": "ownerId",
        "type": "String",
        "fk": true
      },
      {
        "name": "sharedWithAllRole",
        "type": "ReportShareRole?"
      },
      {
        "name": "config",
        "type": "Json"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "SavedReportShare",
    "label": "Доступ к отчёту",
    "group": "analytics",
    "columns": [
      {
        "name": "reportId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "userId",
        "type": "String",
        "pk": true,
        "fk": true
      },
      {
        "name": "role",
        "type": "ReportShareRole"
      },
      {
        "name": "addedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "SavedTableView",
    "label": "Набор столбцов таблицы",
    "group": "auth",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "userId",
        "type": "String",
        "fk": true
      },
      {
        "name": "tableKey",
        "type": "String"
      },
      {
        "name": "name",
        "type": "String"
      },
      {
        "name": "isActive",
        "type": "Boolean"
      },
      {
        "name": "config",
        "type": "Json"
      },
      {
        "name": "createdAt",
        "type": "DateTime"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      }
    ]
  },
  {
    "id": "AppRuntimeConfig",
    "label": "Техрежим контура",
    "group": "analytics",
    "columns": [
      {
        "name": "id",
        "type": "String",
        "pk": true
      },
      {
        "name": "writeBlocked",
        "type": "Boolean"
      },
      {
        "name": "updatedAt",
        "type": "DateTime"
      },
      {
        "name": "updatedById",
        "type": "String?"
      }
    ]
  }
];

export const ER_EDGES: ErEdge[] = [
  {
    "from": "PersonSkill",
    "fromCol": "personId",
    "to": "Person",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PersonSkill",
    "fromCol": "skillId",
    "to": "Skill",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PersonUnavailability",
    "fromCol": "personId",
    "to": "Person",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventWorkPlanLine",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventWorkPlanLine",
    "fromCol": "shiftId",
    "to": "Shift",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventWorkPlanLine",
    "fromCol": "skillId",
    "to": "Skill",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventWorkPlanLine",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventWorkActualLine",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventWorkActualLine",
    "fromCol": "shiftId",
    "to": "Shift",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventWorkActualLine",
    "fromCol": "skillId",
    "to": "Skill",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventWorkActualLine",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "TimeEntry",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "TimeEntry",
    "fromCol": "personId",
    "to": "Person",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "TimeEntry",
    "fromCol": "skillId",
    "to": "Skill",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "TimeEntry",
    "fromCol": "shiftId",
    "to": "Shift",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "TimeEntry",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "StockMovement",
    "fromCol": "materialId",
    "to": "Material",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "StockMovement",
    "fromCol": "warehouseId",
    "to": "Warehouse",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "StockMovement",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "StockMovement",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaterialReservation",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaterialReservation",
    "fromCol": "materialId",
    "to": "Material",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaterialReservation",
    "fromCol": "warehouseId",
    "to": "Warehouse",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaterialReservation",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaterialIssue",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaterialIssue",
    "fromCol": "materialId",
    "to": "Material",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaterialIssue",
    "fromCol": "warehouseId",
    "to": "Warehouse",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaterialIssue",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "Sandbox",
    "fromCol": "ownerId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "SandboxMember",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "SandboxMember",
    "fromCol": "userId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "UserRole",
    "fromCol": "userId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "UserRole",
    "fromCol": "roleId",
    "to": "Role",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "RolePermission",
    "fromCol": "roleId",
    "to": "Role",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "RolePermission",
    "fromCol": "permissionId",
    "to": "Permission",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "AircraftTypePalette",
    "fromCol": "operatorId",
    "to": "Operator",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "AircraftTypePalette",
    "fromCol": "aircraftTypeId",
    "to": "AircraftType",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "Aircraft",
    "fromCol": "operatorId",
    "to": "Operator",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "Aircraft",
    "fromCol": "typeId",
    "to": "AircraftType",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "HangarLayout",
    "fromCol": "hangarId",
    "to": "Hangar",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "HangarStand",
    "fromCol": "layoutId",
    "to": "HangarLayout",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "HangarStandAircraftType",
    "fromCol": "standId",
    "to": "HangarStand",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "HangarStandAircraftType",
    "fromCol": "aircraftTypeId",
    "to": "AircraftType",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PlacementPriorityRule",
    "fromCol": "hangarId",
    "to": "Hangar",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PlacementPriorityRule",
    "fromCol": "layoutId",
    "to": "HangarLayout",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PlacementPriorityRule",
    "fromCol": "standId",
    "to": "HangarStand",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PlacementPriorityRuleEventType",
    "fromCol": "ruleId",
    "to": "PlacementPriorityRule",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PlacementPriorityRuleEventType",
    "fromCol": "eventTypeId",
    "to": "EventType",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PlacementPriorityRuleAircraftType",
    "fromCol": "ruleId",
    "to": "PlacementPriorityRule",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "PlacementPriorityRuleAircraftType",
    "fromCol": "aircraftTypeId",
    "to": "AircraftType",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "OptimizationScoreRule",
    "fromCol": "profileId",
    "to": "OptimizationProfile",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaintenanceEvent",
    "fromCol": "aircraftId",
    "to": "Aircraft",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaintenanceEvent",
    "fromCol": "eventTypeId",
    "to": "EventType",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaintenanceEvent",
    "fromCol": "hangarId",
    "to": "Hangar",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaintenanceEvent",
    "fromCol": "layoutId",
    "to": "HangarLayout",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaintenanceEvent",
    "fromCol": "workshopId",
    "to": "Workshop",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaintenanceEvent",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventPrimaryExtension",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "1:1"
  },
  {
    "from": "EventPrimaryExtension",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventCustomerSlot",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "1:1"
  },
  {
    "from": "EventCustomerSlot",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventSlotDeviation",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventSlotDeviation",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventReportMetric",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventReportMetric",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventReportScalar",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventReportScalar",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventPtoRollingEntry",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventPtoRollingEntry",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventACheckAnalysis",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "1:1"
  },
  {
    "from": "EventACheckAnalysis",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTechnicalPlan",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "1:1"
  },
  {
    "from": "EventTechnicalPlan",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTechnicalNeed",
    "fromCol": "planId",
    "to": "EventTechnicalPlan",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTechnicalNeed",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTechnicalStep",
    "fromCol": "planId",
    "to": "EventTechnicalPlan",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTechnicalStep",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTechnicalStepDependency",
    "fromCol": "predecessorStepId",
    "to": "EventTechnicalStep",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTechnicalStepDependency",
    "fromCol": "successorStepId",
    "to": "EventTechnicalStep",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventPlacement",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventPlacement",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventPlacement",
    "fromCol": "hangarId",
    "to": "Hangar",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventPlacement",
    "fromCol": "layoutId",
    "to": "HangarLayout",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventPlacement",
    "fromCol": "standId",
    "to": "HangarStand",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTow",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "EventTow",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "AppNotification",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "AppNotificationRead",
    "fromCol": "notificationId",
    "to": "AppNotification",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "AppNotificationRead",
    "fromCol": "userId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "AppAnnouncement",
    "fromCol": "createdById",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "AppAnnouncementDismissal",
    "fromCol": "announcementId",
    "to": "AppAnnouncement",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "AppAnnouncementDismissal",
    "fromCol": "userId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaintenanceEventAudit",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MaintenanceEventAudit",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "UserActivityLog",
    "fromCol": "userId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "UserPresenceEvent",
    "fromCol": "userId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "MailDigestSendLog",
    "fromCol": "variantId",
    "to": "MailDigestVariant",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "StandReservation",
    "fromCol": "eventId",
    "to": "MaintenanceEvent",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "StandReservation",
    "fromCol": "placementId",
    "to": "EventPlacement",
    "toCol": "id",
    "rel": "1:1"
  },
  {
    "from": "StandReservation",
    "fromCol": "layoutId",
    "to": "HangarLayout",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "StandReservation",
    "fromCol": "standId",
    "to": "HangarStand",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "StandReservation",
    "fromCol": "sandboxId",
    "to": "Sandbox",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "SavedReport",
    "fromCol": "ownerId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "SavedReportShare",
    "fromCol": "reportId",
    "to": "SavedReport",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "SavedReportShare",
    "fromCol": "userId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  },
  {
    "from": "SavedTableView",
    "fromCol": "userId",
    "to": "User",
    "toCol": "id",
    "rel": "N:1"
  }
];

export const ER_TABLE_BY_ID: Record<string, ErTable> = Object.fromEntries(ER_TABLES.map((t) => [t.id, t]));

export const ER_GROUP_BY_ID: Record<ErGroupId, (typeof ER_GROUPS)[number]> = Object.fromEntries(
  ER_GROUPS.map((g) => [g.id, g])
) as Record<ErGroupId, (typeof ER_GROUPS)[number]>;

export function searchErTables(query: string): { table: ErTable; viaColumn?: string }[] {
  const q = query.trim().toLowerCase();
  if (!q) return ER_TABLES.map((table) => ({ table }));
  const out: { table: ErTable; viaColumn?: string }[] = [];
  for (const table of ER_TABLES) {
    if (table.id.toLowerCase().includes(q) || table.label.toLowerCase().includes(q)) {
      out.push({ table });
      continue;
    }
    if (q.length < 3) continue;
    const col = table.columns.find((c) => c.name.toLowerCase().includes(q));
    if (col) out.push({ table, viaColumn: col.name });
  }
  return out;
}

export function edgesOfTable(tableId: string): ErEdge[] {
  return ER_EDGES.filter((e) => e.from === tableId || e.to === tableId);
}

export function neighborIds(tableId: string): string[] {
  const ids = new Set<string>();
  for (const e of edgesOfTable(tableId)) {
    ids.add(e.from === tableId ? e.to : e.from);
  }
  return [...ids];
}

