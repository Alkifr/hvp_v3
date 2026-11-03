import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiPost } from "../../lib/api";
import { downloadOperatorImportTemplate, readImportTableCsv } from "../../lib/importTemplates";

function decodeCsv(buffer: ArrayBuffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  const cp1251 = new TextDecoder("windows-1251").decode(buffer);
  const replacementCount = (utf8.match(/\uFFFD/g) ?? []).length;
  const mojibakeCount = (utf8.match(/[ÐÑ][\u0080-\u00BF]/g) ?? []).length;
  return replacementCount > 0 || mojibakeCount > 1 ? cp1251 : utf8;
}

function parseCsv(text: string): string[][] {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV должен содержать шапку и хотя бы одну строку данных.");
  const headerLine = lines[0] ?? "";
  const delimiter = [";", "\t", ","].sort((a, b) => headerLine.split(b).length - headerLine.split(a).length)[0] ?? ";";
  return lines.map((line) => {
    const cells: string[] = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"' && inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        cells.push(cell.trim().replace(/^"+|"+$/g, ""));
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim().replace(/^"+|"+$/g, ""));
    return cells;
  });
}

function headerIndex(headers: string[], aliases: string[]) {
  const norm = (v: string) => v.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const keys = headers.map(norm);
  return keys.findIndex((h) => aliases.includes(h));
}

function parseOperatorRows(text: string) {
  const rows = parseCsv(text);
  const headers = rows[0] ?? [];
  const codeIdx = headerIndex(headers, ["code", "код", "operator", "operatorcode"]);
  const nameIdx = headerIndex(headers, ["name", "название", "operatorname"]);
  if (codeIdx < 0 || nameIdx < 0) throw new Error("В CSV нужны колонки: code, name.");
  return rows.slice(1).map((row) => ({
    code: String(row[codeIdx] ?? "").trim(),
    name: String(row[nameIdx] ?? "").trim()
  }));
}

type ImportResult = {
  summary?: { dryRun?: boolean; okRows?: number; errorRows?: number };
  created?: number;
  rows?: Array<{ rowIndex: number; ok: boolean; code?: string; name?: string; error?: string }>;
};

export function AdminOperatorImportPanel() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const importM = useMutation({
    mutationFn: async (payload: { dryRun?: boolean; rows: Array<{ code: string; name: string }> }) =>
      apiPost<ImportResult>("/api/ref/operators/import", payload),
    onSuccess: async (res) => {
      setResult(res);
      setLocalError(null);
      await qc.invalidateQueries({ queryKey: ["ref", "operators"] });
    }
  });

  const run = (dryRun: boolean) => {
    try {
      const rows = parseOperatorRows(csvText);
      if (rows.length === 0) throw new Error("В CSV не найдено строк для импорта.");
      importM.mutate({ dryRun, rows });
    } catch (err: unknown) {
      setLocalError(String((err as { message?: string })?.message ?? err));
    }
  };

  const errors = (result?.rows ?? []).filter((row) => row.error);

  return (
    <section className="card adminPanel">
      <div className="adminListToolbar">
        <div className="adminListTitle">
          <strong>Импорт операторов</strong>
        </div>
        <button type="button" className="btn" onClick={() => downloadOperatorImportTemplate()}>
          Скачать шаблон
        </button>
      </div>
      <p className="muted adminHint">
        Массовая загрузка справочника «Операторы». В шаблоне лист «Инструкция»: колонки code и name.
        Уже существующие коды и названия пропускаются. CSV — UTF-8 или Windows-1251, разделитель запятая, точка с запятой или табуляция.
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
              setResult(null);
              setLocalError(null);
              setCsvText("");
              setFileName(file?.name ?? "");
              if (!file) return;
              const buffer = await file.arrayBuffer();
              const excel = /\.xlsx?$/i.test(file.name);
              setCsvText(excel ? readImportTableCsv(buffer) : decodeCsv(buffer));
            }}
          />
        </label>
        <div className="operatorImportActions">
          <button type="button" className="btn" disabled={importM.isPending || !csvText} onClick={() => run(true)}>
            Предпросмотр
          </button>
          <button
            type="button"
            className="btn btnPrimary"
            disabled={importM.isPending || !(result?.summary?.okRows && result.summary.okRows > 0 && result.summary.dryRun)}
            onClick={() => run(false)}
          >
            {importM.isPending ? "Загрузка…" : "Импортировать"}
          </button>
        </div>
      </div>

      {fileName ? <div className="muted">Файл: {fileName}</div> : null}
      {localError || importM.error ? (
        <div className="error">{localError || String((importM.error as { message?: string })?.message ?? importM.error)}</div>
      ) : null}

      {result?.summary ? (
        <div className="refImportResult">
          <span className="gpChip gpChipInfo">{result.summary.dryRun ? "предпросмотр" : "импорт"}</span>
          <span className="gpChip gpChipInfo">готово: {result.summary.okRows ?? 0}</span>
          <span className="gpChip gpChipError">ошибок: {result.summary.errorRows ?? 0}</span>
          {result.created != null ? <span className="gpChip">создано: {result.created}</span> : null}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="error" style={{ marginTop: 8 }}>
          {errors.map((row) => `Строка ${row.rowIndex}: ${row.error}`).join(" ")}
        </div>
      ) : null}
    </section>
  );
}
