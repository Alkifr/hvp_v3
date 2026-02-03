import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";

import { apiPost } from "../../lib/api";

export function EventImportView() {
  const qc = useQueryClient();

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRows, setImportRows] = useState<any[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);

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
    }
  });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="row">
          <strong>Импорт событий</strong>
          <span className="muted">
            Excel/CSV. Шапка: Operator, Aircraft, AircraftType, Event_Title, Event_name, startAt, endAt, Hangar, HangarStand
          </span>
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
                    const text = await f.text();
                    const wb = XLSX.read(text, { type: "string" });
                    const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
                    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
                    setImportRows(rows);
                    return;
                  }
                  const buf = await f.arrayBuffer();
                  const wb = XLSX.read(buf, { type: "array", cellDates: true });
                  const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
                  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
                  setImportRows(rows);
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
            Импортировать
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
          <div style={{ border: "1px solid rgba(148,163,184,0.35)", borderRadius: 12, padding: 10 }}>
            <div className="row">
              <strong>Результат</strong>
              {"summary" in (importResult as any) ? (
                <>
                  <span className="muted">режим: {(importResult as any).summary?.dryRun ? "предпросмотр" : "импорт"}</span>
                  <span className="muted">ok: {(importResult as any).summary?.okRows ?? 0}</span>
                  <span className="muted">ошибок: {(importResult as any).summary?.errorRows ?? 0}</span>
                  <span className="muted">событий: {(importResult as any).summary?.wouldCreateEvents ?? 0}</span>
                  <span className="muted">резервов: {(importResult as any).summary?.wouldCreateReservations ?? 0}</span>
                </>
              ) : (
                <>
                  <span className="muted">событий: {(importResult as any).createdEvents ?? 0}</span>
                  <span className="muted">резервов: {(importResult as any).createdReservations ?? 0}</span>
                  <span className="muted">ошибок: {((importResult as any).errors ?? []).length}</span>
                </>
              )}
            </div>

            {"rows" in (importResult as any) ? (
              <div
                className="muted"
                style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap" }}
              >
                {JSON.stringify(((importResult as any).rows ?? []).slice(0, 40), null, 2)}
              </div>
            ) : ((importResult as any).errors ?? []).length ? (
              <div
                className="muted"
                style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap" }}
              >
                {JSON.stringify((((importResult as any).errors ?? []) as any[]).slice(0, 40), null, 2)}
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
          <div>После импорта откройте «План (Гантт)» — события появятся в выбранном диапазоне.</div>
        </div>
      </div>
    </div>
  );
}

