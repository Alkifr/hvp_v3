import {
  expandWorkshopAssignment,
  hangarCodesFromCell,
  tailDigits,
  type AircraftWorkshopDraft
} from "./aircraftWorkshopCatalog.js";

export type WorkshopImportChoice = "FIXED" | "PRIMARY" | "ALTERNATE";
export type WorkshopImportCheck = "A" | "C";

export type WorkshopImportSourceRow = {
  rowIndex: number;
  type: string;
  tail: string;
  workshop: string;
  operator: string;
  check: string;
  hangar: string;
  choice: string;
  dependsOnCustomerPlan: string;
  note: string;
};

export type WorkshopImportAircraft = {
  id: string;
  tailNumber: string;
  typeName: string;
  icaoType: string | null;
  operatorName: string;
  operatorCode: string;
};

export type WorkshopImportWorkshop = { id: string; code: string; name: string };
export type WorkshopImportHangar = { id: string; code: string; name: string };

export type WorkshopImportExisting = {
  aircraftId: string;
  checkKind: WorkshopImportCheck;
  workshopId: string;
  choice: WorkshopImportChoice;
  dependsOnCustomerPlan: boolean;
  note: string | null;
  hangarIds: string[];
};

export type WorkshopImportStatus = "create" | "update" | "unchanged" | "error";

export type WorkshopImportPreviewRow = {
  rowIndex: number;
  ok: boolean;
  status: WorkshopImportStatus;
  conflict: boolean;
  tail: string;
  check: string;
  workshop: string;
  hangar: string;
  message: string;
};

export type WorkshopImportAction = {
  aircraftId: string;
  checkKind: WorkshopImportCheck;
  workshopCode: string;
  choice: WorkshopImportChoice;
  dependsOnCustomerPlan: boolean;
  note: string | null;
  hangarIds: string[];
  mode: "create" | "update";
};

export type WorkshopImportSummary = {
  totalRows: number;
  createRows: number;
  updateRows: number;
  unchangedRows: number;
  errorRows: number;
  conflictRows: number;
  workshopsToCreate: string[];
};

export type WorkshopImportClassification = {
  rows: WorkshopImportPreviewRow[];
  actions: WorkshopImportAction[];
  summary: WorkshopImportSummary;
};

const CHOICE_LABEL: Record<WorkshopImportChoice, string> = {
  FIXED: "Фиксировано",
  PRIMARY: "Основное",
  ALTERNATE: "По плану заказчика"
};

const COLUMN_ALIASES = {
  tail: ["tail", "tailnumber", "aircraft", "board", "борт", "бортовойномер", "бортовой"],
  check: ["check", "checkkind", "форма", "видто", "вид"],
  workshop: ["workshop", "цех", "кодцеха"],
  hangar: ["hangar", "hangars", "ангар", "ангары"],
  choice: ["choice", "назначение"],
  dependsOnCustomerPlan: ["dependsoncustomerplan", "планзаказчика", "зависитотпланазаказчика"],
  note: ["note", "примечание", "комментарий"],
  type: ["type", "aircrafttype", "тип", "типвс"],
  operator: ["operator", "оператор"]
} as const;

function headerKey(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[\s_-]+/g, "");
}

function cellString(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).replace(/\u00A0/g, " ").trim();
}

function sameText(left: string, right: string) {
  return left.trim().toLocaleLowerCase("ru-RU") === right.trim().toLocaleLowerCase("ru-RU");
}

function cleanNote(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function parseCheck(value: string): WorkshopImportCheck | "empty" | "invalid" {
  const compact = value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/[\s._-]+/g, "");
  if (!compact) return "empty";
  if (compact === "a" || compact === "acheck" || compact === "а" || compact === "ачек") return "A";
  if (compact === "c" || compact === "ccheck" || compact === "с" || compact === "счек") return "C";
  return "invalid";
}

function parseChoice(value: string): WorkshopImportChoice | "empty" | "invalid" {
  const compact = value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/[\s._-]+/g, "");
  if (!compact) return "empty";
  if (["fixed", "фикс", "фиксировано", "фиксированное"].includes(compact)) return "FIXED";
  if (["primary", "основное", "основной"].includes(compact)) return "PRIMARY";
  if (["alternate", "запасной", "альтернативное", "попланузаказчика"].includes(compact)) return "ALTERNATE";
  return "invalid";
}

