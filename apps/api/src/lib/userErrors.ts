import { Prisma } from "@prisma/client";
import { z } from "zod";

/** Коды, которые API отдаёт в поле `error`. Сообщение для пользователя — всегда отдельно в `message`. */
export const UserMsg = {
  UNAUTHORIZED: "Требуется авторизация",
  INVALID_CREDENTIALS: "Неверный email или пароль",
  OLD_PASSWORD_INVALID: "Текущий пароль указан неверно",
  FORBIDDEN: "Недостаточно прав для выполнения операции",
  SANDBOX_NOT_FOUND: "Песочница не найдена",
  SANDBOX_ACCESS_DENIED: "Нет доступа к песочнице",
  SANDBOX_READ_ONLY: "Нет прав на запись в песочнице",
  SANDBOX_WRITE_DENIED: "Нет прав на запись в песочнице",
  PROMOTE_DELETE_DENIED: "Удаление событий рабочего контура при переносе доступно только главному администратору",
  MUST_CHANGE_PASSWORD: "Сначала смените временный пароль",
  TOO_MANY_REQUESTS: "Слишком много попыток входа. Подождите минуту и повторите",
  USER_NOT_FOUND: "Пользователь не найден",
  CANNOT_ADD_SELF: "Нельзя добавить самого себя",
  CANNOT_SHARE_SELF: "Нельзя поделиться с самим собой",
  REPORT_NOT_FOUND: "Отчёт не найден",
  REPORT_ACCESS_DENIED: "Нет доступа к отчёту",
  REPORT_EDIT_DENIED: "Недостаточно прав, чтобы изменить отчёт",
  REPORT_DELETE_DENIED: "Недостаточно прав, чтобы удалить отчёт",
  REPORT_SHARE_DENIED: "Недостаточно прав, чтобы поделиться отчётом",
  CONFIG_REQUIRED: "Заполните конфигурацию отчёта",
  COMPARE_SIDES_REQUIRED: "Для сравнения нужно выбрать обе стороны",
  TABLE_VIEW_NAME_TAKEN: "Представление с таким именем уже есть",
  TABLE_VIEW_NOT_FOUND: "Представление таблицы не найдено",
  PRIMARY_FIELDS_REQUIRED: "Выберите хотя бы одно поле таблицы",
  INVALID_CURSOR: "Некорректный курсор постраничной загрузки. Обновите таблицу.",
  EVENT_NOT_FOUND: "Событие не найдено",
  EVENTS_NOT_FOUND: "События не найдены",
  NOTIFICATION_NOT_FOUND: "Уведомление не найдено",
  PLAN_LINE_NOT_FOUND: "Строка плана не найдена",
  ACTUAL_LINE_NOT_FOUND: "Строка факта не найдена",
  STAND_NOT_FOUND: "Место стоянки не найдено",
  LAYOUT_NOT_FOUND: "Схема расстановки не найдена",
  DB_NOT_CONNECTED: "Нет соединения с базой данных. Повторите попытку позже или обратитесь к администратору.",
  END_AFTER_START: "Дата окончания должна быть позже даты начала",
  PERIOD_BOTH_DATES: "Заполните обе даты периода",
  BUDGET_BOTH_DATES: "Заполните обе даты бюджетного периода",
  BUDGET_END_AFTER_START: "Окончание бюджетного периода должно быть позже начала",
  ACTUAL_BOTH_DATES: "Заполните обе даты фактического периода",
  ACTUAL_END_AFTER_START: "Окончание фактического периода должно быть позже начала",
  TOW_WITHIN_EVENT: "Интервал буксировки должен быть внутри дат события",
  STAND_NOT_IN_LAYOUT: "Место не относится к выбранной схеме расстановки",
  LAYOUT_NOT_IN_HANGAR: "Схема расстановки не относится к выбранному ангару",
  PLACEMENT_END_AFTER_START: "Окончание этапа размещения должно быть позже начала",
  PLACEMENT_WITHIN_EVENT: "Этап размещения должен быть внутри дат события",
  PLACEMENT_NO_OVERLAP: "Этапы размещения не должны пересекаться",
  CHANGE_REASON_REQUIRED: "Укажите причину изменения",
  STEP_DEPENDENCY_INVALID: "Выбранные предшествующие шаги должны быть из того же плана",
  INVALID_DATE: "Укажите корректную дату",
  CADENCE_REQUIRED: "Для режима с фиксированным интервалом укажите шаг в часах",
  AIRCRAFT_REQUIRED: "Заполните борт",
  SANDBOX_SOURCE_REQUIRED: "Выберите песочницу-источник",
  FIELDS_OR_SUMMARY_REQUIRED: "Выберите поля отчёта или задайте группировку и агрегаты",
  INVALID_JSON: "Некорректный формат запроса",
  BODY_TOO_LARGE: "Слишком большой запрос. Уменьшите объём данных и повторите.",
  RECORD_NOT_FOUND: "Запись не найдена",
  RECORD_CONFLICT: "Такая запись уже существует",
  RECORD_IN_USE: "Нельзя изменить запись: она связана с другими данными",
  VALIDATION: "Проверьте заполненные поля",
  INTERNAL: "Не удалось выполнить операцию. Если ошибка повторяется, обратитесь к администратору."
} as const;

