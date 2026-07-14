import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import * as XLSX from "xlsx";

import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/api";

type ReportDataset =
  | "tat_events"
  | "util_hangars"
  | "util_timeline"
  | "util_stands"
  | "compare_hangars"
  | "compare_events";

type ReportFieldDef = { key: string; label: string; type: "string" | "number" | "datetime" };

type FilterOp = "contains" | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "empty" | "notEmpty";

type FieldCondition = {
  field: string;
  op: FilterOp;
  value?: string;
};

type ReportConfig = {
  dataset: ReportDataset;
  fields: string[];
  filters: {
    conditions?: FieldCondition[];
  };
  sort: Array<{ field: string; dir: "asc" | "desc" }>;
  grain?: "day" | "week" | "month" | "period";
  compareA?: string;
  compareB?: string;
  periodFrom?: string | null;
  periodTo?: string | null;
};

type DatasetMeta = {
  id: ReportDataset;
  label: string;
  description: string;
  fields: ReportFieldDef[];
  defaultFields: string[];
};

type SavedReport = {
  id: string;
  name: string;
  description: string | null;
  config: ReportConfig;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; email: string; displayName: string | null };
  myRole: "OWNER" | "VIEWER" | "EDITOR" | null;
  canEdit: boolean;
  shares: Array<{ userId: string; role: string; email: string; displayName: string | null }>;
};

type RunResult = {
  ok: true;
  dataset: ReportDataset;
  period: { from: string; to: string };
  columns: Array<{ key: string; label: string; type: string }>;
  rows: Array<Record<string, any>>;
  total: number;
};

const OPS_BY_TYPE: Record<ReportFieldDef["type"], Array<{ op: FilterOp; label: string }>> = {
  string: [
    { op: "contains", label: "содержит" },
    { op: "eq", label: "равно" },
    { op: "neq", label: "не равно" },
    { op: "empty", label: "пусто" },
    { op: "notEmpty", label: "не пусто" }
  ],
  number: [
    { op: "eq", label: "=" },
    { op: "neq", label: "≠" },
    { op: "gt", label: ">" },
    { op: "gte", label: "≥" },
    { op: "lt", label: "<" },
    { op: "lte", label: "≤" },
    { op: "empty", label: "пусто" },
    { op: "notEmpty", label: "не пусто" }
  ],
  datetime: [
    { op: "eq", label: "равно" },
    { op: "neq", label: "не равно" },
    { op: "gt", label: "после" },
    { op: "gte", label: "не раньше" },
    { op: "lt", label: "до" },
    { op: "lte", label: "не позже" },
    { op: "empty", label: "пусто" },
    { op: "notEmpty", label: "не пусто" }
  ]
};

