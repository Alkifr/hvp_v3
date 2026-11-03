import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as XLSX from "xlsx";

import { apiPost } from "../../lib/api";
import { downloadAircraftWorkshopTemplate } from "../../lib/importTemplates";

type PreviewRow = {
  rowIndex: number;
  ok: boolean;
  status: "create" | "update" | "unchanged" | "error";
  conflict: boolean;
  tail: string;
  check: string;
  workshop: string;
  hangar: string;
  message: string;
};

type ImportResult = {
  summary?: {
    dryRun?: boolean;
    createRows?: number;
    updateRows?: number;
    unchangedRows?: number;
    errorRows?: number;
    conflictRows?: number;
    workshopsToCreate?: string[];
  };
  created?: number;
  updated?: number;
  workshopsCreated?: string[];
  rows?: PreviewRow[];
};

function dataSheet(workbook: XLSX.WorkBook) {
  const named = workbook.SheetNames.find((name) => name.trim().toLocaleLowerCase("ru-RU") === "данные");
  const fallback = workbook.SheetNames.find((name) => name.trim().toLocaleLowerCase("ru-RU") !== "инструкция");
  return workbook.Sheets[named ?? fallback ?? workbook.SheetNames[0] ?? ""];
}

function statusLabel(row: PreviewRow) {
  if (row.status === "error") return "Ошибка";
  if (row.conflict) return "Конфликт";
  if (row.status === "create") return "Создать";
  if (row.status === "update") return "Конфликт";
  return "Без изменений";
}