export type UserErrorCode = keyof typeof UserMsg;

const CODE_STATUS: Partial<Record<UserErrorCode, number>> = {
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  OLD_PASSWORD_INVALID: 400,
  FORBIDDEN: 403,
  SANDBOX_NOT_FOUND: 404,
  SANDBOX_ACCESS_DENIED: 403,
  SANDBOX_READ_ONLY: 403,
  SANDBOX_WRITE_DENIED: 403,
  PROMOTE_DELETE_DENIED: 403,
  MUST_CHANGE_PASSWORD: 403,
  TOO_MANY_REQUESTS: 429,
  USER_NOT_FOUND: 404,
  CANNOT_ADD_SELF: 400,
  CANNOT_SHARE_SELF: 400,
  REPORT_NOT_FOUND: 404,
  REPORT_ACCESS_DENIED: 403,
  REPORT_EDIT_DENIED: 403,
  REPORT_DELETE_DENIED: 403,
  REPORT_SHARE_DENIED: 403,
  CONFIG_REQUIRED: 400,
  COMPARE_SIDES_REQUIRED: 400,
  TABLE_VIEW_NAME_TAKEN: 409,
  TABLE_VIEW_NOT_FOUND: 404,
  PRIMARY_FIELDS_REQUIRED: 400,
  INVALID_CURSOR: 400,
  EVENT_NOT_FOUND: 404,
  EVENTS_NOT_FOUND: 404,
  NOTIFICATION_NOT_FOUND: 404,
  PLAN_LINE_NOT_FOUND: 404,
  ACTUAL_LINE_NOT_FOUND: 404,
  STAND_NOT_FOUND: 404,
  LAYOUT_NOT_FOUND: 404,
  DB_NOT_CONNECTED: 503,
  END_AFTER_START: 400,
  PERIOD_BOTH_DATES: 400,
  BUDGET_BOTH_DATES: 400,
  BUDGET_END_AFTER_START: 400,
  ACTUAL_BOTH_DATES: 400,
  ACTUAL_END_AFTER_START: 400,
  TOW_WITHIN_EVENT: 400,
  STAND_NOT_IN_LAYOUT: 400,
  LAYOUT_NOT_IN_HANGAR: 400,
  PLACEMENT_END_AFTER_START: 400,
  PLACEMENT_WITHIN_EVENT: 400,
  PLACEMENT_NO_OVERLAP: 400,
  CHANGE_REASON_REQUIRED: 400,
  STEP_DEPENDENCY_INVALID: 400,
  INVALID_DATE: 400,
  CADENCE_REQUIRED: 400,
  AIRCRAFT_REQUIRED: 400,
  SANDBOX_SOURCE_REQUIRED: 400,
  FIELDS_OR_SUMMARY_REQUIRED: 400,
  INVALID_JSON: 400,
  BODY_TOO_LARGE: 413,
  RECORD_NOT_FOUND: 404,
  RECORD_CONFLICT: 409,
  RECORD_IN_USE: 409,
  VALIDATION: 400,
  INTERNAL: 500
};