function parseBool(value: string): boolean | "empty" | "invalid" {
  const compact = value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
  if (!compact) return "empty";
  if (["1", "да", "yes", "true", "y"].includes(compact)) return true;
  if (["0", "нет", "no", "false", "n"].includes(compact)) return false;
  return "invalid";
}

function hangarNumber(hangar: WorkshopImportHangar) {
  const code = hangar.code.trim();
  if (/^h\d+$/i.test(code)) return code.slice(1);
  if (/^\d+$/.test(code)) return code;
  const fromName = hangar.name.match(/(\d+)/);
  if (/ангар/i.test(hangar.name) && fromName) return fromName[1]!;
  return "";
}

function findHangar(token: string, hangars: WorkshopImportHangar[]) {
  const norm = token.trim().toLocaleLowerCase("ru-RU");
  const direct = hangars.find(
    (hangar) => hangar.code.trim().toLocaleLowerCase("ru-RU") === norm || hangar.name.trim().toLocaleLowerCase("ru-RU") === norm
  );
  if (direct) return direct;
  const digits = token.replace(/\D/g, "");
  if (!digits) return null;
  return hangars.find((hangar) => hangarNumber(hangar) === digits || hangar.code.toUpperCase() === `H${digits}`) ?? null;
}

function hangarLabel(ids: string[], hangars: WorkshopImportHangar[]) {
  const byId = new Map(hangars.map((hangar) => [hangar.id, hangar]));
  const labels = ids.map((id) => {
    const hangar = byId.get(id);
    if (!hangar) return id;
    return hangarNumber(hangar) || hangar.code;
  });
  return labels.length ? labels.join(", ") : "—";
}

function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function checkLabel(check: WorkshopImportCheck) {
  return check === "C" ? "C-check" : "A-check";
}

export function readWorkshopImportRecords(records: Array<Record<string, unknown>>): { error: string } | { rows: WorkshopImportSourceRow[] } {
  const headers = new Set(records.flatMap((record) => Object.keys(record).map(headerKey)));
  const has = (aliases: readonly string[]) => aliases.some((alias) => headers.has(alias));
  if (!has(COLUMN_ALIASES.tail) || !has(COLUMN_ALIASES.check) || !has(COLUMN_ALIASES.workshop)) {
    return { error: "В файле нужны колонки: борт (tail), форма (check) и цех (workshop). Скачайте шаблон." };
  }
  const rows: WorkshopImportSourceRow[] = [];
  records.forEach((record, index) => {
    const cells = new Map(Object.entries(record).map(([key, value]) => [headerKey(key), value]));
    const pick = (aliases: readonly string[]) => {
      for (const alias of aliases) {
        if (cells.has(alias)) return cellString(cells.get(alias));
      }
      return "";
    };
    const row: WorkshopImportSourceRow = {
      rowIndex: index + 2,
      type: pick(COLUMN_ALIASES.type),
      tail: pick(COLUMN_ALIASES.tail),
      workshop: pick(COLUMN_ALIASES.workshop),
      operator: pick(COLUMN_ALIASES.operator),
      check: pick(COLUMN_ALIASES.check),
      hangar: pick(COLUMN_ALIASES.hangar),
      choice: pick(COLUMN_ALIASES.choice),
      dependsOnCustomerPlan: pick(COLUMN_ALIASES.dependsOnCustomerPlan),
      note: pick(COLUMN_ALIASES.note)
    };
    if (Object.values(row).some((value, fieldIndex) => fieldIndex > 0 && String(value).trim())) rows.push(row);
  });
  if (!rows.length) return { error: "В файле нет строк для импорта." };
  return { rows };
}

type ResolvedDraft = {
  rowIndex: number;
  tail: string;
  check: WorkshopImportCheck;
  workshopCode: string;
  aircraftId: string;
  hangarIds: string[];
  hangarText: string;
  choice: WorkshopImportChoice;
  dependsOnCustomerPlan: boolean;
  note: string | null;
  warnings: string[];
  createWorkshop: boolean;
};

function resolveHangarTokens(tokens: string[], hangars: WorkshopImportHangar[]) {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const token of tokens) {
    const hangar = findHangar(token, hangars);
    if (!hangar) missing.push(token);
    else if (!ids.includes(hangar.id)) ids.push(hangar.id);
  }
  return { ids, missing };
}

