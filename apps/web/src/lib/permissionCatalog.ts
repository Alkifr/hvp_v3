export type PermAction = { code: string; label: string };

export type PermGroup = {
  id: string;
  title: string;
  hint?: string;
  actions: PermAction[];
};

/** Права, которые выводятся из доступа к модулям и в матрице не показываются. */
export const IMPLIED_DATA_PERMS = {
  read: "events:read",
  write: "events:write"
} as const;

const MODULE_READS = ["gantt:read", "hangar:read", "analytics:read", "itp:read", "tows:read"] as const;
const MODULE_WRITES = ["gantt:write", "hangar:write", "import:write"] as const;

export const PERMISSION_GROUPS: PermGroup[] = [
  {
    id: "gantt",
    title: "План (Гантт)",
    hint: "Диаграмма и таблица событий",
    actions: [
      { code: "gantt:read", label: "Просмотр" },
      { code: "gantt:write", label: "Редактирование" }
    ]
  },
  {
    id: "hangar",
    title: "Ангар (схема)",
    hint: "Расстановка по местам",
    actions: [
      { code: "hangar:read", label: "Просмотр" },
      { code: "hangar:write", label: "Редактирование" }
    ]
  },
  {
    id: "analytics",
    title: "Аналитика",
    hint: "TAT, загрузка, конструктор отчётов",
    actions: [{ code: "analytics:read", label: "Просмотр" }]
  },
  {
    id: "itp",
    title: "РМ ИТП",
    actions: [{ code: "itp:read", label: "Просмотр" }]
  },
  {
    id: "tows",
    title: "РМ Буксировки",
    hint: "Реестр буксировок и выгрузка",
    actions: [
      { code: "tows:read", label: "Просмотр" },
      { code: "tows:write", label: "Редактирование" }
    ]
  },
  {
    id: "import",
    title: "Импорт / массовое планирование",
    actions: [{ code: "import:write", label: "Запуск" }]
  },
  {
    id: "ref",
    title: "Справочники",
    actions: [
      { code: "ref:read", label: "Просмотр" },
      { code: "ref:write", label: "Редактирование" }
    ]
  },
  {
    id: "resources",
    title: "Трудоёмкость",
    actions: [
      { code: "resources:read", label: "Просмотр" },
      { code: "resources:plan", label: "План / бюджет" },
      { code: "resources:actual", label: "Факт" }
    ]
  },
  {
    id: "workforce",
    title: "Персонал и смены",
    actions: [
      { code: "workforce:read", label: "Просмотр" },
      { code: "workforce:write", label: "Редактирование" }
    ]
  },
  {
    id: "warehouse",
    title: "Склад",
    actions: [
      { code: "warehouse:read", label: "Просмотр" },
      { code: "warehouse:write", label: "Редактирование" }
    ]
  },
  {
    id: "mail",
    title: "Рассылка",
    actions: [{ code: "mail:send", label: "Отправка" }]
  },
  {
    id: "admin",
    title: "Администрирование",
    actions: [
      { code: "admin:users", label: "Пользователи" },
      { code: "admin:roles", label: "Роли" },
      { code: "admin:mail", label: "SMTP" },
      { code: "admin:cleanup", label: "Очистка контура" }
    ]
  }
];

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

const PERMISSION_ALIASES: Record<string, string[]> = {
  "events:read": ["view_maintenanceevent"],
  "events:write": ["change_maintenanceevent", "add_maintenanceevent", "delete_maintenanceevent"],
  "ref:read": [
    "view_operator",
    "view_aircrafttype",
    "view_aircraft",
    "view_aircrafttypepalette",
    "view_eventtype",
    "view_eventstatuscatalog",
    "view_workshop",
    "view_hangar",
    "view_hangarlayout",
    "view_hangarstand",
    "view_placementpriorityrule",
    "view_optimizationprofile"
  ],
  "ref:write": [
    "add_operator",
    "change_operator",
    "delete_operator",
    "add_aircrafttype",
    "change_aircrafttype",
    "delete_aircrafttype",
    "add_aircraft",
    "change_aircraft",
    "delete_aircraft",
    "add_aircrafttypepalette",
    "change_aircrafttypepalette",
    "delete_aircrafttypepalette",
    "add_eventtype",
    "change_eventtype",
    "delete_eventtype",
    "add_eventstatuscatalog",
    "change_eventstatuscatalog",
    "delete_eventstatuscatalog",
    "add_workshop",
    "change_workshop",
    "delete_workshop",
    "add_hangar",
    "change_hangar",
    "delete_hangar",
    "add_hangarlayout",
    "change_hangarlayout",
    "delete_hangarlayout",
    "add_hangarstand",
    "change_hangarstand",
    "delete_hangarstand",
    "add_placementpriorityrule",
    "change_placementpriorityrule",
    "delete_placementpriorityrule",
    "add_optimizationprofile",
    "change_optimizationprofile",
    "delete_optimizationprofile"
  ],
  "workforce:read": ["view_shift", "view_person", "view_skill"],
  "workforce:write": [
    "add_shift",
    "change_shift",
    "delete_shift",
    "add_person",
    "change_person",
    "delete_person",
    "add_skill",
    "change_skill",
    "delete_skill"
  ],
  "warehouse:read": ["view_warehouse", "view_material", "view_stockmovement", "view_materialreservation", "view_materialissue"],
  "warehouse:write": [
    "add_warehouse",
    "change_warehouse",
    "delete_warehouse",
    "add_material",
    "change_material",
    "delete_material"
  ],
  "admin:users": ["view_user", "add_user", "change_user"],
  "admin:roles": ["view_role", "add_role", "change_role", "view_permission"]
};

