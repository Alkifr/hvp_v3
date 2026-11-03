import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiPost } from "../../lib/api";
import { downloadAircraftImportTemplate, downloadAircraftTypeImportTemplate, readImportTableCsv } from "../../lib/importTemplates";

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

type ImportResult = {
  summary?: { dryRun?: boolean; okRows?: number; errorRows?: number };
  created?: number;
  rows?: Array<Record<string, unknown> & { rowIndex: number; ok: boolean; error?: string }>;
};

function useCsvImport(endpoint: string, queryKey: string[]) {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const importM = useMutation({
    mutationFn: async (payload: { dryRun?: boolean; rows: unknown[] }) => apiPost<ImportResult>(endpoint, payload),
    onSuccess: async (res) => {
      setResult(res);
      setLocalError(null);
      await qc.invalidateQueries({ queryKey });
    }
  });
  return { fileName, setFileName, csvText, setCsvText, result, setResult, localError, setLocalError, importM };
}

function ImportFileRow(props: {
  csvText: string;
  pending: boolean;
  canImport: boolean;
  onFile: (file: File | null) => void;
  onPreview: () => void;
  onImport: () => void;
}) {
  return (
    <div className="operatorImportRow">
      <label className="refLabel">
        <span>Файл Excel / CSV</span>
        <input
          className="refInput"
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          onChange={async (e) => {
            props.onFile(e.target.files?.[0] ?? null);
          }}
        />
      </label>
      <div className="operatorImportActions">
        <button type="button" className="btn" disabled={props.pending || !props.csvText} onClick={props.onPreview}>
          Предпросмотр
        </button>
        <button type="button" className="btn btnPrimary" disabled={props.pending || !props.canImport} onClick={props.onImport}>
          {props.pending ? "Загрузка…" : "Импортировать"}
        </button>
      </div>
    </div>
  );
}

function ImportSummary(props: { fileName: string; result: ImportResult | null; localError: string | null; requestError: string | null }) {
  const errors = (props.result?.rows ?? []).filter((row) => row.error);
  return (
    <>
      {props.fileName ? <div className="muted">Файл: {props.fileName}</div> : null}
      {props.localError || props.requestError ? <div className="error">{props.localError || props.requestError}</div> : null}
      {props.result?.summary ? (
        <div className="refImportResult">
          <span className="gpChip gpChipInfo">{props.result.summary.dryRun ? "предпросмотр" : "импорт"}</span>
          <span className="gpChip gpChipInfo">готово: {props.result.summary.okRows ?? 0}</span>
          <span className="gpChip gpChipError">ошибок: {props.result.summary.errorRows ?? 0}</span>
          {props.result.created != null ? <span className="gpChip">создано: {props.result.created}</span> : null}
        </div>
      ) : null}
      {errors.length > 0 ? (
        <div className="error" style={{ marginTop: 8 }}>
          {errors.map((row) => `Строка ${row.rowIndex}: ${row.error}`).join(" ")}
        </div>
      ) : null}
    </>
  );
}

function parseTypeRows(text: string) {
  const rows = parseCsv(text);
  const headers = rows[0] ?? [];
  const nameIdx = headerIndex(headers, ["name", "название", "aircrafttype", "тип"]);
  const icaoIdx = headerIndex(headers, ["icaotype", "icao"]);
  const manufacturerIdx = headerIndex(headers, ["manufacturer", "производитель"]);
  const bodyIdx = headerIndex(headers, ["bodytype", "фюзеляж"]);
  if (nameIdx < 0) throw new Error("В CSV нужна колонка name.");
  return rows.slice(1).map((row) => ({
    name: String(row[nameIdx] ?? "").trim(),
    ...(icaoIdx >= 0 ? { icaoType: String(row[icaoIdx] ?? "").trim() } : {}),
    ...(manufacturerIdx >= 0 ? { manufacturer: String(row[manufacturerIdx] ?? "").trim() } : {}),
    ...(bodyIdx >= 0 ? { bodyType: String(row[bodyIdx] ?? "").trim() } : {})
  }));
}

export function AdminAircraftTypeImportPanel() {
  const state = useCsvImport("/api/ref/aircraft-types/import", ["ref", "aircraft-types"]);
  const run = (dryRun: boolean) => {
    try {
      const rows = parseTypeRows(state.csvText);
      if (rows.length === 0) throw new Error("В CSV не найдено строк для импорта.");
      state.importM.mutate({ dryRun, rows });
    } catch (err: unknown) {
      state.setLocalError(String((err as { message?: string })?.message ?? err));
    }
  };
  return (
    <section className="card adminPanel">
      <div className="adminListToolbar">
        <div className="adminListTitle">
          <strong>Импорт типов ВС</strong>
        </div>
        <button type="button" className="btn" onClick={() => downloadAircraftTypeImportTemplate()}>
          Скачать шаблон
        </button>
      </div>
      <p className="muted adminHint">
        Массовая загрузка справочника «Типы ВС». В шаблоне лист «Инструкция»: name обязателен, icaoType, manufacturer и bodyType — по желанию.
        Уже существующие названия и ICAO пропускаются.
      </p>
      <ImportFileRow
        csvText={state.csvText}
        pending={state.importM.isPending}
        canImport={Boolean(state.result?.summary?.dryRun && (state.result.summary.okRows ?? 0) > 0)}
        onFile={async (file) => {
          state.setResult(null);
          state.setLocalError(null);
          state.setCsvText("");
          state.setFileName(file?.name ?? "");
          if (!file) return;
          const buffer = await file.arrayBuffer();
          state.setCsvText(/\.xlsx?$/i.test(file.name) ? readImportTableCsv(buffer) : decodeCsv(buffer));
        }}
        onPreview={() => run(true)}
        onImport={() => run(false)}
      />
      <ImportSummary
        fileName={state.fileName}
        result={state.result}
        localError={state.localError}
        requestError={state.importM.error ? String((state.importM.error as { message?: string }).message ?? state.importM.error) : null}
      />
    </section>
  );
}

