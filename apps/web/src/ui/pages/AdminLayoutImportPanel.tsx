import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as XLSX from "xlsx";

import { apiPost } from "../../lib/api";
import { downloadLayoutImportTemplate, readImportDataSheet } from "../../lib/importTemplates";

function refNum(v: unknown, fallback = 0): number {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : fallback;
}

function refStr(v: unknown): string {
  return String(v ?? "").trim();
}

function pickCell(row: Record<string, unknown>, keys: string[]): unknown {
  const normalized = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const key of keys) {
    const found = normalized.get(key.toLowerCase());
    if (found != null && String(found).trim() !== "") return found;
  }
  return "";
}

function normalizeBodyType(v: unknown): "NARROW_BODY" | "WIDE_BODY" | null {
  const s = refStr(v).toLowerCase();
  if (!s) return null;
  if (s.includes("wide") || s.includes("шир")) return "WIDE_BODY";
  if (s.includes("narrow") || s.includes("узк")) return "NARROW_BODY";
  return null;
}

function buildLayoutImportPayload(rows: Array<Record<string, unknown>>) {
  const hangars = new Map<string, any>();
  for (const row of rows) {
    const hangarCode = refStr(pickCell(row, ["hangarCode", "код ангара", "ангар код", "ангар"]));
    const hangarName = refStr(pickCell(row, ["hangarName", "название ангара", "ангар название"])) || hangarCode;
    const layoutCode = refStr(pickCell(row, ["layoutCode", "код схемы", "код варианта", "схема код", "вариант код"]));
    const layoutName = refStr(pickCell(row, ["layoutName", "название схемы", "название варианта", "схема", "вариант"])) || layoutCode;
    const standCode = refStr(pickCell(row, ["standCode", "код места", "место код", "место"]));
    if (!hangarCode || !layoutCode || !standCode) continue;

    const hangar = hangars.get(hangarCode) ?? { code: hangarCode, name: hangarName, layouts: new Map<string, any>() };
    hangars.set(hangarCode, hangar);
    const layouts = hangar.layouts as Map<string, any>;
    const layout =
      layouts.get(layoutCode) ??
      {
        code: layoutCode,
        name: layoutName,
        description: refStr(pickCell(row, ["description", "описание"])) || undefined,
        widthMeters: refNum(pickCell(row, ["widthMeters", "ширина ангара", "ширина схемы", "width"]), 80),
        heightMeters: refNum(pickCell(row, ["heightMeters", "высота ангара", "высота схемы", "height"]), 50),
        stands: []
      };
    layouts.set(layoutCode, layout);
    layout.stands.push({
      code: standCode,
      name: refStr(pickCell(row, ["standName", "название места", "место название"])) || standCode,
      bodyType: normalizeBodyType(pickCell(row, ["bodyType", "тип фюзеляжа", "фюзеляж"])),
      x: refNum(pickCell(row, ["x", "X"])),
      y: refNum(pickCell(row, ["y", "Y"])),
      w: refNum(pickCell(row, ["w", "ширина места", "standWidth"]), 10),
      h: refNum(pickCell(row, ["h", "высота места", "standHeight"]), 10),
      rotate: refNum(pickCell(row, ["rotate", "поворот"]), 0)
    });
  }
  return {
    hangars: Array.from(hangars.values()).map((h) => ({
      code: h.code,
      name: h.name,
      layouts: Array.from((h.layouts as Map<string, any>).values())
    }))
  };
}

export function AdminLayoutImportPanel() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<{ hangars?: number; layouts?: number; stands?: number } | null>(null);
  const importM = useMutation({
    mutationFn: async (payload: ReturnType<typeof buildLayoutImportPayload>) =>
      apiPost<{ hangars?: number; layouts?: number; stands?: number }>("/api/ref/layouts/import", payload),
    onSuccess: async (res) => {
      setResult(res);
      setLocalError(null);
      await qc.invalidateQueries({ queryKey: ["ref", "hangars"] });
      await qc.invalidateQueries({ queryKey: ["ref", "layouts"] });
      await qc.invalidateQueries({ queryKey: ["ref", "stands"] });
      await qc.invalidateQueries({ queryKey: ["layout"] });
      await qc.invalidateQueries({ queryKey: ["hangar-planning"] });
    }
  });

  return (
    <section className="card refSection">
      <div className="refSectionHeader">
        <div>
          <strong>Импорт схем</strong>
          <div className="muted refSectionHint">
            Массовая загрузка вариантов расстановки и мест стоянки. Каждая строка — одно место. В шаблоне лист «Инструкция» с полями и примером двух мест одной схемы.
          </div>
        </div>
        <button type="button" className="btn" onClick={() => downloadLayoutImportTemplate()}>
          Скачать шаблон
        </button>
      </div>
      <div className="refLayoutImportGrid">
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
              setLocalError(null);
              setResult(null);
              importM.reset();
              if (!file) return;
              try {
                const sheet = readImportDataSheet(await file.arrayBuffer());
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
          onClick={() => {
            try {
              const payload = buildLayoutImportPayload(rows);
              if (payload.hangars.length === 0) throw new Error("Не найдено строк с hangarCode, layoutCode и standCode.");
              importM.mutate(payload);
            } catch (err) {
              setLocalError(String((err as { message?: string })?.message ?? err));
            }
          }}
        >
          {importM.isPending ? "Импорт…" : "Импортировать схемы"}
        </button>
      </div>
      <div className="muted small">
        Рекомендуемые колонки: hangarCode, hangarName, layoutCode, layoutName, widthMeters, heightMeters, standCode, standName,
        bodyType, x, y, w, h, rotate. Значения bodyType: narrow/узкий или wide/широкий.
      </div>
      {fileName ? (
        <div className="muted">
          Файл: <strong>{fileName}</strong> · строк: {rows.length}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="refImportPreview">
          <strong>Предпросмотр первых строк</strong>
          <pre>{JSON.stringify(rows.slice(0, 3), null, 2)}</pre>
        </div>
      ) : null}
      {result ? (
        <div className="refImportResult">
          <span className="gpChip gpChipInfo">ангаров: {result.hangars ?? 0}</span>
          <span className="gpChip">схем: {result.layouts ?? 0}</span>
          <span className="gpChip">мест: {result.stands ?? 0}</span>
        </div>
      ) : null}
      {localError || importM.error ? (
        <div className="error">{localError || String((importM.error as { message?: string })?.message ?? importM.error)}</div>
      ) : null}
    </section>
  );
}
