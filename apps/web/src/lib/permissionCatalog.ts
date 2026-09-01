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

const MODULE_READS = ["gantt:read", "hangar:read", "analytics:read", "itp:read"] as const;
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
  "import:write": "gantt:read"
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
  const hasModule = hasAny(MODULE_READS, set) || hasAny(MODULE_WRITES, set);
  if (hasModule) {
    if (hasAny(MODULE_READS, set)) set.add(IMPLIED_DATA_PERMS.read);
    else set.delete(IMPLIED_DATA_PERMS.read);
    if (hasAny(MODULE_WRITES, set)) set.add(IMPLIED_DATA_PERMS.write);
    else set.delete(IMPLIED_DATA_PERMS.write);
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
  return new Set(expandPermissionCodes(displayPermissionCodes(perms ?? []))).has(code);
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
  return parts.join(" · ") || "Нет доступа к модулям";
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