function parseAircraftRows(text: string) {
  const rows = parseCsv(text);
  const headers = (rows[0] ?? []).map((value) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const tailIdx = headers.findIndex((h) => ["tailnumber", "aircraft", "boardnumber", "борт", "бортовойномер"].includes(h));
  const operatorIdx = headers.findIndex((h) => ["operator", "operatorcode", "operatorname", "оператор"].includes(h));
  const typeIdx = headers.findIndex((h) => ["aircrafttype", "type", "icaotype", "типвс", "тип"].includes(h));
  const manufactureIdx = headers.findIndex((h) =>
    ["manufacturedate", "productiondate", "manufacturedat", "датапроизводства", "датапроизводствавс"].includes(h)
  );
  const serialIdx = headers.findIndex((h) => ["serialnumber", "sn", "завномер", "заводскойномер"].includes(h));
  if (tailIdx < 0 || operatorIdx < 0 || typeIdx < 0) {
    throw new Error("В CSV нужны колонки: tailNumber, operator, aircraftType.");
  }
  return rows.slice(1).map((row) => ({
    tailNumber: String(row[tailIdx] ?? "").trim(),
    operator: String(row[operatorIdx] ?? "").trim(),
    aircraftType: String(row[typeIdx] ?? "").trim(),
    ...(manufactureIdx >= 0 ? { manufactureDate: String(row[manufactureIdx] ?? "").trim() } : {}),
    ...(serialIdx >= 0 ? { serialNumber: String(row[serialIdx] ?? "").trim() } : {})
  }));
}

export function AdminAircraftImportPanel() {
  const state = useCsvImport("/api/ref/aircraft/import", ["ref", "aircraft"]);
  const run = (dryRun: boolean) => {
    try {
      const rows = parseAircraftRows(state.csvText);
      if (rows.length === 0) throw new Error("В CSV не найдено строк для импорта.");
      state.importM.mutate({ dryRun, rows });
    } catch (err: unknown) {
      state.setLocalError(String((err as { message?: string })?.message ?? err));
    }
  };
  const rows = state.result?.rows ?? [];
  return (
    <section className="card adminPanel">
      <div className="adminListToolbar">
        <div className="adminListTitle">
          <strong>Импорт бортовых номеров</strong>
        </div>
        <button type="button" className="btn" onClick={() => downloadAircraftImportTemplate()}>
          Скачать шаблон
        </button>
      </div>
      <p className="muted adminHint">
        Массовая загрузка справочника «Бортовые номера». В шаблоне лист «Инструкция»: обязательны tailNumber, operator и aircraftType.
        Оператор ищется по коду или названию, тип ВС — по ICAO или названию. Уже существующие бортовые номера пропускаются.
      </p>
      <ImportFileRow
        csvText={state.csvText}
        pending={state.importM.isPending}
        canImport={Boolean(state.result?.summary?.dryRun && (state.result.summary.okRows ?? 0) > 0)}
        onFile={async (file) => {
          state.setResult(null);
          state.setLocalError(null);
          state.setCsvText("");
          state.setFileName(file?.name ?? "");
          if (!file) return;
          const buffer = await file.arrayBuffer();
          state.setCsvText(/\.xlsx?$/i.test(file.name) ? readImportTableCsv(buffer) : decodeCsv(buffer));
        }}
        onPreview={() => run(true)}
        onImport={() => run(false)}
      />
      <ImportSummary
        fileName={state.fileName}
        result={state.result}
        localError={state.localError}
        requestError={state.importM.error ? String((state.importM.error as { message?: string }).message ?? state.importM.error) : null}
      />
      {rows.length > 0 ? (
        <div className="refAircraftImportTableWrap">
          <table className="table refAircraftImportTable">
            <thead>
              <tr>
                <th>Строка</th>
                <th>Статус</th>
                <th>Борт</th>
                <th>Оператор</th>
                <th>Тип ВС</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowIndex} className={row.ok ? undefined : "eventImportRowError"}>
                  <td>{row.rowIndex}</td>
                  <td>
                    <span className={row.ok ? "eventImportBadge eventImportBadgeOk" : "eventImportBadge eventImportBadgeError"}>
                      {row.ok ? "Готово" : "Ошибка"}
                    </span>
                  </td>
                  <td>{String(row.tailNumber || "—")}</td>
                  <td>{String(row.operator || "—")}</td>
                  <td>{String(row.aircraftType || "—")}</td>
                  <td className="eventImportMessageCell">
                    {row.error ? <span className="eventImportErrorText">{row.error}</span> : <span className="muted">Можно импортировать</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
