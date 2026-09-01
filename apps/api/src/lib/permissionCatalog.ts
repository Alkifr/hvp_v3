const MODULE_READS = ["gantt:read", "hangar:read", "analytics:read", "itp:read"] as const;
const MODULE_WRITES = ["gantt:write", "hangar:write", "import:write"] as const;

export const PERMISSION_SEED: Array<{ code: string; name: string }> = [
  { code: "gantt:read", name: "План (Гантт): просмотр" },
  { code: "gantt:write", name: "План (Гантт): редактирование" },
  { code: "hangar:read", name: "Ангар (схема): просмотр" },
  { code: "hangar:write", name: "Ангар (схема): редактирование" },
  { code: "analytics:read", name: "Аналитика: просмотр" },
  { code: "itp:read", name: "РМ ИТП: просмотр" },
  { code: "import:write", name: "Импорт / массовое планирование: запуск" },
  { code: "events:read", name: "События: просмотр данных" },
  { code: "events:write", name: "События: изменение данных" },
  { code: "ref:read", name: "Справочники: просмотр" },
  { code: "ref:write", name: "Справочники: редактирование" },
  { code: "admin:users", name: "Администрирование: пользователи" },
  { code: "admin:roles", name: "Администрирование: роли" },
  { code: "admin:cleanup", name: "Администрирование: очистка контура" },
  { code: "admin:mail", name: "Администрирование: SMTP" },
  { code: "mail:send", name: "Рассылка: отправка" },
  { code: "resources:read", name: "Трудоёмкость: просмотр" },
  { code: "resources:plan", name: "Трудоёмкость: план / бюджет" },
  { code: "resources:actual", name: "Трудоёмкость: факт" },
  { code: "workforce:read", name: "Персонал и смены: просмотр" },
  { code: "workforce:write", name: "Персонал и смены: редактирование" },
  { code: "warehouse:read", name: "Склад: просмотр" },
  { code: "warehouse:write", name: "Склад: редактирование" }
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

export function expandPermissionCodes(selected: Iterable<string>): string[] {
  const set = new Set(selected);
  for (const [write, read] of Object.entries(WRITE_IMPLIES_READ)) {
    if (set.has(write)) set.add(read);
  }
  const hasModule = MODULE_READS.some((c) => set.has(c)) || MODULE_WRITES.some((c) => set.has(c));
  if (hasModule) {
    if (MODULE_READS.some((c) => set.has(c))) set.add("events:read");
    else set.delete("events:read");
    if (MODULE_WRITES.some((c) => set.has(c))) set.add("events:write");
    else set.delete("events:write");
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
  return new Set(expandPermissionCodes(displayPermissionCodes(perms ?? []))).has(code);
}