const ENGLISH_TO_CODE: Array<{ pattern: RegExp; code: UserErrorCode }> = [
  { pattern: /^event not found$/i, code: "EVENT_NOT_FOUND" },
  { pattern: /^events not found$/i, code: "EVENTS_NOT_FOUND" },
  { pattern: /^notification not found$/i, code: "NOTIFICATION_NOT_FOUND" },
  { pattern: /^plan line not found$/i, code: "PLAN_LINE_NOT_FOUND" },
  { pattern: /^actual line not found$/i, code: "ACTUAL_LINE_NOT_FOUND" },
  { pattern: /^stand not found$/i, code: "STAND_NOT_FOUND" },
  { pattern: /^layout not found$/i, code: "LAYOUT_NOT_FOUND" },
  { pattern: /^tow interval must be within event startat\/endat$/i, code: "TOW_WITHIN_EVENT" },
  { pattern: /^endat must be after startat$/i, code: "END_AFTER_START" },
  { pattern: /^to must be after from$/i, code: "END_AFTER_START" },
  { pattern: /^budget period must have both dates$/i, code: "BUDGET_BOTH_DATES" },
  { pattern: /^budgetendat must be after budgetstartat$/i, code: "BUDGET_END_AFTER_START" },
  { pattern: /^actual period must have both dates$/i, code: "ACTUAL_BOTH_DATES" },
  { pattern: /^actualendat must be after actualstartat$/i, code: "ACTUAL_END_AFTER_START" },
  { pattern: /^plannedendat must be after plannedstartat$/i, code: "END_AFTER_START" },
  { pattern: /^stand does not belong to selected layout$/i, code: "STAND_NOT_IN_LAYOUT" },
  { pattern: /^layout does not belong to selected hangar$/i, code: "LAYOUT_NOT_IN_HANGAR" },
  { pattern: /^placement endat must be after startat$/i, code: "PLACEMENT_END_AFTER_START" },
  { pattern: /^placement budget period must have both dates$/i, code: "BUDGET_BOTH_DATES" },
  { pattern: /^placement budgetendat must be after budgetstartat$/i, code: "BUDGET_END_AFTER_START" },
  { pattern: /^placement actual period must have both dates$/i, code: "ACTUAL_BOTH_DATES" },
  { pattern: /^placement actualendat must be after actualstartat$/i, code: "ACTUAL_END_AFTER_START" },
  { pattern: /^placement interval must be within event startat\/endat$/i, code: "PLACEMENT_WITHIN_EVENT" },
  { pattern: /^placement intervals must not overlap$/i, code: "PLACEMENT_NO_OVERLAP" },
  { pattern: /^changereason is required/i, code: "CHANGE_REASON_REQUIRED" },
  { pattern: /end must be after start/i, code: "END_AFTER_START" },
  { pattern: /^some predecessor steps are not in the same plan$/i, code: "STEP_DEPENDENCY_INVALID" },
  { pattern: /^unauthorized$/i, code: "UNAUTHORIZED" },
  { pattern: /^forbidden$/i, code: "FORBIDDEN" },
  { pattern: /^must_change_password$/i, code: "MUST_CHANGE_PASSWORD" },
  { pattern: /^too_many_requests$/i, code: "TOO_MANY_REQUESTS" },
  { pattern: /^promote_delete_denied$/i, code: "PROMOTE_DELETE_DENIED" }
];

const FASTIFY_CODE_TO_USER: Record<string, UserErrorCode> = {
  FST_ERR_CTP_INVALID_JSON_BODY: "INVALID_JSON",
  FST_ERR_CTP_EMPTY_JSON_BODY: "INVALID_JSON",
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: "INVALID_JSON",
  FST_ERR_CTP_BODY_TOO_LARGE: "BODY_TOO_LARGE"
};