export function AdminWorkshopImportPanel() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const importM = useMutation({
    mutationFn: (payload: { dryRun?: boolean; rows: Array<Record<string, unknown>> }) =>
      apiPost<ImportResult>("/api/ref/aircraft-workshops/import", payload),
    onSuccess: async (res) => {
      setResult(res);
      setLocalError(null);
      setShowAll((res.summary?.errorRows ?? 0) + (res.summary?.conflictRows ?? 0) === 0);
      if (!res.summary?.dryRun) {
        await qc.invalidateQueries({ queryKey: ["ref", "aircraft-workshops"] });
        await qc.invalidateQueries({ queryKey: ["ref", "workshops"] });
      }
    }
  });

  const run = (dryRun: boolean) => {
    if (!rows.length) {
      setLocalError("В файле нет строк для импорта.");
      return;
    }
    setLocalError(null);
    importM.mutate({ dryRun, rows });
  };

  const summary = result?.summary;
  const visible = (result?.rows ?? []).filter((row) => showAll || row.status === "error" || row.conflict);
  const writable = (summary?.createRows ?? 0) + (summary?.updateRows ?? 0);
  const requestError = importM.error ? String((importM.error as { message?: string }).message ?? importM.error) : null;

  return (
    <section className="card adminPanel">
      <div className="adminListToolbar">
        <div className="adminListTitle">
          <strong>Импорт «Борт и цех»</strong>
        </div>
        <button type="button" className="btn" onClick={() => downloadAircraftWorkshopTemplate()}>
          Скачать шаблон
        </button>
      </div>
      <p className="muted adminHint">
        Привязка борта к цеху для A-check и C-check. В шаблоне лист «Инструкция»: обязательные поля, алиасы и правило
        ЦПТО3/ЦПТО5. Сначала предпросмотр: ошибки не записываются, конфликты показывают отличия от текущих привязок.
        Строк, которых нет в файле, это не удаляет.
      </p>
      <div className="operatorImportRow">
        <label className="refLabel">
          <span>Файл Excel / CSV</span>
          <input
            className="refInput"
            type="file"
            accept=".xlsx,.xls,.csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0] ?? null;
              setFileName(file?.name ?? "");
              setRows([]);
              setResult(null);
              setLocalError(null);
              importM.reset();
              if (!file) return;
              try {
                const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
                const sheet = dataSheet(workbook);
                if (!sheet) throw new Error("В файле нет листа с данными.");
                const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
                if (!parsed.length) throw new Error("В файле нет строк для импорта.");
                setRows(parsed);
              } catch (err: unknown) {
                setLocalError(String((err as { message?: string })?.message ?? err));
              }
            }}
          />
        </label>
        <div className="operatorImportActions">
          <button type="button" className="btn" disabled={importM.isPending || rows.length === 0} onClick={() => run(true)}>
            Предпросмотр
          </button>
          <button
            type="button"
            className="btn btnPrimary"
            disabled={importM.isPending || !summary?.dryRun || writable === 0}
            onClick={() => run(false)}
          >
            {importM.isPending ? "Загрузка…" : "Импортировать"}
          </button>
        </div>
      </div>
      {fileName ? (
        <div className="muted">
          Файл: {fileName}
          {rows.length ? ` · строк: ${rows.length}` : ""}
        </div>
      ) : null}
      {localError || requestError ? <div className="error">{localError || requestError}</div> : null}
      {summary ? (
        <div className="refImportResult">
          <span className="gpChip gpChipInfo">{summary.dryRun ? "предпросмотр" : "импорт"}</span>
          <span className="gpChip gpChipInfo">создать: {summary.createRows ?? 0}</span>
          <span className="gpChip">обновить: {summary.updateRows ?? 0}</span>
          <span className="gpChip">без изменений: {summary.unchangedRows ?? 0}</span>
          <span className="gpChip">конфликтов: {summary.conflictRows ?? 0}</span>
          <span className="gpChip gpChipError">ошибок: {summary.errorRows ?? 0}</span>
          {!summary.dryRun && result?.created != null ? <span className="gpChip">записано новых: {result.created}</span> : null}
          {!summary.dryRun && result?.updated != null ? <span className="gpChip">обновлено: {result.updated}</span> : null}
          {(summary.workshopsToCreate ?? []).length ? (
            <span className="gpChip">новые цеха: {summary.workshopsToCreate?.join(", ")}</span>
          ) : null}
        </div>
      ) : null}
      {result?.rows?.length ? (
        <>
          <div className="operatorImportActions" style={{ marginTop: 8 }}>
            <button type="button" className={showAll ? "btn" : "btn btnPrimary"} onClick={() => setShowAll(false)}>
              К проверке
            </button>
            <button type="button" className={showAll ? "btn btnPrimary" : "btn"} onClick={() => setShowAll(true)}>
              Все строки
            </button>
          </div>
          {visible.length === 0 ? (
            <div className="muted" style={{ marginTop: 8 }}>
              Ошибок и конфликтов нет.
            </div>
          ) : (
            <div className="refAircraftImportTableWrap refImportTableScroll">
              <table className="table refAircraftImportTable">
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Статус</th>
                    <th>Борт</th>
                    <th>Форма</th>
                    <th>Цех</th>
                    <th>Ангар</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, index) => (
                    <tr
                      key={`${row.rowIndex}-${row.workshop}-${index}`}
                      className={row.status === "error" ? "eventImportRowError" : row.conflict ? "eventImportRowWarn" : undefined}
                    >
                      <td>{row.rowIndex}</td>
                      <td>
                        <span
                          className={
                            row.status === "error"
                              ? "eventImportBadge eventImportBadgeError"
                              : row.conflict
                                ? "eventImportBadge eventImportBadgeWarn"
                                : row.status === "create"
                                  ? "eventImportBadge eventImportBadgeOk"
                                  : "eventImportBadge eventImportBadgeMuted"
                          }
                        >
                          {statusLabel(row)}
                        </span>
                      </td>
                      <td>{row.tail || "—"}</td>
                      <td>{row.check || "—"}</td>
                      <td>{row.workshop || "—"}</td>
                      <td>{row.hangar || "—"}</td>
                      <td className="eventImportMessageCell">
                        {row.status === "error" ? <span className="eventImportErrorText">{row.message}</span> : row.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
