import { hasPermission } from "./permissionCatalog";

export const HOME_PAGES = [
  "gantt",
  "hangar",
  "analytics",
  "itp",
  "import",
  "ref",
  "mail",
  "admin",
  "sandboxes",
  "help"
] as const;

export type HomePage = (typeof HOME_PAGES)[number];

export const HOME_PAGE_OPTIONS: Array<{
  id: HomePage;
  label: string;
  perm?: string | string[];
  desktopOnly?: boolean;
}> = [
  { id: "gantt", label: "План (Гантт)", perm: "gantt:read" },
  { id: "hangar", label: "Ангар (схема)", perm: "hangar:read" },
  { id: "analytics", label: "Аналитика", perm: "analytics:read" },
  { id: "itp", label: "РМ ИТП", perm: "itp:read", desktopOnly: true },
  { id: "import", label: "Импорт / план", perm: "import:write", desktopOnly: true },
  { id: "ref", label: "Справочники", perm: "ref:read", desktopOnly: true },
  { id: "mail", label: "Рассылка", perm: ["mail:send", "admin:mail"], desktopOnly: true },
  { id: "admin", label: "Админка", perm: ["admin:users", "admin:roles"], desktopOnly: true },
  { id: "sandboxes", label: "Песочницы" },
  { id: "help", label: "Инструкция" }
];

export const NOTIFICATION_KIND_OPTIONS: Array<{
  kind: string;
  label: string;
  hint: string;
  adminOnly?: boolean;
}> = [
  {
    kind: "EVENT_OVERDUE_NO_FACT",
    label: "Просрочка без факта",
    hint: "Оперативный период закончился, факт не заполнен"
  },
  {
    kind: "EVENT_STATUS_IN_PROGRESS",
    label: "Автостатус «В работе»",
    hint: "Событие само перешло в работу после оперативного начала"
  },
  {
    kind: "EVENT_STATUS_DONE",
    label: "Автостатус «Завершено»",
    hint: "Событие завершено после заполнения факта"
  },
  {
    kind: "USER_ERROR",
    label: "Ошибки пользователей",
    hint: "Сбои запросов — только администраторам",
    adminOnly: true
  }
];

export const PRESENCE_PAGE_LABEL: Record<string, string> = {
  gantt: "План (Гантт)",
  hangar: "Ангар",
  itp: "РМ ИТП",
  import: "Импорт",
  mass: "Массовое планирование",
  ref: "Справочники",
  profile: "Профиль",
  admin: "Админка",
  sandboxes: "Песочницы",
  analytics: "Аналитика",
  mail: "Рассылка",
  help: "Инструкция"
};

const HOME_SET = new Set<string>(HOME_PAGES);

function hasAnyPerm(permissions: string[], perm: string | string[] | undefined): boolean {
  if (!perm) return true;
  const list = Array.isArray(perm) ? perm : [perm];
  return list.some((code) => hasPermission(permissions, code));
}

export function parseHomePage(raw: unknown): HomePage | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v || v === "auto") return null;
  return HOME_SET.has(v) ? (v as HomePage) : null;
}

export function isHomePageAllowed(page: string, permissions: string[], isMobile: boolean): boolean {
  const opt = HOME_PAGE_OPTIONS.find((o) => o.id === page);
  if (!opt) return false;
  if (opt.desktopOnly && isMobile) return false;
  return hasAnyPerm(permissions, opt.perm);
}

export function firstAllowedPage(permissions: string[], isMobile: boolean): HomePage {
  for (const opt of HOME_PAGE_OPTIONS) {
    if (opt.id === "sandboxes") continue;
    if (isHomePageAllowed(opt.id, permissions, isMobile)) return opt.id;
  }
  return "help";
}

export function resolveStartPage(
  preferred: string | null | undefined,
  permissions: string[],
  isMobile: boolean
): HomePage {
  const home = parseHomePage(preferred);
  if (home && isHomePageAllowed(home, permissions, isMobile)) return home;
  return firstAllowedPage(permissions, isMobile);
}

export function allowedHomePageOptions(permissions: string[], isMobile: boolean) {
  return HOME_PAGE_OPTIONS.filter((opt) => isHomePageAllowed(opt.id, permissions, isMobile));
}

export function parseMutedNotificationKinds(raw: unknown): string[] {
  const allowed = new Set(NOTIFICATION_KIND_OPTIONS.map((o) => o.kind));
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const v = String(item ?? "").trim();
    if (!allowed.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export const APPLY_HOME_KEY = "hangarPlanning:applyHome";