const FIELD_LABELS: Record<string, string> = {
  startAt: "Дата начала",
  endAt: "Дата окончания",
  budgetStartAt: "Начало бюджетного периода",
  budgetEndAt: "Окончание бюджетного периода",
  actualStartAt: "Начало фактического периода",
  actualEndAt: "Окончание фактического периода",
  plannedStartAt: "Плановое начало",
  plannedEndAt: "Плановое окончание",
  changeReason: "Причина изменения",
  email: "Email",
  password: "Пароль",
  oldPassword: "Текущий пароль",
  newPassword: "Новый пароль",
  title: "Название",
  eventTypeId: "Тип события",
  aircraftId: "Борт",
  hangarId: "Ангар",
  layoutId: "Схема расстановки",
  standId: "Место",
  from: "Начало периода",
  to: "Окончание периода",
  startFrom: "Начало периода",
  endTo: "Окончание периода",
  cadenceHours: "Шаг расписания",
  fields: "Поля отчёта",
  sandboxId: "Песочница"
};

export type SerializedUserError = {
  statusCode: number;
  code: string;
  message: string;
  /** Неожиданный сбой: нужно уведомить администраторов. */
  notifyAdmins: boolean;
  /** Техническая деталь только для уведомления админам, не в ответ клиенту. */
  adminDetail?: string;
};

function hasCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

function isUserErrorCode(value: string): value is UserErrorCode {
  return Object.prototype.hasOwnProperty.call(UserMsg, value);
}

export function userMessageFor(codeOrText: string): string {
  const raw = String(codeOrText ?? "").trim();
  if (!raw) return UserMsg.INTERNAL;
  if (isUserErrorCode(raw)) return UserMsg[raw];
  for (const { pattern, code } of ENGLISH_TO_CODE) {
    if (pattern.test(raw)) return UserMsg[code];
  }
  if (hasCyrillic(raw)) return raw;
  return UserMsg.INTERNAL;
}

export function statusForCode(code: string, fallback = 400): number {
  if (isUserErrorCode(code) && CODE_STATUS[code] != null) return CODE_STATUS[code]!;
  return fallback;
}

/** Ответ для прямого `reply.code().send(...)`. */
export function errorBody(code: UserErrorCode, extra?: Record<string, unknown>) {
  return { ok: false as const, error: code, message: UserMsg[code], ...extra };
}

function fieldLabel(path: Array<string | number>): string | null {
  const names = path.filter((p): p is string => typeof p === "string" && !/^\d+$/.test(p));
  const last = names[names.length - 1];
  if (!last) return null;
  return FIELD_LABELS[last] ?? last;
}

export function formatZodIssues(issues: Array<{ path?: Array<string | number>; message?: string; code?: string }>): string {
  const parts: string[] = [];
  for (const issue of issues.slice(0, 8)) {
    const mapped = userMessageFor(String(issue.message ?? ""));
    const label = fieldLabel(issue.path ?? []);
    const text =
      mapped === UserMsg.INTERNAL && issue.message && !hasCyrillic(issue.message)
        ? UserMsg.VALIDATION
        : mapped;
    parts.push(label ? `${label}: ${text}` : text);
  }
  const unique = [...new Set(parts.filter(Boolean))];
  return unique.join(". ") || UserMsg.VALIDATION;
}

function isZodError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError || (err != null && typeof err === "object" && (err as { name?: string }).name === "ZodError");
}

function isConstructedAs(err: unknown, ctor: unknown): boolean {
  return typeof ctor === "function" && err instanceof (ctor as new (...args: never[]) => object);
}

function prismaKnownCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  if (isConstructedAs(err, Prisma.PrismaClientKnownRequestError)) {
    const code = (err as { code?: string }).code;
    return typeof code === "string" ? code : null;
  }
  const rec = err as { name?: string; code?: string };
  if (rec.name === "PrismaClientKnownRequestError" && typeof rec.code === "string") return rec.code;
  return null;
}

function isPrismaValidationError(err: unknown): err is { message: string } {
  if (isConstructedAs(err, Prisma.PrismaClientValidationError)) return true;
  return Boolean(err && typeof err === "object" && (err as { name?: string }).name === "PrismaClientValidationError");
}