function draftsFromRow(
  row: WorkshopImportSourceRow,
  check: WorkshopImportCheck,
  choice: WorkshopImportChoice | "empty",
  depends: boolean | "empty",
  aircraftTypeName: string
): Array<{ draft: AircraftWorkshopDraft; warnings: string[] }> {
  const parts = row.workshop.split("/").map((part) => part.trim()).filter(Boolean);
  const source = {
    type: aircraftTypeName || row.type,
    tail: row.tail,
    workshop: row.workshop,
    operator: row.operator,
    check,
    hangar: row.hangar
  };
  if (parts.length > 1) {
    const expanded = expandWorkshopAssignment(source);
    const listed = hangarCodesFromCell(row.hangar);
    const slashHangarsDiffer = Boolean(row.hangar.trim()) && !(listed.length === 2 && listed.every((code) => code === "1" || code === "5"));
    return expanded.map((draft) => ({
      draft,
      warnings: [
        ...(slashHangarsDiffer ? [`Для цеха через слэш ангары всегда 1 и 5, в файле «${row.hangar.trim()}».`] : []),
        ...(choice !== "empty" ? ["Для цеха через слэш назначение задаётся автоматически."] : []),
        ...(depends !== "empty" ? ["Для цеха через слэш признак плана заказчика задаётся автоматически."] : [])
      ]
    }));
  }
  const [derived] = expandWorkshopAssignment(source);
  if (!derived) return [];
  const note = row.note.trim() ? cleanNote(row.note) : derived.note;
  return [
    {
      draft: {
        ...derived,
        choice: choice === "empty" ? derived.choice : choice,
        dependsOnCustomerPlan: depends === "empty" ? derived.dependsOnCustomerPlan : depends,
        note
      },
      warnings:
        depends === "empty" && derived.dependsOnCustomerPlan
          ? ["План заказчика включён: C-check 737 на ЦПТО5."]
          : []
    }
  ];
}

function matchAircraft(tail: string, aircraft: WorkshopImportAircraft[]): { aircraft: WorkshopImportAircraft } | { error: string } {
  const exact = aircraft.filter((row) => sameText(row.tailNumber.replace(/\s+/g, ""), tail.replace(/\s+/g, "")));
  if (exact.length === 1) return { aircraft: exact[0]! };
  if (exact.length > 1) return { error: `Несколько бортов «${tail}».` };
  const digits = tailDigits(tail);
  if (!digits) return { error: "В бортовом номере нет цифр." };
  const byDigits = aircraft.filter((row) => tailDigits(row.tailNumber) === digits);
  if (byDigits.length === 1) return { aircraft: byDigits[0]! };
  if (byDigits.length > 1) {
    return { error: `Несколько бортов с цифрами ${digits}: ${byDigits.map((row) => row.tailNumber).join(", ")}.` };
  }
  return { error: `Борт ${tail} не найден в справочнике бортов.` };
}

function findWorkshop(code: string, workshops: WorkshopImportWorkshop[]) {
  return (
    workshops.find((row) => sameText(row.code, code)) ??
    workshops.find((row) => sameText(row.name, code)) ??
    null
  );
}

