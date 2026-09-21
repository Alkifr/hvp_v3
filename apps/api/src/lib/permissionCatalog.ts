export type DjangoAction = "view" | "add" | "change" | "delete";

export type ContentTypeDef = {
  appLabel: string;
  appTitle: string;
  model: string;
  name: string;
  actions: DjangoAction[];
};

export type PermissionSeed = {
  code: string;
  name: string;
  appLabel: string;
  model: string;
  action: string;
  /** Скрыть в выборе группы: служебный/устаревший синоним. */
  hidden?: boolean;
};

const ACTION_TITLE: Record<DjangoAction, string> = {
  view: "Can view",
  add: "Can add",
  change: "Can change",
  delete: "Can delete"
};

export const CONTENT_TYPES: ContentTypeDef[] = [
  { appLabel: "auth", appTitle: "Пользователи и права", model: "User", name: "пользователь", actions: ["view", "add", "change", "delete"] },
  { appLabel: "auth", appTitle: "Пользователи и права", model: "Role", name: "группа", actions: ["view", "add", "change", "delete"] },
  { appLabel: "auth", appTitle: "Пользователи и права", model: "Permission", name: "право", actions: ["view"] },
  { appLabel: "sandbox", appTitle: "Песочницы", model: "Sandbox", name: "песочница", actions: ["view", "add", "change", "delete"] },
  { appLabel: "fleet", appTitle: "Флот и справочники ТО", model: "Operator", name: "оператор", actions: ["view", "add", "change", "delete"] },
  { appLabel: "fleet", appTitle: "Флот и справочники ТО", model: "AircraftType", name: "тип ВС", actions: ["view", "add", "change", "delete"] },
  { appLabel: "fleet", appTitle: "Флот и справочники ТО", model: "Aircraft", name: "борт", actions: ["view", "add", "change", "delete"] },
  { appLabel: "fleet", appTitle: "Флот и справочники ТО", model: "AircraftTypePalette", name: "палитра типа ВС", actions: ["view", "add", "change", "delete"] },
  { appLabel: "fleet", appTitle: "Флот и справочники ТО", model: "EventType", name: "тип события", actions: ["view", "add", "change", "delete"] },
  { appLabel: "fleet", appTitle: "Флот и справочники ТО", model: "EventStatusCatalog", name: "статус события", actions: ["view", "add", "change", "delete"] },
  { appLabel: "fleet", appTitle: "Флот и справочники ТО", model: "Workshop", name: "цех", actions: ["view", "add", "change", "delete"] },
  { appLabel: "hangar", appTitle: "Ангары и расстановка", model: "Hangar", name: "ангар", actions: ["view", "add", "change", "delete"] },
  { appLabel: "hangar", appTitle: "Ангары и расстановка", model: "HangarLayout", name: "схема расстановки", actions: ["view", "add", "change", "delete"] },
  { appLabel: "hangar", appTitle: "Ангары и расстановка", model: "HangarStand", name: "место стоянки", actions: ["view", "add", "change", "delete"] },
  { appLabel: "hangar", appTitle: "Ангары и расстановка", model: "PlacementPriorityRule", name: "правило приоритета", actions: ["view", "add", "change", "delete"] },
  { appLabel: "hangar", appTitle: "Ангары и расстановка", model: "OptimizationProfile", name: "профиль оптимизации", actions: ["view", "add", "change", "delete"] },
  { appLabel: "event", appTitle: "События и размещение", model: "MaintenanceEvent", name: "событие ТО", actions: ["view", "add", "change", "delete"] },
  { appLabel: "event", appTitle: "События и размещение", model: "EventPlacement", name: "размещение", actions: ["view", "add", "change", "delete"] },
  { appLabel: "event", appTitle: "События и размещение", model: "StandReservation", name: "резерв места", actions: ["view", "add", "change", "delete"] },
  { appLabel: "event", appTitle: "События и размещение", model: "EventTow", name: "буксировка", actions: ["view", "add", "change", "delete"] },
  { appLabel: "eventExt", appTitle: "Расширения события", model: "EventPrimaryExtension", name: "первичка события", actions: ["view", "add", "change", "delete"] },
  { appLabel: "eventExt", appTitle: "Расширения события", model: "EventCustomerSlot", name: "слот заказчика", actions: ["view", "add", "change", "delete"] },
  { appLabel: "tech", appTitle: "Техплан ИТП", model: "EventTechnicalPlan", name: "техплан", actions: ["view", "add", "change", "delete"] },
  { appLabel: "tech", appTitle: "Техплан ИТП", model: "EventTechnicalNeed", name: "потребность ИТП", actions: ["view", "add", "change", "delete"] },
  { appLabel: "tech", appTitle: "Техплан ИТП", model: "EventTechnicalStep", name: "шаг техплана", actions: ["view", "add", "change", "delete"] },
  { appLabel: "labor", appTitle: "Персонал и трудоёмкость", model: "Shift", name: "смена", actions: ["view", "add", "change", "delete"] },
  { appLabel: "labor", appTitle: "Персонал и трудоёмкость", model: "Person", name: "сотрудник цеха", actions: ["view", "add", "change", "delete"] },
  { appLabel: "labor", appTitle: "Персонал и трудоёмкость", model: "Skill", name: "квалификация", actions: ["view", "add", "change", "delete"] },
  { appLabel: "labor", appTitle: "Персонал и трудоёмкость", model: "EventWorkPlanLine", name: "строка плана трудоёмкости", actions: ["view", "add", "change", "delete"] },
  { appLabel: "labor", appTitle: "Персонал и трудоёмкость", model: "EventWorkActualLine", name: "строка факта трудоёмкости", actions: ["view", "add", "change", "delete"] },
  { appLabel: "labor", appTitle: "Персонал и трудоёмкость", model: "TimeEntry", name: "учёт времени", actions: ["view", "add", "change", "delete"] },
  { appLabel: "material", appTitle: "Материалы и склады", model: "Warehouse", name: "склад", actions: ["view", "add", "change", "delete"] },
  { appLabel: "material", appTitle: "Материалы и склады", model: "Material", name: "материал", actions: ["view", "add", "change", "delete"] },
  { appLabel: "material", appTitle: "Материалы и склады", model: "StockMovement", name: "движение запаса", actions: ["view", "add", "change", "delete"] },
  { appLabel: "material", appTitle: "Материалы и склады", model: "MaterialReservation", name: "резерв материала", actions: ["view", "add", "change", "delete"] },
  { appLabel: "material", appTitle: "Материалы и склады", model: "MaterialIssue", name: "выдача материала", actions: ["view", "add", "change", "delete"] },
  { appLabel: "comms", appTitle: "Уведомления и рассылка", model: "AppAnnouncement", name: "объявление", actions: ["view", "add", "change", "delete"] },
  { appLabel: "comms", appTitle: "Уведомления и рассылка", model: "MailDigestSettings", name: "настройки SMTP", actions: ["view", "change"] },
  { appLabel: "comms", appTitle: "Уведомления и рассылка", model: "MailDigestVariant", name: "вариант рассылки", actions: ["view", "add", "change", "delete"] },
  { appLabel: "analytics", appTitle: "Отчёты и журналы", model: "SavedReport", name: "отчёт", actions: ["view", "add", "change", "delete"] },
  { appLabel: "analytics", appTitle: "Отчёты и журналы", model: "SavedTableView", name: "представление таблицы", actions: ["view", "add", "change", "delete"] },
  { appLabel: "analytics", appTitle: "Отчёты и журналы", model: "MaintenanceEventAudit", name: "аудит события", actions: ["view"] },
  { appLabel: "analytics", appTitle: "Отчёты и журналы", model: "UserActivityLog", name: "журнал активности", actions: ["view"] }
];