export const PERM_LABEL: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => [a.code, `${g.title}: ${a.label}`])).concat([
    [IMPLIED_DATA_PERMS.read, "События: просмотр данных"],
    [IMPLIED_DATA_PERMS.write, "События: изменение данных"]
  ])
);

function hasAny(codes: readonly string[], set: Set<string>): boolean {
  return codes.some((c) => set.has(c));
}

/** Роль ещё без модульных прав — старый events:read/write открывает все связанные модули. */
function isLegacyBundle(codes: Iterable<string>): boolean {
  const set = new Set(codes);
  return !hasAny(MODULE_READS, set) && !hasAny(MODULE_WRITES, set);
}

export function expandPermissionCodes(selected: Iterable<string>): string[] {
  const set = new Set(selected);
  for (const [write, read] of Object.entries(WRITE_IMPLIES_READ)) {
    if (set.has(write)) set.add(read);
  }
  for (const code of [...set]) {
    const m = /^(add|change|delete)_(.+)$/.exec(code);
    if (m) set.add(`view_${m[2]}`);
  }
  const hasModule = hasAny(MODULE_READS, set) || hasAny(MODULE_WRITES, set);
  if (hasModule) {
    if (hasAny(MODULE_READS, set)) {
      set.add(IMPLIED_DATA_PERMS.read);
      set.add("view_maintenanceevent");
    } else set.delete(IMPLIED_DATA_PERMS.read);
    if (hasAny(MODULE_WRITES, set)) {
      set.add(IMPLIED_DATA_PERMS.write);
      set.add("change_maintenanceevent");
    } else set.delete(IMPLIED_DATA_PERMS.write);
  }
  return [...set];
}

