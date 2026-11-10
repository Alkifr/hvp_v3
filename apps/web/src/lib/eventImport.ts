import { apiPost } from "./api";
import { normalizeImportRowsDates } from "./localDate";

/** Пакеты короче типичного idle-timeout прокси (30–60 с UserGate). */
export const EVENT_IMPORT_CHUNK_SIZE = 50;
/** Предпросмотр быстрее записи — пакеты можно брать крупнее. */
export const EVENT_IMPORT_PREVIEW_CHUNK_SIZE = 250;

export type EventImportPreviewRow = {
  rowIndex: number;
  ok: boolean;
  title?: string;
  startAt?: string;
  endAt?: string;
  budgetStartAt?: string | null;
  budgetEndAt?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  towStartAt?: string | null;
  towEndAt?: string | null;
  deadlineAt?: string | null;
  aircraftTail?: string;
  aircraftId?: string | null;
  eventTypeKey?: string;
  eventTypeId?: string | null;
  hangar?: string | null;
  stand?: string | null;
  layout?: string | null;
  workshop?: string | null;
  lineBase?: "LINE" | "BASE" | null;
  eventStatusName?: string | null;
  warnings?: string[];
  error?: string;
};

export type EventImportPreviewResult = {
  ok: true;
  summary: {
    dryRun: boolean;
    totalRows: number;
    okRows: number;
    errorRows: number;
    wouldCreateEvents: number;
    wouldCreateReservations: number;
    wouldCreateTows: number;
  };
  rows: EventImportPreviewRow[];
};

export type EventImportWriteResult = {
  ok: true;
  createdEvents: number;
  createdReservations: number;
  createdTows: number;
  createdEventIds?: string[];
  errors: Array<{ rowIndex: number; message: string }>;
};

export type EventImportProgress = {
  mode: "preview" | "import";
  done: number;
  total: number;
  chunk: number;
  chunks: number;
  createdEvents?: number;
};

export class PartialEventImportError extends Error {
  partial: EventImportWriteResult;

  constructor(message: string, partial: EventImportWriteResult) {
    super(message);
    this.name = "PartialEventImportError";
    this.partial = partial;
  }
}

export function chunkImportRows<T>(rows: T[], size = EVENT_IMPORT_CHUNK_SIZE): T[][] {
  if (size < 1) return [rows];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

function emptyWriteResult(): EventImportWriteResult {
  return {
    ok: true,
    createdEvents: 0,
    createdReservations: 0,
    createdTows: 0,
    createdEventIds: [],
    errors: []
  };
}

/** Совпадает с предупреждением API. Клиент пересобирает его по всему файлу, а не по одному пакету. */
export const FILE_DUPLICATE_WARNING_PREFIX = "Вероятный дубль в файле:";
/** Общий префикс предупреждений о дубле в файле и в плане. */
export const PROBABLE_DUPLICATE_WARNING_PREFIX = "Вероятный дубль";

export function rowHasProbableDuplicate(row: { warnings?: string[] | null }): boolean {
  return (row.warnings ?? []).some((warning) => warning.startsWith(PROBABLE_DUPLICATE_WARNING_PREFIX));
}

const MAX_LISTED_DUPLICATES = 5;

function listWithMore(parts: string[], total: number): string {
  if (total <= parts.length) return parts.join(", ");
  return `${parts.join(", ")} и ещё ${total - parts.length}`;
}

/**
 * Вероятный дубль внутри файла: тот же борт, тот же тип события и пересечение оперативного периода.
 * Пакеты предпросмотра склеиваются здесь, чтобы пара из разных источников не разошлась по запросам.
 */
export function applyFileDuplicateWarnings(rows: EventImportPreviewRow[]): EventImportPreviewRow[] {
  const cleaned = rows.map((row) => ({
    ...row,
    warnings: (row.warnings ?? []).filter((warning) => !warning.startsWith(FILE_DUPLICATE_WARNING_PREFIX))
  }));
  const groups = new Map<string, number[]>();
  cleaned.forEach((row, index) => {
    if (!row.ok || !row.aircraftId || !row.eventTypeId || !row.startAt || !row.endAt) return;
    const key = `${row.aircraftId}\0${row.eventTypeId}`;
    const list = groups.get(key) ?? [];
    list.push(index);
    groups.set(key, list);
  });

  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const row = cleaned[index]!;
      const start = Date.parse(row.startAt!);
      const end = Date.parse(row.endAt!);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const partners = indexes.filter((other) => {
        if (other === index) return false;
        const partner = cleaned[other]!;
        const partnerStart = Date.parse(partner.startAt!);
        const partnerEnd = Date.parse(partner.endAt!);
        return Number.isFinite(partnerStart) && Number.isFinite(partnerEnd) && start < partnerEnd && end > partnerStart;
      });
      if (!partners.length) continue;
      const ordered = [...partners].sort((a, b) => cleaned[a]!.rowIndex - cleaned[b]!.rowIndex);
      const shown = ordered.slice(0, MAX_LISTED_DUPLICATES).map((other) => {
        const partner = cleaned[other]!;
        const title = partner.title?.trim();
        return title ? `${partner.rowIndex} «${title}»` : String(partner.rowIndex);
      });
      const tail = row.aircraftTail?.trim() ? ` ${row.aircraftTail.trim()}` : "";
      const rowsLabel = ordered.length === 1 ? "со строкой" : "со строками";
      const message = `${FILE_DUPLICATE_WARNING_PREFIX} борт${tail}, тот же тип события, пересекается ${rowsLabel} ${listWithMore(shown, ordered.length)}.`;
      row.warnings = [...(row.warnings ?? []), message];
    }
  }
  return cleaned;
}