function prismaUserError(err: unknown): SerializedUserError | null {
  const code = prismaKnownCode(err);
  if (code) {
    if (code === "P2002") {
      return { statusCode: 409, code: "RECORD_CONFLICT", message: UserMsg.RECORD_CONFLICT, notifyAdmins: false };
    }
    if (code === "P2003") {
      return { statusCode: 409, code: "RECORD_IN_USE", message: UserMsg.RECORD_IN_USE, notifyAdmins: false };
    }
    if (code === "P2025") {
      return { statusCode: 404, code: "RECORD_NOT_FOUND", message: UserMsg.RECORD_NOT_FOUND, notifyAdmins: false };
    }
    return {
      statusCode: 500,
      code: "INTERNAL",
      message: UserMsg.INTERNAL,
      notifyAdmins: true,
      adminDetail: `Prisma ${code}: ${(err as { message?: string }).message ?? ""}`
    };
  }
  if (isPrismaValidationError(err)) {
    return {
      statusCode: 500,
      code: "INTERNAL",
      message: UserMsg.INTERNAL,
      notifyAdmins: true,
      adminDetail: err.message
    };
  }
  return null;
}

function looksLikeConflict(message: string): boolean {
  return /уже занят|конфликт|пересека/i.test(message);
}

export function serializeUserError(err: unknown): SerializedUserError {
  const prisma = prismaUserError(err);
  if (prisma) return prisma;

  if (isZodError(err)) {
    return {
      statusCode: 400,
      code: "VALIDATION",
      message: formatZodIssues(err.issues as Array<{ path?: Array<string | number>; message?: string; code?: string }>),
      notifyAdmins: false
    };
  }

  const anyErr = err as {
    statusCode?: number;
    status?: number;
    code?: string;
    message?: string;
    name?: string;
  } | null;
  const rawMessage = String(anyErr?.message ?? err ?? "");
  const fastifyCode = typeof anyErr?.code === "string" ? anyErr.code : "";
  if (fastifyCode && FASTIFY_CODE_TO_USER[fastifyCode]) {
    const code = FASTIFY_CODE_TO_USER[fastifyCode]!;
    return {
      statusCode: statusForCode(code),
      code,
      message: UserMsg[code],
      notifyAdmins: false
    };
  }

  const fromEnglish = ENGLISH_TO_CODE.find(({ pattern }) => pattern.test(rawMessage));
  if (isUserErrorCode(rawMessage) || fromEnglish) {
    const code = (isUserErrorCode(rawMessage) ? rawMessage : fromEnglish!.code) as UserErrorCode;
    const statusCode = Number(anyErr?.statusCode ?? anyErr?.status ?? statusForCode(code));
    return {
      statusCode,
      code,
      message: UserMsg[code],
      notifyAdmins: statusCode >= 500
    };
  }

  const statusCode = Number(anyErr?.statusCode ?? anyErr?.status ?? 0);
  if (statusCode >= 400 && statusCode < 500) {
    const message = hasCyrillic(rawMessage) ? rawMessage : userMessageFor(rawMessage);
    return {
      statusCode,
      code:
        statusCode === 401
          ? "UNAUTHORIZED"
          : statusCode === 403
            ? "FORBIDDEN"
            : statusCode === 404
              ? "NOT_FOUND"
              : statusCode === 409
                ? "CONFLICT"
                : "BAD_REQUEST",
      message: message === UserMsg.INTERNAL && hasCyrillic(rawMessage) ? rawMessage : message,
      notifyAdmins: false
    };
  }

  if (!statusCode && hasCyrillic(rawMessage)) {
    return {
      statusCode: looksLikeConflict(rawMessage) ? 409 : 400,
      code: looksLikeConflict(rawMessage) ? "CONFLICT" : "BAD_REQUEST",
      message: rawMessage,
      notifyAdmins: false
    };
  }

  return {
    statusCode: statusCode >= 500 ? statusCode : 500,
    code: "INTERNAL",
    message: UserMsg.INTERNAL,
    notifyAdmins: true,
    adminDetail: rawMessage || anyErr?.name || "unknown error"
  };
}