function emptyConfig(dataset: ReportDataset, meta?: DatasetMeta[], periodDefaults?: { from: string; to: string }): ReportConfig {
  const ds = meta?.find((m) => m.id === dataset);
  return {
    dataset,
    fields: ds?.defaultFields ?? [],
    filters: { conditions: [] },
    sort: [],
    grain: "week",
    compareA: "prod",
    compareB: "",
    periodFrom: periodDefaults?.from ?? null,
    periodTo: periodDefaults?.to ?? null
  };
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function normalizeConfig(
  raw: ReportConfig,
  datasets: DatasetMeta[],
  periodDefaults?: { from: string; to: string }
): ReportConfig {
  const base = emptyConfig(raw.dataset, datasets, periodDefaults);
  return {
    ...base,
    ...raw,
    filters: { conditions: raw.filters?.conditions ?? [] },
    sort: raw.sort ?? [],
    fields: raw.fields?.length ? raw.fields : base.fields,
    periodFrom: raw.periodFrom ?? periodDefaults?.from ?? null,
    periodTo: raw.periodTo ?? periodDefaults?.to ?? null
  };
}

type Props = {
  fromIso: string;
  toIso: string;
  periodLabel: string;
  tzOffset: number;
  sandboxes: Array<{ id: string; name: string }>;
};

export function ReportBuilderPanel(props: Props) {
  const { fromIso, toIso, periodLabel, tzOffset, sandboxes } = props;
  const qc = useQueryClient();
  const defaultFrom = dayjs(fromIso).format("YYYY-MM-DD");
  const defaultTo = dayjs(toIso).format("YYYY-MM-DD");
  const periodDefaults = { from: defaultFrom, to: defaultTo };

  const metaQ = useQuery({
    queryKey: ["reports", "meta"],
    queryFn: () => apiGet<{ ok: true; datasets: DatasetMeta[] }>("/api/reports/meta")
  });
  const listQ = useQuery({
    queryKey: ["reports", "list"],
    queryFn: () => apiGet<{ ok: true; reports: SavedReport[] }>("/api/reports")
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("Новый отчёт");
  const [config, setConfig] = useState<ReportConfig>(() =>
    emptyConfig("tat_events", undefined, {
      from: dayjs().subtract(30, "day").format("YYYY-MM-DD"),
      to: dayjs().format("YYYY-MM-DD")
    })
  );
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"VIEWER" | "EDITOR">("VIEWER");
  const [constructorTab, setConstructorTab] = useState<"source" | "fields" | "filters" | "sort" | "access">(
    "source"
  );
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const datasets = metaQ.data?.datasets ?? [];
  const currentMeta = datasets.find((d) => d.id === config.dataset);
  const selected = listQ.data?.reports.find((r) => r.id === selectedId) ?? null;
  const canEdit = !selectedId || Boolean(selected?.canEdit);
  const conditions = config.filters.conditions ?? [];
  const filterableFields = (currentMeta?.fields ?? []).filter((f) => config.fields.includes(f.key));

  useEffect(() => {
    if (!metaQ.data || config.fields.length) return;
    setConfig(emptyConfig("tat_events", metaQ.data.datasets, periodDefaults));
  }, [metaQ.data, config.fields.length, periodDefaults.from, periodDefaults.to]);

  const loadReport = (r: SavedReport) => {
    setSelectedId(r.id);
    setName(r.name);
    setConfig(normalizeConfig(r.config, datasets, periodDefaults));
    setRunResult(null);
    setRunError(null);
    setDirty(false);
    setConstructorTab("source");
  };

  const startNew = () => {
    setSelectedId(null);
    setName("Новый отчёт");
    setConfig(emptyConfig("tat_events", datasets, periodDefaults));
    setRunResult(null);
    setRunError(null);
    setDirty(true);
    setConstructorTab("source");
  };

  const patchConfig = (patch: Partial<ReportConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const setConditions = (next: FieldCondition[]) => {
    patchConfig({ filters: { conditions: next } });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (selectedId && canEdit) {
        return apiPatch<{ ok: true; id: string }>(`/api/reports/${selectedId}`, {
          name,
          description: null,
          config
        });
      }
      return apiPost<{ ok: true; id: string }>("/api/reports", {
        name,
        description: null,
        config
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["reports", "list"] });
      setSelectedId(res.id);
      setDirty(false);
    }
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!selectedId) return;
      await apiDelete(`/api/reports/${selectedId}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["reports", "list"] });
      startNew();
    }
  });

  const shareMut = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Сначала сохраните отчёт");
      return apiPost(`/api/reports/${selectedId}/shares`, { email: shareEmail.trim(), role: shareRole });
    },
    onSuccess: async () => {
      setShareEmail("");
      await qc.invalidateQueries({ queryKey: ["reports", "list"] });
    }
  });

  const unshareMut = useMutation({
    mutationFn: async (userId: string) => {
      if (!selectedId) return;
      await apiDelete(`/api/reports/${selectedId}/shares/${userId}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["reports", "list"] });
    }
  });

  const runMut = useMutation({
    mutationFn: async () => {
      setRunError(null);
      const from =
        config.periodFrom && config.periodTo
          ? dayjs(config.periodFrom).startOf("day").toISOString()
          : fromIso;
      const to =
        config.periodFrom && config.periodTo
          ? dayjs(config.periodTo).endOf("day").toISOString()
          : toIso;
      if (config.periodFrom && config.periodTo && !dayjs(config.periodTo).isAfter(dayjs(config.periodFrom).subtract(1, "day"))) {
        throw new Error("Дата «по» должна быть не раньше «с»");
      }
      return apiPost<RunResult>("/api/reports/run", {
        config,
        from,
        to,
        tzOffset
      });
    },
    onSuccess: (res) => setRunResult(res),
    onError: (e: any) => setRunError(String(e?.message ?? e))
  });

  const needsCompare = config.dataset === "compare_hangars" || config.dataset === "compare_events";
  const needsGrain = config.dataset.startsWith("util_");

  const exportXlsx = () => {
    if (!runResult) return;
    const flat = runResult.rows.map((row) => {
      const out: Record<string, any> = {};
      for (const col of runResult.columns) out[col.label] = row[col.key] ?? "";
      return out;
    });
    const wb = XLSX.utils.book_new();
    const periodText =
      config.periodFrom && config.periodTo
        ? `${dayjs(config.periodFrom).format("DD.MM.YYYY")} – ${dayjs(config.periodTo).format("DD.MM.YYYY")}`
        : periodLabel;
    const meta = [
      { Параметр: "Отчёт", Значение: name },
      { Параметр: "Период", Значение: periodText },
      { Параметр: "Источник", Значение: currentMeta?.label ?? config.dataset },
      { Параметр: "Строк", Значение: runResult.total },
      { Параметр: "Выгружено", Значение: dayjs().format("YYYY-MM-DD HH:mm") }
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), "Сводка");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat), "Данные");
    XLSX.writeFile(wb, `report-${dayjs().format("YYYY-MM-DD_HHmm")}.xlsx`);
  };

  const mine = (listQ.data?.reports ?? []).filter((r) => r.myRole === "OWNER");
  const shared = (listQ.data?.reports ?? []).filter((r) => r.myRole !== "OWNER");
  const saveEnabled = canEdit && dirty && Boolean(name.trim()) && !saveMut.isPending;

  return (
    <div className="reportBuilder">
      <aside className="reportBuilderSidebar card">
        <div className="reportBuilderSidebarHead">
          <strong>Отчёты</strong>
          <button type="button" className="btn btnGhost" onClick={startNew}>
            + Новый
          </button>
        </div>
        {listQ.isLoading ? <div className="muted">Загрузка…</div> : null}
        <div className="reportBuilderListGroup">
          <div className="muted small">Мои</div>
          {mine.length === 0 ? <div className="muted small">Пока нет сохранённых</div> : null}
          {mine.map((r) => (
            <button
              key={r.id}
              type="button"
              className={selectedId === r.id ? "reportBuilderListItem active" : "reportBuilderListItem"}
              onClick={() => loadReport(r)}
            >
              <span>{r.name}</span>
              <span className="muted small">{dayjs(r.updatedAt).format("DD.MM.YY")}</span>
            </button>
          ))}
        </div>
        <div className="reportBuilderListGroup">
          <div className="muted small">Доступные мне</div>
          {shared.length === 0 ? <div className="muted small">Нет расшаренных</div> : null}
          {shared.map((r) => (
            <button
              key={r.id}
              type="button"
              className={selectedId === r.id ? "reportBuilderListItem active" : "reportBuilderListItem"}
              onClick={() => loadReport(r)}
            >
              <span>{r.name}</span>
              <span className="muted small">{r.owner.displayName || r.owner.email}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="reportBuilderMain">
        <section className="card analyticsCard reportBuilderForm">
          <div className="reportBuilderFormHead">
            <label className="tgField reportBuilderNameField">
              <span className="tgFieldLabel">Название</span>
              <input
                className="evInput"
                value={name}
                disabled={!canEdit}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <div className="reportBuilderIconActions">
              <button
                type="button"
                className={`btn ganttIconBtn${saveEnabled ? " reportBuilderIconActive" : ""}`}
                disabled={!saveEnabled}
                title={dirty ? "Сохранить изменения" : "Нет изменений"}
                aria-label="Сохранить"
                onClick={() => saveMut.mutate()}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h10l2 2v10H4z" />
                  <path d="M7 4v4h7" />
                  <path d="M7 16v-5h6v5" />
                </svg>
              </button>
              <button
                type="button"
                className="btn ganttIconBtn"
                disabled={runMut.isPending}
                title="Сформировать отчёт"
                aria-label="Сформировать"
                onClick={() => runMut.mutate()}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 3.5v13l11-6.5z" />
                </svg>
              </button>
              <button
                type="button"
                className="btn ganttIconBtn"
                disabled={!runResult}
                title="Выгрузить в Excel"
                aria-label="Excel"
                onClick={exportXlsx}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 2h7l4 4v12H5z" />
                  <path d="M12 2v4h4" />
                  <path d="M7 14l2-4" />
                  <path d="M11 14l-2-4" />
                  <path d="M12.5 14h2.5" />
                  <path d="M12.5 10h2.5" />
                </svg>
              </button>
              {selectedId && selected?.myRole === "OWNER" ? (
                <button
                  type="button"
                  className="btn ganttIconBtn"
                  disabled={deleteMut.isPending}
                  title="Удалить отчёт"
                  aria-label="Удалить"
                  onClick={() => {
                    if (confirm("Удалить отчёт?")) deleteMut.mutate();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 6h12" />
                    <path d="M8 6V4h4v2" />
                    <path d="M6.5 6l.5 10h6l.5-10" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>

          <div className="sandboxesTabs reportBuilderTabs">
            {(
              [
                ["source", "Источник"],
                ["fields", "Поля"],
                ["filters", "Отбор"],
                ["sort", "Сортировка"],
                ["access", "Доступ"]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={constructorTab === id ? "sandboxesTab active" : "sandboxesTab"}
                onClick={() => setConstructorTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {constructorTab === "source" ? (
            <div className="reportBuilderSection">
              <p className="muted small">Выберите набор данных — от него зависят поля, отборы и смысл отчёта.</p>
              <div className="reportDatasetGrid">
                {datasets.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!canEdit}
                    className={config.dataset === d.id ? "reportDatasetCard active" : "reportDatasetCard"}
                    onClick={() =>
                      patchConfig({
                        dataset: d.id,
                        fields: d.defaultFields,
                        sort: [],
                        filters: { conditions: [] },
                        periodFrom: config.periodFrom ?? periodDefaults.from,
                        periodTo: config.periodTo ?? periodDefaults.to
                      })
                    }
                  >
                    <strong>{d.label}</strong>
                    <span className="muted small">{d.description}</span>
                  </button>
                ))}
              </div>
              {needsGrain ? (
                <label className="tgField" style={{ marginTop: 12, maxWidth: 220 }}>
                  <span className="tgFieldLabel">Детализация</span>
                  <select
                    value={config.grain ?? "week"}
                    disabled={!canEdit}
                    onChange={(e) => patchConfig({ grain: e.target.value as ReportConfig["grain"] })}
                  >
                    <option value="day">Сутки</option>
                    <option value="week">Неделя</option>
                    <option value="month">Месяц</option>
                    <option value="period">Весь период</option>
                  </select>
                </label>
              ) : null}
              {needsCompare ? (
                <div className="reportBuilderCompareRow">
                  <label className="tgField">
                    <span className="tgFieldLabel">Сценарий A</span>
                    <select
                      value={config.compareA ?? "prod"}
                      disabled={!canEdit}
                      onChange={(e) => patchConfig({ compareA: e.target.value })}
                    >
                      <option value="prod">Рабочий контур</option>
                      {sandboxes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="tgField">
                    <span className="tgFieldLabel">Сценарий B</span>
                    <select
                      value={config.compareB ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => patchConfig({ compareB: e.target.value })}
                    >
                      <option value="">— выберите —</option>
                      <option value="prod">Рабочий контур</option>
                      {sandboxes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {constructorTab === "fields" ? (
            <div className="reportBuilderSection">
              <p className="muted small">Отметьте поля и задайте порядок вывода.</p>
              <div className="reportFieldsLayout">
                <div className="reportFieldsAvailable">
                  {(currentMeta?.fields ?? []).map((f) => {
                    const checked = config.fields.includes(f.key);
                    return (
                      <label key={f.key} className="reportFieldCheck">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={checked}
                          onChange={() => {
                            if (!canEdit) return;
                            const nextFields = checked
                              ? config.fields.filter((x) => x !== f.key)
                              : [...config.fields, f.key];
                            const nextConditions = (config.filters.conditions ?? []).filter((c) =>
                              nextFields.includes(c.field)
                            );
                            patchConfig({
                              fields: nextFields,
                              filters: { conditions: nextConditions }
                            });
                          }}
                        />
                        <span>{f.label}</span>
                        <span className="muted small">{f.type}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="reportFieldsOrder">
                  <div className="muted small">Порядок колонок</div>
                  {config.fields.map((key, idx) => {
                    const f = currentMeta?.fields.find((x) => x.key === key);
                    return (
                      <div key={key} className="reportFieldOrderRow">
                        <span>{f?.label ?? key}</span>
                        <div className="reportFieldOrderBtns">
                          <button
                            type="button"
                            className="btn btnGhost"
                            disabled={!canEdit || idx === 0}
                            onClick={() => patchConfig({ fields: moveItem(config.fields, idx, idx - 1) })}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btnGhost"
                            disabled={!canEdit || idx === config.fields.length - 1}
                            onClick={() => patchConfig({ fields: moveItem(config.fields, idx, idx + 1) })}
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {constructorTab === "filters" ? (
            <div className="reportBuilderSection">
              <div className="reportBuilderPeriodRow">
                <label className="tgField">
                  <span className="tgFieldLabel">Период с</span>
                  <input
                    type="date"
                    disabled={!canEdit}
                    value={config.periodFrom ?? ""}
                    onChange={(e) => patchConfig({ periodFrom: e.target.value || null })}
                  />
                </label>
                <label className="tgField">
                  <span className="tgFieldLabel">по</span>
                  <input
                    type="date"
                    disabled={!canEdit}
                    value={config.periodTo ?? ""}
                    onChange={(e) => patchConfig({ periodTo: e.target.value || null })}
                  />
                </label>
              </div>
              {config.periodFrom &&
              config.periodTo &&
              dayjs(config.periodTo).isBefore(dayjs(config.periodFrom), "day") ? (
                <div className="error">Дата «по» должна быть не раньше «с»</div>
              ) : null}

              <p className="muted small">
                Условия по выбранным полям отчёта. Сначала отметьте поля на вкладке «Поля».
              </p>

              {filterableFields.length === 0 ? (
                <div className="muted">Нет выбранных полей для отбора.</div>
              ) : (
                <>
                  {conditions.map((c, idx) => {
                    const fieldDef = filterableFields.find((f) => f.key === c.field) ?? filterableFields[0]!;
                    const ops = OPS_BY_TYPE[fieldDef.type];
                    const needsValue = c.op !== "empty" && c.op !== "notEmpty";
                    return (
                      <div key={idx} className="reportConditionRow">
                        <select
                          disabled={!canEdit}
                          value={c.field}
                          onChange={(e) => {
                            const nextField = e.target.value;
                            const def = filterableFields.find((f) => f.key === nextField);
                            const nextOps = OPS_BY_TYPE[def?.type ?? "string"];
                            const next = [...conditions];
                            next[idx] = {
                              field: nextField,
                              op: nextOps.some((o) => o.op === c.op) ? c.op : nextOps[0]!.op,
                              value: c.value
                            };
                            setConditions(next);
                          }}
                        >
                          {filterableFields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                        <select
                          disabled={!canEdit}
                          value={c.op}
                          onChange={(e) => {
                            const next = [...conditions];
                            next[idx] = { ...c, op: e.target.value as FilterOp };
                            setConditions(next);
                          }}
                        >
                          {ops.map((o) => (
                            <option key={o.op} value={o.op}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {needsValue ? (
                          <input
                            className="evInput"
                            disabled={!canEdit}
                            value={c.value ?? ""}
                            placeholder="значение"
                            onChange={(e) => {
                              const next = [...conditions];
                              next[idx] = { ...c, value: e.target.value };
                              setConditions(next);
                            }}
                          />
                        ) : (
                          <span className="muted small">—</span>
                        )}
                        <button
                          type="button"
                          className="btn btnGhost"
                          disabled={!canEdit}
                          onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}
                        >
                          Убрать
                        </button>
                      </div>
                    );
                  })}
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn btnGhost"
                      onClick={() =>
                        setConditions([
                          ...conditions,
                          {
                            field: filterableFields[0]!.key,
                            op: OPS_BY_TYPE[filterableFields[0]!.type][0]!.op,
                            value: ""
                          }
                        ])
                      }
                    >
                      + Условие
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {constructorTab === "sort" ? (
            <div className="reportBuilderSection">
              <p className="muted small">До 3 уровней сортировки.</p>
              {(config.sort.length ? config.sort : [{ field: "", dir: "asc" as const }]).map((s, idx) => (
                <div key={idx} className="reportSortRow">
                  <select
                    disabled={!canEdit}
                    value={s.field}
                    onChange={(e) => {
                      const next = [...config.sort];
                      while (next.length <= idx) next.push({ field: "", dir: "asc" });
                      next[idx] = { field: e.target.value, dir: next[idx]?.dir ?? "asc" };
                      patchConfig({ sort: next.filter((x) => x.field) });
                    }}
                  >
                    <option value="">— поле —</option>
                    {(currentMeta?.fields ?? [])
                      .filter((f) => config.fields.includes(f.key))
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                  </select>
                  <select
                    disabled={!canEdit || !s.field}
                    value={s.dir}
                    onChange={(e) => {
                      const next = [...config.sort];
                      if (!next[idx]) return;
                      next[idx] = { ...next[idx]!, dir: e.target.value as "asc" | "desc" };
                      patchConfig({ sort: next });
                    }}
                  >
                    <option value="asc">По возрастанию</option>
                    <option value="desc">По убыванию</option>
                  </select>
                  <button
                    type="button"
                    className="btn btnGhost"
                    disabled={!canEdit}
                    onClick={() => patchConfig({ sort: config.sort.filter((_, i) => i !== idx) })}
                  >
                    Убрать
                  </button>
                </div>
              ))}
              {canEdit && config.sort.length < 3 ? (
                <button
                  type="button"
                  className="btn btnGhost"
                  onClick={() =>
                    patchConfig({
                      sort: [...config.sort, { field: config.fields[0] ?? "", dir: "asc" }]
                    })
                  }
                >
                  + Уровень
                </button>
              ) : null}
            </div>
          ) : null}

          {constructorTab === "access" ? (
            <div className="reportBuilderSection">
              {!selectedId ? (
                <div className="muted">Сохраните отчёт, чтобы делиться им с коллегами.</div>
              ) : selected?.myRole !== "OWNER" ? (
                <div className="muted">
                  Владелец: {selected?.owner.displayName || selected?.owner.email}. Ваша роль: {selected?.myRole}.
                </div>
              ) : (
                <>
                  <div className="reportShareForm">
                    <input
                      className="evInput"
                      placeholder="email пользователя"
                      value={shareEmail}
                      onChange={(e) => setShareEmail(e.target.value)}
                    />
                    <select value={shareRole} onChange={(e) => setShareRole(e.target.value as "VIEWER" | "EDITOR")}>
                      <option value="VIEWER">Просмотр</option>
                      <option value="EDITOR">Редактирование</option>
                    </select>
                    <button
                      type="button"
                      className="btn"
                      disabled={!shareEmail.trim() || shareMut.isPending}
                      onClick={() => shareMut.mutate()}
                    >
                      Поделиться
                    </button>
                  </div>
                  {shareMut.isError ? (
                    <div className="error">{String((shareMut.error as any)?.message ?? shareMut.error)}</div>
                  ) : null}
                  <ul className="reportShareList">
                    {(selected?.shares ?? []).map((s) => (
                      <li key={s.userId}>
                        <span>
                          {s.displayName || s.email} · {s.role === "EDITOR" ? "редактор" : "просмотр"}
                        </span>
                        <button type="button" className="btn btnGhost" onClick={() => unshareMut.mutate(s.userId)}>
                          Забрать
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}
        </section>

        <section className="card analyticsCard">
          <div className="analyticsEffHeader">
            <div>
              <h3>Результат</h3>
              <p className="muted small">
                {runResult
                  ? `${runResult.total} строк · ${dayjs(runResult.period.from).format("DD.MM.YYYY")} – ${dayjs(runResult.period.to).format("DD.MM.YYYY")}`
                  : "Нажмите «Сформировать», чтобы получить таблицу по схеме отчёта"}
              </p>
            </div>
          </div>
          {runMut.isPending ? <div className="muted">Формирование…</div> : null}
          {runError ? <div className="error">{runError}</div> : null}
          {runResult ? (
            <div className="analyticsTableWrap">
              <table className="analyticsTable">
                <thead>
                  <tr>
                    {runResult.columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runResult.rows.slice(0, 200).map((row, i) => (
                    <tr key={i}>
                      {runResult.columns.map((c) => (
                        <td key={c.key}>{row[c.key] == null || row[c.key] === "" ? "—" : String(row[c.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {runResult.rows.length > 200 ? <div className="muted">Показаны первые 200 строк</div> : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