export function djangoModelCode(action: string, model: string): string {
  return `${action}_${model.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

function crudSeed(): PermissionSeed[] {
  return CONTENT_TYPES.flatMap((ct) =>
    ct.actions.map((action) => ({
      code: djangoModelCode(action, ct.model),
      name: `${ACTION_TITLE[action]} ${ct.name}`,
      appLabel: ct.appLabel,
      model: ct.model,
      action
    }))
  );
}

/** Права экранов/модулей — как custom permissions Django на объекте модели. */
const SCREEN_PERMISSIONS: PermissionSeed[] = [
  { code: "gantt:read", name: "Can view план (Гантт)", appLabel: "event", model: "MaintenanceEvent", action: "view" },
  { code: "gantt:write", name: "Can change план (Гантт)", appLabel: "event", model: "MaintenanceEvent", action: "change" },
  { code: "hangar:read", name: "Can view ангар (схема)", appLabel: "event", model: "EventPlacement", action: "view" },
  { code: "hangar:write", name: "Can change ангар (схема)", appLabel: "event", model: "EventPlacement", action: "change" },
  { code: "analytics:read", name: "Can view аналитика", appLabel: "analytics", model: "SavedReport", action: "view" },
  { code: "itp:read", name: "Can view РМ ИТП", appLabel: "tech", model: "EventTechnicalPlan", action: "view" },
  { code: "tows:read", name: "Can view РМ Буксировки", appLabel: "event", model: "EventTow", action: "view" },
  { code: "tows:write", name: "Can change РМ Буксировки", appLabel: "event", model: "EventTow", action: "change" },
  { code: "import:write", name: "Can add события импортом", appLabel: "event", model: "MaintenanceEvent", action: "add" },
  { code: "admin:users", name: "Can change пользователи (админка)", appLabel: "auth", model: "User", action: "change" },
  { code: "admin:roles", name: "Can change группы (админка)", appLabel: "auth", model: "Role", action: "change" },
  { code: "admin:cleanup", name: "Can delete рабочий контур", appLabel: "event", model: "MaintenanceEvent", action: "delete" },
  { code: "admin:mail", name: "Can change SMTP", appLabel: "comms", model: "MailDigestSettings", action: "change" },
  { code: "mail:send", name: "Can add отправка рассылки", appLabel: "comms", model: "MailDigestVariant", action: "add" },
  { code: "resources:read", name: "Can view трудоёмкость", appLabel: "labor", model: "EventWorkPlanLine", action: "view" },
  { code: "resources:plan", name: "Can change план трудоёмкости", appLabel: "labor", model: "EventWorkPlanLine", action: "change" },
  { code: "resources:actual", name: "Can change факт трудоёмкости", appLabel: "labor", model: "EventWorkActualLine", action: "change" },
  { code: "workforce:read", name: "Can view персонал и смены", appLabel: "labor", model: "Person", action: "view" },
  { code: "workforce:write", name: "Can change персонал и смены", appLabel: "labor", model: "Person", action: "change" },
  { code: "warehouse:read", name: "Can view склад", appLabel: "material", model: "Material", action: "view" },
  { code: "warehouse:write", name: "Can change склад", appLabel: "material", model: "Material", action: "change" },
  { code: "events:read", name: "Can view событие ТО (данные)", appLabel: "event", model: "MaintenanceEvent", action: "view", hidden: true },
  { code: "events:write", name: "Can change событие ТО (данные)", appLabel: "event", model: "MaintenanceEvent", action: "change", hidden: true },
  { code: "ref:read", name: "Can view справочники (пакет)", appLabel: "fleet", model: "Aircraft", action: "view", hidden: true },
  { code: "ref:write", name: "Can change справочники (пакет)", appLabel: "fleet", model: "Aircraft", action: "change", hidden: true }
];

export const PERMISSION_SEED: PermissionSeed[] = [...crudSeed(), ...SCREEN_PERMISSIONS];

const MODULE_READS = ["gantt:read", "hangar:read", "analytics:read", "itp:read", "tows:read"] as const;
const MODULE_WRITES = ["gantt:write", "hangar:write", "import:write"] as const;

const WRITE_IMPLIES_READ: Record<string, string> = {
  "gantt:write": "gantt:read",
  "hangar:write": "hangar:read",
  "ref:write": "ref:read",
  "workforce:write": "workforce:read",
  "warehouse:write": "warehouse:read",
  "resources:plan": "resources:read",
  "resources:actual": "resources:read",
  "import:write": "gantt:read",
  "tows:write": "tows:read"
};

const REF_MODELS = [
  "Operator",
  "AircraftType",
  "Aircraft",
  "AircraftTypePalette",
  "EventType",
  "EventStatusCatalog",
  "Workshop",
  "Hangar",
  "HangarLayout",
  "HangarStand",
  "PlacementPriorityRule",
  "OptimizationProfile"
];

const WORKFORCE_MODELS = ["Shift", "Person", "Skill"];
const WAREHOUSE_MODELS = ["Warehouse", "Material", "StockMovement", "MaterialReservation", "MaterialIssue"];

function modelCodes(models: string[], actions: DjangoAction[]): string[] {
  return models.flatMap((model) =>
    CONTENT_TYPES.find((ct) => ct.model === model)?.actions.filter((a) => actions.includes(a)).map((a) => djangoModelCode(a, model)) ?? []
  );
}

export const PERMISSION_ALIASES: Record<string, string[]> = {
  "events:read": ["view_maintenanceevent"],
  "events:write": ["change_maintenanceevent", "add_maintenanceevent", "delete_maintenanceevent"],
  "ref:read": modelCodes(REF_MODELS, ["view"]),
  "ref:write": modelCodes(REF_MODELS, ["add", "change", "delete"]),
  "workforce:read": modelCodes(WORKFORCE_MODELS, ["view"]),
  "workforce:write": modelCodes(WORKFORCE_MODELS, ["add", "change", "delete"]),
  "warehouse:read": modelCodes(WAREHOUSE_MODELS, ["view"]),
  "warehouse:write": modelCodes(WAREHOUSE_MODELS, ["add", "change", "delete"]),
  "resources:read": ["view_eventworkplanline", "view_eventworkactualline", "view_timeentry"],
  "resources:plan": ["change_eventworkplanline", "add_eventworkplanline", "change_timeentry"],
  "resources:actual": ["change_eventworkactualline", "add_eventworkactualline"],
  "admin:users": ["view_user", "add_user", "change_user"],
  "admin:roles": ["view_role", "add_role", "change_role", "view_permission"],
  "admin:cleanup": ["delete_maintenanceevent"],
  "admin:mail": ["view_maildigestsettings", "change_maildigestsettings"],
  "mail:send": ["add_maildigestvariant", "change_maildigestvariant"]
};

function reverseAliases(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [legacy, codes] of Object.entries(PERMISSION_ALIASES)) {
    for (const code of codes) {
      const cur = map.get(code) ?? [];
      cur.push(legacy);
      map.set(code, cur);
    }
  }
  return map;
}

const REVERSE_ALIASES = reverseAliases();

export function expandPermissionCodes(selected: Iterable<string>): string[] {
  const set = new Set(selected);
  for (const [write, read] of Object.entries(WRITE_IMPLIES_READ)) {
    if (set.has(write)) set.add(read);
  }
  for (const code of [...set]) {
    const m = /^(add|change|delete)_(.+)$/.exec(code);
    if (m) set.add(`view_${m[2]}`);
  }
  const hasModule = MODULE_READS.some((c) => set.has(c)) || MODULE_WRITES.some((c) => set.has(c));
  if (hasModule) {
    if (MODULE_READS.some((c) => set.has(c))) {
      set.add("events:read");
      set.add("view_maintenanceevent");
    } else {
      set.delete("events:read");
    }
    if (MODULE_WRITES.some((c) => set.has(c))) {
      set.add("events:write");
      set.add("change_maintenanceevent");
    } else {
      set.delete("events:write");
    }
  }
  return [...set];
}

function isLegacyBundle(codes: Iterable<string>): boolean {
  const set = new Set(codes);
  return !MODULE_READS.some((c) => set.has(c)) && !MODULE_WRITES.some((c) => set.has(c));
}

export function displayPermissionCodes(stored: Iterable<string>): string[] {
  const set = new Set(stored);
  if (isLegacyBundle(set)) {
    if (set.has("events:read")) {
      for (const code of MODULE_READS) set.add(code);
    }
    if (set.has("events:write")) {
      for (const code of MODULE_WRITES) set.add(code);
    }
  }
  return [...set];
}

export function hasPermission(perms: Iterable<string> | null | undefined, code: string): boolean {
  const set = new Set(expandPermissionCodes(displayPermissionCodes(perms ?? [])));
  if (set.has(code)) return true;
  const aliased = PERMISSION_ALIASES[code];
  if (aliased?.some((c) => set.has(c))) return true;
  const reverse = REVERSE_ALIASES.get(code);
  if (reverse?.some((legacy) => set.has(legacy))) return true;
  return false;
}

export type PermissionOverrideEffect = "GRANT" | "DENY";

export function applyPermissionOverrides(
  roleCodes: Iterable<string>,
  overrides: Iterable<{ code: string; effect: PermissionOverrideEffect }>
): string[] {
  const grants: string[] = [];
  const denials = new Set<string>();
  for (const row of overrides) {
    if (row.effect === "GRANT") grants.push(row.code);
    else denials.add(row.code);
  }
  return expandPermissionCodes([...roleCodes, ...grants]).filter((code) => !denials.has(code));
}

export function diffPermissionOverrides(
  roleCodes: Iterable<string>,
  desiredCodes: Iterable<string>
): Array<{ code: string; effect: PermissionOverrideEffect }> {
  const roleSet = new Set(expandPermissionCodes(roleCodes));
  const desired = new Set(expandPermissionCodes(desiredCodes));
  const out: Array<{ code: string; effect: PermissionOverrideEffect }> = [];
  for (const code of desired) {
    if (!roleSet.has(code)) out.push({ code, effect: "GRANT" });
  }
  for (const code of roleSet) {
    if (!desired.has(code)) out.push({ code, effect: "DENY" });
  }
  return out;
}

export function djangoPermissionLabel(row: { appLabel?: string | null; model?: string | null; name: string; code: string }): string {
  const app = (row.appLabel ?? "").trim();
  const model = (row.model ?? "").trim();
  if (app && model) return `${app} | ${model} | ${row.name}`;
  return row.name || row.code;
}

export function isHiddenPermissionCode(code: string): boolean {
  return Boolean(PERMISSION_SEED.find((p) => p.code === code)?.hidden);
}

export function viewerModelCodes(): string[] {
  return CONTENT_TYPES.flatMap((ct) => (ct.actions.includes("view") ? [djangoModelCode("view", ct.model)] : []));
}

export function plannerModelCodes(): string[] {
  const writeApps = new Set(["sandbox", "fleet", "hangar", "event", "eventExt", "tech", "labor", "material", "analytics"]);
  const codes = viewerModelCodes();
  for (const ct of CONTENT_TYPES) {
    if (!writeApps.has(ct.appLabel) || ct.model === "User" || ct.model === "Role" || ct.model === "Permission") continue;
    for (const action of ct.actions) {
      if (action === "delete") continue;
      codes.push(djangoModelCode(action, ct.model));
    }
  }
  return [...new Set(codes)];
}
