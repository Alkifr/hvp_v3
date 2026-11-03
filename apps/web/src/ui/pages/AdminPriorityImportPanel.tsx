import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as XLSX from "xlsx";

import { apiPost } from "../../lib/api";
import { downloadPriorityImportTemplate } from "../../lib/importTemplates";

export function AdminPriorityImportPanel() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported?: number; warnings?: string[] } | null>(null);
  const importM = useMutation({
    mutationFn: async (payload: { rows: Array<Record<string, unknown>>; replace: boolean; source: string }) =>
      apiPost<{ imported?: number; warnings?: string[] }>("/api/ref/placement-priorities/import", payload),
    onSuccess: async (res) => {
      setResult(res);
      setLocalError(null);
      await qc.invalidateQueries({ queryKey: ["ref", "placement-priorities"] });
    }
  });

  return (
    <section className="card refSection">
      <div className="refSectionHeader">
        <div>
          <strong>Импорт приоритетов</strong>
          <div className="muted refSectionHint">
            Лист «Список_приоритетов_в_ангарах»: номер ангара, вариант, стоянка, событие, тип ВС и комментарий. Загрузка заменяет текущие правила этого источника. В шаблоне есть лист «Инструкция».
          </div>
        </div>
        <button type="button" className="btn" onClick={() => downloadPriorityImportTemplate()}>
          Скачать шаблон
        </button>
      </div>
      <div className="refLayoutImportGrid">
        <label className="refLabel">
          <span>Файл Excel</span>
          <input
            className="refInput"
            type="file"
            accept=".xlsx,.xls"
            onChange={async (e) => {
              const file = e.target.files?.[0] ?? null;
              setFileName(file?.name ?? "");
              setRows([]);
              setLocalError(null);
              setResult(null);
              importM.reset();
              if (!file) return;
              try {
                const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
                const sheetName =
                  wb.SheetNames.find((name) => name.trim().toLowerCase() === "список_приоритетов_в_ангарах") ??
                  wb.SheetNames.find((name) => name.trim().toLowerCase() !== "инструкция") ??
                  wb.SheetNames[0]!;
                const sheet = wb.Sheets[sheetName];
                setRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }));
              } catch (err) {
                setLocalError(String((err as { message?: string })?.message ?? err));
              }
            }}
          />
        </label>
        <button
          className="btn btnPrimary"
          type="button"
          disabled={rows.length === 0 || importM.isPending}
          onClick={() => importM.mutate({ rows, replace: true, source: "Список_приоритетов_в_ангарах" })}
        >
          {importM.isPending ? "Импорт…" : "Заменить и импортировать"}
        </button>
      </div>
      <div className="muted small">Ожидаемые колонки: Номер ангара, Вариант расстановки, Номер стоянки, Наименование события, Тип ВС, Комментарий.</div>
      {fileName ? (
        <div className="muted">
          Файл: <strong>{fileName}</strong> · строк: {rows.length}
        </div>
      ) : null}
      {result ? (
        <div className="refImportResult">
          <span className="gpChip gpChipInfo">загружено: {result.imported ?? 0}</span>
          <span className="gpChip">предупреждений: {(result.warnings ?? []).length}</span>
          {(result.warnings ?? []).slice(0, 8).map((warning, index) => (
            <span key={index} className="muted small">
              {warning}
            </span>
          ))}
        </div>
      ) : null}
      {localError || importM.error ? (
        <div className="error">{localError || String((importM.error as { message?: string })?.message ?? importM.error)}</div>
      ) : null}
    </section>
  );
}
