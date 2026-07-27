import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPut } from "../../lib/api";

type LaborDepartment = "ME" | "AV" | "INT" | "NDT" | "SHOP" | "CAB_REP";
type LaborBlockCode = "LABOR_BUDGET" | "WP_PLAN_MPS" | "WP_ACTUAL";

type LaborMetricsResponse = {
  ok: true;
  eventId: string;
  blocks: Array<{
    block: LaborBlockCode;
    label: string;
    hint: string;
    total: number | null;
    departments: Array<{
      department: LaborDepartment;
      label: string;
      skillId: string | null;
      skillCode: string;
      manHours: number | null;
    }>;
  }>;
};

type DraftMap = Record<string, string>;

function cellKey(block: LaborBlockCode, department: LaborDepartment) {
  return `${block}:${department}`;
}

function parseHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function formatHours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
}

export function EventResourcesPanel(props: { eventId: string }) {
  const qc = useQueryClient();
  const laborQ = useQuery({
    queryKey: ["resources", "labor-metrics", props.eventId],
    queryFn: () => apiGet<LaborMetricsResponse>(`/api/resources/events/${props.eventId}/labor-metrics`)
  });

  const [draft, setDraft] = useState<DraftMap>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!laborQ.data) return;
    const next: DraftMap = {};
    for (const block of laborQ.data.blocks) {
      for (const row of block.departments) {
        next[cellKey(block.block, row.department)] = formatHours(row.manHours);
      }
    }
    setDraft(next);
    setDirty(false);
  }, [laborQ.data]);

  const saveM = useMutation({
    mutationFn: async () => {
      if (!laborQ.data) return;
      const values: Array<{ block: LaborBlockCode; department: LaborDepartment; manHours: number | null }> = [];
      for (const block of laborQ.data.blocks) {
        for (const row of block.departments) {
          const key = cellKey(block.block, row.department);
          const raw = draft[key] ?? "";
          const parsed = parseHours(raw);
          if (raw.trim() && parsed == null) {
            throw new Error(`Некорректное значение ч/ч: ${block.label} / ${row.label}`);
          }
          values.push({ block: block.block, department: row.department, manHours: parsed });
        }
      }
      return apiPut<{ ok: true }>(`/api/resources/events/${props.eventId}/labor-metrics`, { values });
    },
    onSuccess: async () => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["resources", "labor-metrics", props.eventId] });
    }
  });

  const blockTotals = useMemo(() => {
    const totals: Record<string, number | null> = {};
    for (const block of laborQ.data?.blocks ?? []) {
      let sum: number | null = null;
      for (const row of block.departments) {
        const parsed = parseHours(draft[cellKey(block.block, row.department)] ?? "");
        if (parsed == null) continue;
        sum = (sum ?? 0) + parsed;
      }
      totals[block.block] = sum;
    }
    return totals;
  }, [draft, laborQ.data]);

  return (
    <div className="laborMetricsPanel">
      <div>
        <strong>Трудоёмкость (ч/ч)</strong>
        <div className="muted" style={{ marginTop: 4 }}>
          Три блока по квалификациям ME / AV / INT / NDT / SHOP / CabRep. Значения пишутся в первичную таблицу
          (EventReportMetric). Выработка в сутки для MPS и факта считается в отчёте как TOTAL / TAT; для бюджета
          используется TAT бюджета (W).
        </div>
      </div>

      {laborQ.isLoading ? <div className="muted">Загрузка…</div> : null}
      {laborQ.error ? <div className="error">{String((laborQ.error as any)?.message ?? laborQ.error)}</div> : null}

      {(laborQ.data?.blocks ?? []).map((block) => (
        <div key={block.block} className="laborMetricsBlock">
          <div className="laborMetricsBlockHead">
            <strong>{block.label}</strong>
            <span className="muted small">{block.hint}</span>
          </div>
          <div className="laborMetricsGrid">
            {block.departments.map((row) => {
              const key = cellKey(block.block, row.department);
              return (
                <label key={key} className="laborMetricsCell">
                  <span className="laborMetricsCellLabel">{row.label}</span>
                  <input
                    className="evInput"
                    type="text"
                    inputMode="decimal"
                    placeholder="—"
                    value={draft[key] ?? ""}
                    onChange={(e) => {
                      setDraft((prev) => ({ ...prev, [key]: e.target.value }));
                      setDirty(true);
                    }}
                  />
                </label>
              );
            })}
            <div className="laborMetricsCell laborMetricsTotal">
              <span className="laborMetricsCellLabel">TOTAL</span>
              <div className="laborMetricsTotalValue">
                {blockTotals[block.block] == null ? "—" : blockTotals[block.block]!.toLocaleString("ru-RU")}
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        {saveM.error ? <span className="error">{String((saveM.error as any)?.message ?? saveM.error)}</span> : null}
        <button
          type="button"
          className="btn btnPrimary"
          disabled={!dirty || saveM.isPending || !laborQ.data}
          onClick={() => saveM.mutate()}
        >
          {saveM.isPending ? "Сохранение…" : "Сохранить трудоёмкость"}
        </button>
      </div>
    </div>
  );
}