function mergeWriteResults(acc: EventImportWriteResult, next: EventImportWriteResult) {
  acc.createdEvents += next.createdEvents ?? 0;
  acc.createdReservations += next.createdReservations ?? 0;
  acc.createdTows += next.createdTows ?? 0;
  acc.createdEventIds = [...(acc.createdEventIds ?? []), ...(next.createdEventIds ?? [])];
  acc.errors.push(...(next.errors ?? []));
}

export async function previewEventsInChunks(
  rows: Array<Record<string, unknown>>,
  onProgress?: (progress: EventImportProgress) => void
): Promise<EventImportPreviewResult> {
  const chunks = chunkImportRows(rows, EVENT_IMPORT_PREVIEW_CHUNK_SIZE);
  const mergedRows: EventImportPreviewRow[] = [];
  let wouldCreateEvents = 0;
  let wouldCreateReservations = 0;
  let wouldCreateTows = 0;
  let offset = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    onProgress?.({
      mode: "preview",
      done: offset,
      total: rows.length,
      chunk: i + 1,
      chunks: chunks.length
    });
    const res = await apiPost<EventImportPreviewResult>("/api/events/import", {
      dryRun: true,
      rowOffset: offset,
      rows: normalizeImportRowsDates(chunk)
    });
    mergedRows.push(...(res.rows ?? []));
    wouldCreateEvents += res.summary?.wouldCreateEvents ?? 0;
    wouldCreateReservations += res.summary?.wouldCreateReservations ?? 0;
    wouldCreateTows += res.summary?.wouldCreateTows ?? 0;
    offset += chunk.length;
  }

  onProgress?.({
    mode: "preview",
    done: rows.length,
    total: rows.length,
    chunk: chunks.length,
    chunks: chunks.length
  });

  const rowsWithDuplicates = applyFileDuplicateWarnings(mergedRows);
  const okRows = rowsWithDuplicates.filter((row) => row.ok).length;
  return {
    ok: true,
    summary: {
      dryRun: true,
      totalRows: rows.length,
      okRows,
      errorRows: rowsWithDuplicates.length - okRows,
      wouldCreateEvents,
      wouldCreateReservations,
      wouldCreateTows
    },
    rows: rowsWithDuplicates
  };
}

export async function importEventsInChunks(
  rows: Array<Record<string, unknown>>,
  onProgress?: (progress: EventImportProgress) => void
): Promise<EventImportWriteResult> {
  const chunks = chunkImportRows(rows);
  const acc = emptyWriteResult();
  let offset = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      onProgress?.({
        mode: "import",
        done: offset,
        total: rows.length,
        chunk: i + 1,
        chunks: chunks.length,
        createdEvents: acc.createdEvents
      });
      const res = await apiPost<EventImportWriteResult>("/api/events/import", {
        rowOffset: offset,
        ...(acc.createdEventIds?.length ? { ignoreEventIds: acc.createdEventIds } : {}),
        rows: normalizeImportRowsDates(chunk)
      });
      mergeWriteResults(acc, res);
      offset += chunk.length;
    }
  } catch (err: unknown) {
    if (acc.createdEvents > 0) {
      throw new PartialEventImportError(
        `${String((err as { message?: unknown })?.message ?? err)} Уже создано событий: ${acc.createdEvents}. Проверьте план и не импортируйте тот же файл целиком повторно.`,
        acc
      );
    }
    throw err;
  }

  onProgress?.({
    mode: "import",
    done: rows.length,
    total: rows.length,
    chunk: chunks.length,
    chunks: chunks.length,
    createdEvents: acc.createdEvents
  });

  return acc;
}