export function classifyAircraftWorkshopImport(input: {
  rows: WorkshopImportSourceRow[];
  aircraft: WorkshopImportAircraft[];
  workshops: WorkshopImportWorkshop[];
  hangars: WorkshopImportHangar[];
  existing: WorkshopImportExisting[];
}): WorkshopImportClassification {
  const preview: WorkshopImportPreviewRow[] = [];
  const resolved: ResolvedDraft[] = [];
  const workshopsToCreate: string[] = [];
  const knownWorkshopCodes = new Set(input.workshops.map((row) => row.code.toLocaleUpperCase("ru-RU")));

  const pushError = (row: WorkshopImportSourceRow, message: string, workshop = "", hangar = "—") => {
    preview.push({
      rowIndex: row.rowIndex,
      ok: false,
      status: "error",
      conflict: false,
      tail: row.tail || "—",
      check: row.check || "—",
      workshop: workshop || row.workshop || "—",
      hangar,
      message
    });
  };

  for (const row of input.rows) {
    if (!row.tail.trim()) {
      pushError(row, "Не указан борт.");
      continue;
    }
    if (!row.workshop.trim()) {
      pushError(row, "Не указан цех.");
      continue;
    }
    const check = parseCheck(row.check);
    if (check === "empty") {
      pushError(row, "Не указана форма: A-check или C-check.");
      continue;
    }
    if (check === "invalid") {
      pushError(row, `Некорректная форма «${row.check}». Укажите A или C.`);
      continue;
    }
    const choice = parseChoice(row.choice);
    if (choice === "invalid") {
      pushError(row, `Некорректное назначение «${row.choice}». Допустимо: фиксировано, основное, по плану заказчика.`);
      continue;
    }
    const depends = parseBool(row.dependsOnCustomerPlan);
    if (depends === "invalid") {
      pushError(row, `Некорректный план заказчика «${row.dependsOnCustomerPlan}». Укажите да или нет.`);
      continue;
    }
    if (row.note.trim().length > 500) {
      pushError(row, "Примечание длиннее 500 символов.");
      continue;
    }
    const matched = matchAircraft(row.tail, input.aircraft);
    if ("error" in matched) {
      pushError(row, matched.error);
      continue;
    }
    const aircraft = matched.aircraft;
    const warnings: string[] = [];
    if (row.type.trim() && !sameText(row.type, aircraft.typeName) && !(aircraft.icaoType && sameText(row.type, aircraft.icaoType))) {
      warnings.push(`Тип в файле «${row.type.trim()}», у борта «${aircraft.typeName}».`);
    }
    if (
      row.operator.trim() &&
      !sameText(row.operator, aircraft.operatorName) &&
      !sameText(row.operator, aircraft.operatorCode)
    ) {
      warnings.push(`Оператор в файле «${row.operator.trim()}», у борта «${aircraft.operatorName}».`);
    }
    const expanded = draftsFromRow(row, check, choice, depends, aircraft.typeName);
    if (!expanded.length) {
      pushError(row, "Не удалось разобрать цех.");
      continue;
    }
    for (const item of expanded) {
      const tokens = row.workshop.includes("/")
        ? item.draft.hangarCodes
        : row.hangar
            .split(/[,;/]/)
            .map((part) => part.trim())
            .filter((part) => part && part !== "—" && part !== "-");
      const hangars = resolveHangarTokens(tokens, input.hangars);
      if (hangars.missing.length) {
        pushError(
          row,
          `Ангар не найден: ${hangars.missing.join(", ")}.`,
          item.draft.workshopCode,
          row.hangar || "—"
        );
        continue;
      }
      const workshop = findWorkshop(item.draft.workshopCode, input.workshops);
      const workshopCode = workshop?.code ?? item.draft.workshopCode.trim();
      if (!workshopCode || workshopCode.length > 64) {
        pushError(row, "Код цеха пустой или длиннее 64 символов.", item.draft.workshopCode);
        continue;
      }
      const createWorkshop = !workshop && !knownWorkshopCodes.has(workshopCode.toLocaleUpperCase("ru-RU"));
      if (createWorkshop) {
        knownWorkshopCodes.add(workshopCode.toLocaleUpperCase("ru-RU"));
        workshopsToCreate.push(workshopCode);
      }
      resolved.push({
        rowIndex: row.rowIndex,
        tail: aircraft.tailNumber,
        check,
        workshopCode,
        aircraftId: aircraft.id,
        hangarIds: hangars.ids,
        hangarText: hangarLabel(hangars.ids, input.hangars),
        choice: item.draft.choice,
        dependsOnCustomerPlan: item.draft.dependsOnCustomerPlan,
        note: cleanNote(item.draft.note),
        warnings: [...warnings, ...item.warnings, ...(createWorkshop ? [`Цех ${workshopCode} будет создан.`] : [])],
        createWorkshop
      });
    }
  }

  const seen = new Map<string, { rowIndex: number; signature: string }>();
  const existingByKey = new Map(
    input.existing.map((row) => [`${row.aircraftId}|${row.checkKind}|${row.workshopId}`, row])
  );
  const workshopByCode = new Map(input.workshops.map((row) => [row.code.toLocaleUpperCase("ru-RU"), row]));
  const actions: WorkshopImportAction[] = [];

  for (const draft of resolved) {
    const key = `${draft.aircraftId}|${draft.check}|${draft.workshopCode.toLocaleUpperCase("ru-RU")}`;
    const signature = JSON.stringify({
      hangarIds: [...draft.hangarIds].sort(),
      choice: draft.choice,
      dependsOnCustomerPlan: draft.dependsOnCustomerPlan,
      note: draft.note
    });
    const previous = seen.get(key);
    if (previous) {
      preview.push({
        rowIndex: draft.rowIndex,
        ok: false,
        status: "error",
        conflict: false,
        tail: draft.tail,
        check: checkLabel(draft.check),
        workshop: draft.workshopCode,
        hangar: draft.hangarText,
        message:
          previous.signature === signature
            ? `Повтор строки ${previous.rowIndex}: те же борт, форма и цех.`
            : `Конфликт со строкой ${previous.rowIndex}: те же борт, форма и цех, но другие ангар, назначение или примечание.`
      });
      continue;
    }
    seen.set(key, { rowIndex: draft.rowIndex, signature });

    const workshop = workshopByCode.get(draft.workshopCode.toLocaleUpperCase("ru-RU"));
    const current = workshop ? existingByKey.get(`${draft.aircraftId}|${draft.check}|${workshop.id}`) : undefined;
    let status: WorkshopImportStatus = "create";
    const messages = [...draft.warnings];
    if (!current) {
      messages.unshift("Новая привязка.");
    } else if (
      sameIds(current.hangarIds, draft.hangarIds) &&
      current.choice === draft.choice &&
      current.dependsOnCustomerPlan === draft.dependsOnCustomerPlan &&
      cleanNote(current.note) === draft.note
    ) {
      status = "unchanged";
      messages.unshift("Совпадает с текущей привязкой.");
    } else {
      status = "update";
      const changes: string[] = [];
      if (!sameIds(current.hangarIds, draft.hangarIds)) {
        changes.push(`ангар ${hangarLabel(current.hangarIds, input.hangars)} → ${draft.hangarText}`);
      }
      if (current.choice !== draft.choice) changes.push(`назначение ${CHOICE_LABEL[current.choice]} → ${CHOICE_LABEL[draft.choice]}`);
      if (current.dependsOnCustomerPlan !== draft.dependsOnCustomerPlan) {
        changes.push(`план заказчика ${current.dependsOnCustomerPlan ? "да" : "нет"} → ${draft.dependsOnCustomerPlan ? "да" : "нет"}`);
      }
      if (cleanNote(current.note) !== draft.note) changes.push("примечание изменится");
      messages.unshift(`Будет обновлено: ${changes.join("; ")}.`);
    }
    const extra = messages.filter(
      (message) =>
        message !== "Новая привязка." &&
        message !== "Совпадает с текущей привязкой." &&
        !message.startsWith("Будет обновлено") &&
        !message.startsWith("План заказчика включён")
    );
    preview.push({
      rowIndex: draft.rowIndex,
      ok: true,
      status,
      conflict: status === "update" || extra.length > 0,
      tail: draft.tail,
      check: checkLabel(draft.check),
      workshop: draft.workshopCode,
      hangar: draft.hangarText,
      message: messages.join(" ")
    });
    if (status === "create" || status === "update") {
      actions.push({
        aircraftId: draft.aircraftId,
        checkKind: draft.check,
        workshopCode: draft.workshopCode,
        choice: draft.choice,
        dependsOnCustomerPlan: draft.dependsOnCustomerPlan,
        note: draft.note,
        hangarIds: draft.hangarIds,
        mode: status
      });
    }
  }

  preview.sort((a, b) => a.rowIndex - b.rowIndex || a.workshop.localeCompare(b.workshop, "ru"));
  const summary: WorkshopImportSummary = {
    totalRows: preview.length,
    createRows: preview.filter((row) => row.status === "create").length,
    updateRows: preview.filter((row) => row.status === "update").length,
    unchangedRows: preview.filter((row) => row.status === "unchanged").length,
    errorRows: preview.filter((row) => row.status === "error").length,
    conflictRows: preview.filter((row) => row.conflict).length,
    workshopsToCreate
  };
  return { rows: preview, actions, summary };
}
