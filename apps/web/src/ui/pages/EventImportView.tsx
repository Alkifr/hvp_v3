import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";

import { apiPost } from "../../lib/api";
import { useActiveSandbox } from "../components/SandboxSwitcher";

type ImportPreviewRow = {
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
  aircraftTail?: string;
  eventTypeKey?: string;
  hangar?: string | null;
  stand?: string | null;
  warnings?: string[];
  error?: string;
};

function normalizeHeaderKey(key: string) {
  return String(key ?? "").replace(/^\uFEFF/, "").trim();
}

function normalizeRows(rows: any[]) {
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row ?? {})) {
      next[normalizeHeaderKey(k)] = typeof v === "string" ? v.replace(/^\uFEFF/, "").trim() : v;
    }
    return next;
  });
}

function decodeCsv(buffer: ArrayBuffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  const cp1251 = new TextDecoder("windows-1251").decode(buffer);
  const replacementCount = (utf8.match(/\uFFFD/g) ?? []).length;
  const mojibakeCount = (utf8.match(/[ÐÑ][\u0080-\u00BF]/g) ?? []).length;
  return replacementCount > 0 || mojibakeCount > 1 ? cp1251 : utf8;
}

function formatImportDate(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.valueOf())) return value;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatImportPeriod(start?: string | null, end?: string | null) {
  if (!start && !end) return "—";
  return (
    <>
      {formatImportDate(start ?? undefined)}
      <br />
      <span className="muted">до {formatImportDate(end ?? undefined)}</span>
    </>
  );
}