/** Коды, которые нужно отметить в матрице по сохранённой роли. */
export function displayPermissionCodes(stored: Iterable<string>): string[] {
  const set = new Set(stored);
  if (isLegacyBundle(set)) {
    if (set.has(IMPLIED_DATA_PERMS.read)) {
      for (const code of MODULE_READS) set.add(code);
    }
    if (set.has(IMPLIED_DATA_PERMS.write)) {
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
  for (const [legacy, codes] of Object.entries(PERMISSION_ALIASES)) {
    if (codes.includes(code) && set.has(legacy)) return true;
  }
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

function selectedActionLabels(group: PermGroup, selected: Set<string>): string[] {
  const chosen = group.actions.filter((action) => selected.has(action.code));
  const implied = new Set(
    chosen.map((action) => WRITE_IMPLIES_READ[action.code]).filter((code): code is string => Boolean(code))
  );
  return chosen.filter((action) => !implied.has(action.code)).map((action) => action.label.toLowerCase());
}

/** Кратко по одному модулю: «редактирование», «просмотр» или «нет доступа». */
export function summarizeGroupAccess(group: PermGroup, stored: Iterable<string>): string {
  const labels = selectedActionLabels(group, new Set(displayPermissionCodes(stored)));
  return labels.length === 0 ? "нет доступа" : labels.join(", ");
}

/** Одна строка про роль целиком, без служебных events:*. */
export function summarizeRolePermissions(stored: Iterable<string>): string {
  const shown = new Set(displayPermissionCodes(stored));
  const parts: string[] = [];
  for (const group of PERMISSION_GROUPS) {
    const labels = selectedActionLabels(group, shown);
    if (labels.length === 0) continue;
    if (labels.length === 1 && labels[0] === "просмотр") parts.push(group.title);
    else parts.push(`${group.title}: ${labels.join(", ")}`);
  }
  const models = new Set<string>();
  for (const code of shown) {
    const m = /^(view|add|change|delete)_([a-z0-9]+)$/.exec(code);
    if (m) models.add(m[2]);
  }
  if (parts.length === 0 && models.size > 0) {
    return `Объекты данных: ${models.size}`;
  }
  if (models.size > 0) parts.push(`модели: ${models.size}`);
  return parts.join(" · ") || "Нет доступа к модулям";
}

export function djangoPermissionLabel(row: { appLabel?: string | null; model?: string | null; name: string; code: string }): string {
  const app = (row.appLabel ?? "").trim();
  const model = (row.model ?? "").trim();
  if (app && model) return `${app} | ${model} | ${row.name}`;
  return row.name || row.code;
}

export function isHiddenPermissionCode(code: string): boolean {
  return code === "events:read" || code === "events:write" || code === "ref:read" || code === "ref:write";
}

/** Сколько модулей матрицы имеют хотя бы одно право. */
export function grantedGroupCount(stored: Iterable<string>): number {
  const shown = new Set(displayPermissionCodes(stored));
  return PERMISSION_GROUPS.filter((group) => selectedActionLabels(group, shown).length > 0).length;
}

/** Читаемые названия прав, которые видны в матрице (без служебных events:*). */
export function matrixPermissionLabels(stored: Iterable<string>): string[] {
  const shown = new Set(displayPermissionCodes(stored));
  return PERMISSION_GROUPS.flatMap((group) =>
    group.actions.filter((action) => shown.has(action.code)).map((action) => `${group.title}: ${action.label}`)
  );
}

export function permissionIdsFromCodes(codes: Iterable<string>, catalog: Array<{ id: string; code: string }>): string[] {
  const byCode = new Map(catalog.map((p) => [p.code, p.id]));
  return [...new Set(codes)].map((code) => byCode.get(code)).filter((id): id is string => Boolean(id));
}

export function permissionCodesFromIds(ids: Iterable<string>, catalog: Array<{ id: string; code: string }>): string[] {
  const byId = new Map(catalog.map((p) => [p.id, p.code]));
  return [...new Set(ids)].map((id) => byId.get(id)).filter((code): code is string => Boolean(code));
}

export type NavPreviewItem = { id: string; label: string };

/** Пункты бокового меню, которые увидит человек с этими правами (десктоп, без песочного override). */
export function previewNavItems(perms: Iterable<string>): NavPreviewItem[] {
  const items: NavPreviewItem[] = [];
  if (hasPermission(perms, "gantt:read")) items.push({ id: "gantt", label: "План" });
  if (hasPermission(perms, "hangar:read")) items.push({ id: "hangar", label: "Ангар" });
  if (hasPermission(perms, "analytics:read")) items.push({ id: "analytics", label: "Аналитика" });
  if (hasPermission(perms, "itp:read")) items.push({ id: "itp", label: "РМ ИТП" });
  if (hasPermission(perms, "tows:read")) items.push({ id: "tows", label: "РМ Буксировки" });
  if (hasPermission(perms, "mail:send") || hasPermission(perms, "admin:mail")) items.push({ id: "mail", label: "Рассылка" });
  if (hasPermission(perms, "import:write")) items.push({ id: "import", label: "Импорт/План" });
  if (hasPermission(perms, "ref:read")) items.push({ id: "ref", label: "Справочники" });
  items.push({ id: "sandboxes", label: "Песочницы" });
  items.push({ id: "help", label: "Инструкция" });
  items.push({ id: "profile", label: "Профиль" });
  if (hasPermission(perms, "admin:users") || hasPermission(perms, "admin:roles")) items.push({ id: "admin", label: "Админка" });
  return items;
}

export function previewNavLabels(perms: Iterable<string>): string {
  return previewNavItems(perms)
    .map((item) => item.label)
    .join(" · ");
}

export function nextCloneRoleCode(code: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = code.trim() || "ROLE";
  const base = `${stem}_COPY`.slice(0, 32);
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const suffix = `_COPY${i}`;
    const next = `${stem.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
    if (!used.has(next)) return next;
  }
  return `${stem.slice(0, 24)}_${Date.now().toString(36).slice(-7)}`.slice(0, 32);
}