export function EventImportView() {
  const qc = useQueryClient();
  const { active: activeSandbox } = useActiveSandbox();

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRows, setImportRows] = useState<any[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);

  const previewRows = ((importResult as any)?.rows ?? []) as ImportPreviewRow[];
  const resultErrors = (((importResult as any)?.errors ?? []) as Array<{ rowIndex: number; message: string }>);
  const warningRowsCount = previewRows.filter((row) => row.ok && (row.warnings?.length ?? 0) > 0).length;

  const previewM = useMutation({
    mutationFn: (rows: any[]) => apiPost("/api/events/import", { dryRun: true, rows }),
    onSuccess: (res) => {
      setImportResult(res);
    }
  });

  const importM = useMutation({
    mutationFn: (rows: any[]) => apiPost("/api/events/import", { rows }),
    onSuccess: async (res) => {
      setImportResult(res);
      // обновим все варианты запросов событий
      await qc.invalidateQueries({ queryKey: ["events"] });
      await qc.invalidateQueries({ queryKey: ["reservations"] });
      await qc.invalidateQueries({ queryKey: ["sandboxes"] });
    }
  });

  return (
    <div className="eventImportPage">
      <section className="massHero">
        <div className="massHeroText">
          <div className="massEyebrow">Загрузка данных</div>
          <h1>Импорт событий</h1>
          <p>
            Загружайте события из Excel/CSV, проверяйте сопоставления и конфликты в предпросмотре, затем переносите строки
            в текущий рабочий контур или активную песочницу.
          </p>
        </div>
        <div className="massHeroStats" aria-label="Параметры импорта">
          <span><b>{importRows?.length ?? 0}</b> строк</span>
          <span><b>{activeSandbox ? "Песочница" : "Рабочий контур"}</b></span>
          <span><b>{importResult ? "Есть предпросмотр" : "Ожидает файл"}</b></span>
        </div>
      </section>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="muted">
          Excel/CSV. Шапка: Operator, Aircraft, AircraftType, Event_Title, Event_name, startAt, endAt, budgetStartAt, budgetEndAt,
          actualStartAt, actualEndAt, towStartAt, towEndAt, Hangar, HangarStand. Периоды можно оставлять пустыми.
        </div>
        <div className={activeSandbox ? "contextNotice contextNoticeSandbox" : "contextNotice"}>
          {activeSandbox ? (
            <>
              <strong>Режим песочницы:</strong> импорт создаст события и резервы только в песочнице <b>{activeSandbox.name}</b>.
              Конфликты мест проверяются внутри этой песочницы, рабочий контур не изменится.
            </>
          ) : (
            <>
              <strong>Рабочий контур:</strong> импорт создаст события и резервы в основном плане.
            </>
          )}
        </div>

        <div className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="muted">Файл (.xlsx/.csv)</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0] ?? null;
                setImportFile(f);
                setImportRows(null);
                setImportResult(null);
                setImportError(null);
                if (!f) return;
                try {
                  if (f.name.toLowerCase().endsWith(".csv")) {
                    const text = decodeCsv(await f.arrayBuffer());
                    const wb = XLSX.read(text, { type: "string" });
                    const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
                    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
                    setImportRows(normalizeRows(rows));
                    return;
                  }
                  const buf = await f.arrayBuffer();
                  const wb = XLSX.read(buf, { type: "array", cellDates: true });
                  const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
                  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
                  setImportRows(normalizeRows(rows));
                } catch (err: any) {
                  setImportError(String(err?.message ?? err));
                }
              }}
              style={{ width: 620 }}
            />
          </label>

          <button
            className="btn btnPrimary"
            disabled={!importRows?.length || previewM.isPending}
            onClick={() => {
              if (!importRows?.length) return;
              previewM.mutate(importRows);
            }}
          >
            Предпросмотр
          </button>

          <button
            className="btn btnPrimary"
            disabled={!importRows?.length || importM.isPending || !(importResult as any)?.summary?.dryRun}
            onClick={() => {
              if (!importRows?.length) return;
              importM.mutate(importRows);
            }}
          >
            {activeSandbox ? "Импортировать в песочницу" : "Импортировать"}
          </button>

          {previewM.error || importM.error ? (
            <span className="error">
              {String(((previewM.error ?? importM.error) as any)?.message ?? previewM.error ?? importM.error)}
            </span>
          ) : null}
        </div>

        {importError ? <div className="error">{importError}</div> : null}
        {importFile ? (
          <div className="muted">
            Файл: <strong>{importFile.name}</strong> {importRows ? <>• строк к импорту: {importRows.length}</> : null}
          </div>
        ) : null}

        {importResult ? (
          <div className="eventImportResult">
            <div className="eventImportResultHead">
              <strong>Результат проверки</strong>
              {"summary" in (importResult as any) ? (
                <>
                  <span className="eventImportStat">режим: {(importResult as any).summary?.dryRun ? "предпросмотр" : "импорт"}</span>
                  <span className="eventImportStat eventImportStatOk">без ошибок: {(importResult as any).summary?.okRows ?? 0}</span>
                  {warningRowsCount > 0 ? <span className="eventImportStat eventImportStatWarn">предупреждений: {warningRowsCount}</span> : null}
                  <span className="eventImportStat eventImportStatError">с ошибками: {(importResult as any).summary?.errorRows ?? 0}</span>
                  <span className="eventImportStat">событий: {(importResult as any).summary?.wouldCreateEvents ?? 0}</span>
                  <span className="eventImportStat">резервов: {(importResult as any).summary?.wouldCreateReservations ?? 0}</span>
                  <span className="eventImportStat">буксировок: {(importResult as any).summary?.wouldCreateTows ?? 0}</span>
                </>
              ) : (
                <>
                  <span className="eventImportStat eventImportStatOk">создано событий: {(importResult as any).createdEvents ?? 0}</span>
                  <span className="eventImportStat">создано резервов: {(importResult as any).createdReservations ?? 0}</span>
                  <span className="eventImportStat">создано буксировок: {(importResult as any).createdTows ?? 0}</span>
                  <span className="eventImportStat eventImportStatError">ошибок: {resultErrors.length}</span>
                </>
              )}
            </div>

            {previewRows.length ? (
              <div className="eventImportTableWrap">
                <table className="table eventImportTable">
                  <thead>
                    <tr>
                      <th>Строка</th>
                      <th>Статус</th>
                      <th>Событие</th>
                      <th>Тип события</th>
                      <th>Борт</th>
                      <th>Период</th>
                      <th>Бюджетный период</th>
                      <th>Фактический период</th>
                      <th>Буксировка</th>
                      <th>Ангар / место</th>
                      <th>Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => {
                      const hasWarnings = row.ok && (row.warnings?.length ?? 0) > 0;
                      return (
                      <tr key={row.rowIndex} className={row.ok ? (hasWarnings ? "eventImportRowWarn" : "eventImportRowOk") : "eventImportRowError"}>
                        <td>{row.rowIndex}</td>
                        <td>
                          <span className={row.ok ? (hasWarnings ? "eventImportBadge eventImportBadgeWarn" : "eventImportBadge eventImportBadgeOk") : "eventImportBadge eventImportBadgeError"}>
                            {row.ok ? (hasWarnings ? "Предупреждение" : "Готово") : "Ошибка"}
                          </span>
                        </td>
                        <td>{row.title || "—"}</td>
                        <td>{row.eventTypeKey || "—"}</td>
                        <td>{row.aircraftTail || "—"}</td>
                        <td>
                          {formatImportPeriod(row.startAt, row.endAt)}
                        </td>
                        <td>{formatImportPeriod(row.budgetStartAt, row.budgetEndAt)}</td>
                        <td>{formatImportPeriod(row.actualStartAt, row.actualEndAt)}</td>
                        <td>{formatImportPeriod(row.towStartAt, row.towEndAt)}</td>
                        <td>
                          {row.hangar || "—"}
                          {row.stand ? <span className="muted"> / {row.stand}</span> : null}
                        </td>
                        <td className="eventImportMessageCell">
                          {row.error ? <div className="eventImportErrorText">{row.error}</div> : null}
                          {row.warnings?.length ? (
                            <div className="eventImportWarnings">
                              {row.warnings.map((w, idx) => (
                                <div key={idx}>{w}</div>
                              ))}
                            </div>
                          ) : row.ok ? (
                            <span className="muted">Можно импортировать</span>
                          ) : null}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : resultErrors.length ? (
              <div className="eventImportErrorsList">
                {resultErrors.map((err) => (
                  <div key={`${err.rowIndex}:${err.message}`} className="eventImportErrorText">
                    Строка {err.rowIndex}: {err.message}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="muted" style={{ display: "grid", gap: 6 }}>
          <div>
            Подсказка: сначала нажмите <strong>«Предпросмотр»</strong> — он покажет ошибки сопоставления/конфликтов, и только потом
            станет доступна кнопка <strong>«Импортировать»</strong>.
          </div>
          <div>
            После импорта откройте «План» — события появятся в выбранном диапазоне текущего контура.
          </div>
        </div>
      </div>
    </div>
  );
}

