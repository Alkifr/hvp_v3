import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost, apiPut } from "../../lib/api";
import { isValidDateInput } from "../../lib/dateInput";
import { resolveFieldPick, suggestFieldPick } from "../../lib/reportFieldPick";
import { authMe } from "../auth/authApi";
import { SwitchToggle } from "../components/SwitchToggle";

type PeriodMode = "last1" | "last7" | "last30" | "custom";
type ScheduleMode = "manual" | "daily" | "weekly" | "monthly";
type WizardTab = "what" | "when" | "who" | "history";

type DigestColumnDef = { key: string; label: string; hint: string };

type MailCompose = {
  recipients: string[];
  subjectTemplate: string;
  description: string;
  periodMode: PeriodMode;
  periodCustomFrom: string | null;
  periodCustomTo: string | null;
  scheduleMode: ScheduleMode;
  scheduleTime: string;
  scheduleWeekdays: number[];
  scheduleMonthDay: number;
  isActive: boolean;
  lastAutoSentAt: string | null;
  columns: string[];
  columnCatalog: DigestColumnDef[];
  mailFrom: string | null;
  smtpReady: boolean;
};

type MailPreview = {
  text: string;
  html: string;
  stats: {
    operators: number;
    prolonged: number;
    cancelled: number;
    added: number;
    otherChanges: number;
    audits: number;
  };
};

type HistoryItem = {
  id: string;
  createdAt: string;
  status: string;
  target: string;
  actorEmail: string | null;
  recipients: string[];
  subject: string;
  error: string | null;
};

const WEEKDAYS: { id: number; label: string }[] = [
  { id: 1, label: "Пн" },
  { id: 2, label: "Вт" },
  { id: 3, label: "Ср" },
  { id: 4, label: "Чт" },
  { id: 5, label: "Пт" },
  { id: 6, label: "Сб" },
  { id: 7, label: "Вс" }
];

const PERIODS: { id: PeriodMode; title: string; hint: string }[] = [
  { id: "last1", title: "За вчера", hint: "Календарный день по Москве" },
  { id: "last7", title: "За 7 дней", hint: "Включая сегодня" },
  { id: "last30", title: "За 30 дней", hint: "Включая сегодня" },
  { id: "custom", title: "Произвольный период", hint: "Даты начала и окончания" }
];

const DEFAULT_COLUMNS = ["kind", "aircraftType", "aircraft", "title", "detail", "previous"];
const FALLBACK_CATALOG: DigestColumnDef[] = [
  { key: "kind", label: "Тип изменения", hint: "Добавлено, перенос или отменено" },
  { key: "operator", label: "Оператор", hint: "Колонка; блоки письма по-прежнему группируются по оператору" },
  { key: "aircraftType", label: "Тип ВС", hint: "Название типа, не код ICAO" },
  { key: "aircraftTypeCode", label: "Код типа ВС", hint: "ICAO" },
  { key: "aircraft", label: "Борт", hint: "Название — бортовой номер" },
  { key: "aircraftCode", label: "Код борта", hint: "Серийный номер" },
  { key: "title", label: "Работы", hint: "Название события" },
  { key: "detail", label: "Изменение", hint: "Что изменилось в периоде" },
  { key: "period", label: "Период", hint: "Даты события" },
  { key: "previous", label: "Ранее", hint: "Предыдущие даты" }
];

function defaultCustomDates(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function formatMsk(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function statusLabel(status: string): string {
  if (status === "SENT") return "Отправлено";
  if (status === "EMPTY") return "Нет изменений";
  if (status === "FAILED") return "Ошибка";
  return status;
}

function targetLabel(target: string): string {
  if (target === "self") return "Себе";
  if (target === "schedule") return "По расписанию";
  return "Всем";
}

export function MailDigestView() {
  const qc = useQueryClient();
  const customDefaults = useMemo(() => defaultCustomDates(), []);
  const [tab, setTab] = useState<WizardTab>("what");
  const [subject, setSubject] = useState("Изменения плана ТО");
  const [description, setDescription] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("last7");
  const [fromDate, setFromDate] = useState(customDefaults.from);
  const [toDate, setToDate] = useState(customDefaults.to);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("manual");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [monthDay, setMonthDay] = useState(1);
  const [isActive, setIsActive] = useState(true);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [columnDraft, setColumnDraft] = useState("");
  const [columnPickOpen, setColumnPickOpen] = useState(false);
  const [columnPickIndex, setColumnPickIndex] = useState(0);
  const [emailDraft, setEmailDraft] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewStats, setPreviewStats] = useState<MailPreview["stats"] | null>(null);
  const [sendMenu, setSendMenu] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const meQ = useQuery({ queryKey: ["auth", "me"], queryFn: () => authMe(), retry: 0, staleTime: 60_000 });
  const myEmail = meQ.data && meQ.data.ok ? meQ.data.user.email : "";

  const composeQ = useQuery({
    queryKey: ["mail-digest", "compose"],
    queryFn: () => apiGet<MailCompose>("/api/mail-digest/compose")
  });

  const historyQ = useQuery({
    queryKey: ["mail-digest", "history"],
    queryFn: () => apiGet<{ items: HistoryItem[] }>("/api/mail-digest/history"),
    enabled: tab === "history"
  });

  useEffect(() => {
    if (!composeQ.data || hydrated) return;
    const s = composeQ.data;
    setSubject(s.subjectTemplate || "Изменения плана ТО");
    setDescription(s.description || "");
    setPeriodMode(s.periodMode || "last7");
    setFromDate(s.periodCustomFrom || customDefaults.from);
    setToDate(s.periodCustomTo || customDefaults.to);
    setScheduleMode(s.scheduleMode || "manual");
    setScheduleTime(s.scheduleTime || "09:00");
    setWeekdays(s.scheduleWeekdays?.length ? s.scheduleWeekdays : [1, 2, 3, 4, 5]);
    setMonthDay(s.scheduleMonthDay || 1);
    setIsActive(s.isActive);
    setRecipients(s.recipients);
    setColumns(s.columns?.length ? s.columns : DEFAULT_COLUMNS);
    setHydrated(true);
  }, [composeQ.data, hydrated, customDefaults]);

  const periodPayload = () => {
    if (periodMode === "custom" && (!isValidDateInput(fromDate) || !isValidDateInput(toDate))) {
      throw new Error("Укажите корректный период");
    }
    return {
      periodMode,
      customFrom: fromDate,
      customTo: toDate,
      columns
    };
  };

  const composePayload = () => {
    const scheduled = scheduleMode !== "manual";
    return {
      recipients,
      subjectTemplate: subject.trim() || "Изменения плана ТО",
      description: description.trim() || null,
      periodMode: scheduled && periodMode === "custom" ? "last7" : periodMode,
      periodCustomFrom: fromDate || null,
      periodCustomTo: toDate || null,
      scheduleMode,
      scheduleTime,
      scheduleWeekdays: weekdays,
      scheduleMonthDay: monthDay,
      isActive,
      columns
    };
  };

  const saveComposeM = useMutation({
    mutationFn: () => apiPut<MailCompose>("/api/mail-digest/compose", composePayload()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mail-digest", "compose"] });
    }
  });

  const previewM = useMutation({
    mutationFn: () => apiPost<MailPreview>("/api/mail-digest/preview", periodPayload()),
    onSuccess: (res) => {
      setPreviewText(res.text);
      setPreviewHtml(res.html);
      setPreviewStats(res.stats);
    }
  });

  const sendM = useMutation({
    mutationFn: (target: "self" | "all") =>
      apiPost<{ ok: true; messageId: string; recipients: string[]; subject: string }>("/api/mail-digest/send", {
        ...periodPayload(),
        recipients,
        subject: subject.trim() || "Изменения плана ТО",
        text: previewText.trim() || undefined,
        html: previewHtml.trim() || undefined,
        target
      }),
    onSuccess: async () => {
      setSendMenu(false);
      await qc.invalidateQueries({ queryKey: ["mail-digest", "history"] });
    }
  });

  const toggleActiveM = useMutation({
    mutationFn: (next: boolean) => apiPut<MailCompose>("/api/mail-digest/compose", { isActive: next }),
    onSuccess: async (s) => {
      setIsActive(s.isActive);
      await qc.invalidateQueries({ queryKey: ["mail-digest", "compose"] });
    }
  });

  const smtpReady = composeQ.data?.smtpReady ?? false;
  const effectivePeriod = scheduleMode !== "manual" && periodMode === "custom" ? "last7" : periodMode;
  const columnCatalog = composeQ.data?.columnCatalog?.length ? composeQ.data.columnCatalog : FALLBACK_CATALOG;
  const remainingColumns = columnCatalog.filter((c) => !columns.includes(c.key));
  const columnSuggestions = useMemo(
    () =>
      suggestFieldPick(
        columnDraft,
        columnCatalog.map((c) => ({ key: c.key, label: c.label })),
        columns
      ),
    [columnDraft, columnCatalog, columns]
  );

  const addDigestColumns = (keys: string[]) => {
    const known = new Set(columnCatalog.map((c) => c.key));
    setColumns((prev) => {
      const add = keys.filter((key) => known.has(key) && !prev.includes(key));
      return add.length ? [...prev, ...add] : prev;
    });
    setColumnDraft("");
    setColumnPickOpen(false);
  };

  const submitColumnPick = (fromSuggestion = false) => {
    if (fromSuggestion && columnSuggestions[columnPickIndex]) {
      addDigestColumns([columnSuggestions[columnPickIndex]!.key]);
      return;
    }
    const { keys } = resolveFieldPick(
      columnDraft,
      columnCatalog.map((c) => ({ key: c.key, label: c.label }))
    );
    if (keys.length) {
      addDigestColumns(keys);
      return;
    }
    if (columnSuggestions[0]) addDigestColumns([columnSuggestions[0].key]);
  };

  const moveColumn = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= columns.length) return;
    setColumns((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(next, 0, item!);
      return copy;
    });
  };

  const addRecipient = () => {
    const email = emailDraft.trim().toLowerCase();
    if (!isEmail(email)) return;
    if (recipients.includes(email)) {
      setEmailDraft("");
      return;
    }
    setRecipients((prev) => [...prev, email]);
    setEmailDraft("");
  };

  const steps: { id: WizardTab; n?: number; label: string }[] = [
    { id: "what", n: 1, label: "Что" },
    { id: "when", n: 2, label: "Когда" },
    { id: "who", n: 3, label: "Кому" },
    { id: "history", label: "История" }
  ];

  return (
    <div className="mailDigestPage">
      <header className="mailDigestHeader">
        <div className="mailDigestTitleBlock">
          <input
            className="mailDigestName"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Название рассылки"
            placeholder="Название рассылки"
          />
          <textarea
            className="mailDigestDesc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Описание (необязательно)"
          />
        </div>
        <button
          type="button"
          className={`mailStatusChip ${isActive ? "mailStatusChipOn" : "mailStatusChipOff"}`}
          disabled={toggleActiveM.isPending}
          onClick={() => toggleActiveM.mutate(!isActive)}
          title={isActive ? "Приостановить" : "Запустить"}
        >
          {isActive ? "Активна" : "На паузе"}
        </button>
      </header>

      {!smtpReady && composeQ.data ? (
        <div className="error">Почта ещё не настроена. Попросите администратора указать SMTP в админке.</div>
      ) : null}
      {composeQ.error ? <div className="error">{String((composeQ.error as Error).message || composeQ.error)}</div> : null}

      <nav className="mailWizardSteps" aria-label="Шаги рассылки">
        {steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`mailWizardStep ${tab === s.id ? "mailWizardStepActive" : ""}`}
            onClick={() => setTab(s.id)}
          >
            {s.n ? <span className="mailWizardNum">{s.n}</span> : null}
            <span>{s.label}</span>
            {i < steps.length - 1 ? <span className="mailWizardLine" aria-hidden="true" /> : null}
          </button>
        ))}
      </nav>

      <section className="card mailWizardCard">
        {tab === "what" ? (
          <div className="mailWizardBody">
            <div>
              <strong>Содержание письма</strong>
              <div className="muted adminHint">
                В рассылку попадают изменения рабочего контура. Тема письма совпадает с названием рассылки.
              </div>
            </div>

            <div className="mailPeriodGrid">
              {PERIODS.map((p) => {
                const disabled = scheduleMode !== "manual" && p.id === "custom";
                const checked = effectivePeriod === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`mailChoiceCard ${checked ? "mailChoiceCardOn" : ""}`}
                    disabled={disabled}
                    onClick={() => setPeriodMode(p.id)}
                  >
                    <span className="mailChoiceTitle">{p.title}</span>
                    <span className="muted">{p.hint}</span>
                  </button>
                );
              })}
            </div>

            {effectivePeriod === "custom" ? (
              <div className="adminFormRow adminFormRowWrap">
                <label className="adminField">
                  <span className="muted">с</span>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </label>
                <label className="adminField">
                  <span className="muted">по</span>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </label>
              </div>
            ) : null}

            {scheduleMode !== "manual" && periodMode === "custom" ? (
              <div className="muted adminHint">Для расписания произвольный период недоступен — берём последние 7 дней.</div>
            ) : null}

            <div>
              <strong>Поля письма</strong>
              <div className="muted adminHint">
                «Борт» — бортовой номер (название), не серийный код. Код борта и код типа ВС (ICAO) можно добавить отдельно.
              </div>
            </div>
            <div className="mailChipRow">
              {columns.map((key, idx) => {
                const def = columnCatalog.find((c) => c.key === key);
                return (
                  <span key={key} className="mailChip mailFieldChip" title={def?.hint}>
                    {def?.label ?? key}
                    <button type="button" className="mailChipRemove" disabled={idx === 0} onClick={() => moveColumn(idx, -1)} aria-label="Выше">
                      ↑
                    </button>
                    <button
                      type="button"
                      className="mailChipRemove"
                      disabled={idx === columns.length - 1}
                      onClick={() => moveColumn(idx, 1)}
                      aria-label="Ниже"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="mailChipRemove"
                      disabled={columns.length <= 1}
                      aria-label={`Убрать ${def?.label ?? key}`}
                      onClick={() => setColumns((prev) => prev.filter((x) => x !== key))}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="reportFieldPick mailColumnPick">
              <input
                className="evInput"
                value={columnDraft}
                placeholder="Набрать поле: борт, тип ВС, код борта…"
                onFocus={() => setColumnPickOpen(true)}
                onChange={(e) => {
                  setColumnDraft(e.target.value);
                  setColumnPickOpen(true);
                  setColumnPickIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" && columnSuggestions.length) {
                    e.preventDefault();
                    setColumnPickIndex((i) => (i + 1) % columnSuggestions.length);
                    return;
                  }
                  if (e.key === "ArrowUp" && columnSuggestions.length) {
                    e.preventDefault();
                    setColumnPickIndex((i) => (i - 1 + columnSuggestions.length) % columnSuggestions.length);
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitColumnPick(columnPickOpen && columnSuggestions.length > 0);
                  }
                }}
              />
              <button type="button" className="btn" disabled={!columnDraft.trim()} onClick={() => submitColumnPick(false)}>
                Добавить
              </button>
              {remainingColumns.length ? (
                <select
                  className="evInput"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addDigestColumns([e.target.value]);
                  }}
                  aria-label="Добавить поле из списка"
                >
                  <option value="">Ещё поле…</option>
                  {remainingColumns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {columnPickOpen && columnSuggestions.length > 0 ? (
                <div className="reportFieldPickMenu" role="listbox">
                  {columnSuggestions.map((f, idx) => (
                    <button
                      key={f.key}
                      type="button"
                      role="option"
                      className={`reportFieldPickOption${idx === columnPickIndex ? " reportFieldPickOptionOn" : ""}`}
                      onMouseEnter={() => setColumnPickIndex(idx)}
                      onClick={() => addDigestColumns([f.key])}
                    >
                      <span>{f.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="adminFormRow">
              <button className="btn" disabled={previewM.isPending} onClick={() => previewM.mutate()}>
                Предпросмотр
              </button>
            </div>

            {previewM.error ? <div className="error">{String(previewM.error.message || previewM.error)}</div> : null}
            {previewStats ? (
              <div className="muted">
                Аудит: {previewStats.audits}; операторов: {previewStats.operators}; продлений: {previewStats.prolonged};
                отмен: {previewStats.cancelled}; добавлено: {previewStats.added}; прочих сдвигов: {previewStats.otherChanges}
              </div>
            ) : null}

            {previewHtml ? (
              <div className="adminMailPreview">
                <div className="muted" style={{ marginBottom: 8 }}>
                  Превью письма
                </div>
                <div className="adminMailPreviewFrame" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            ) : (
              <div className="muted">Нажмите «Предпросмотр», чтобы собрать изменения.</div>
            )}

            {previewText ? (
              <label className="adminField adminFieldGrow">
                <span className="muted">Текстовая версия (можно править перед отправкой)</span>
                <textarea
                  rows={8}
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  style={{ width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", resize: "vertical" }}
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {tab === "when" ? (
          <div className="mailWizardBody">
            <div>
              <strong>Отправка</strong>
              <div className="muted adminHint">Время указывается по Москве (MSK). На паузе расписание не срабатывает.</div>
            </div>

            <div className="mailPeriodGrid">
              <button
                type="button"
                className={`mailChoiceCard ${scheduleMode === "manual" ? "mailChoiceCardOn" : ""}`}
                onClick={() => setScheduleMode("manual")}
              >
                <span className="mailChoiceTitle">Только вручную</span>
                <span className="muted">Кнопка «Отправить» внизу экрана</span>
              </button>
              <button
                type="button"
                className={`mailChoiceCard ${scheduleMode !== "manual" ? "mailChoiceCardOn" : ""}`}
                onClick={() => setScheduleMode(scheduleMode === "manual" ? "daily" : scheduleMode)}
              >
                <span className="mailChoiceTitle">По расписанию</span>
                <span className="muted">День, неделя или месяц</span>
              </button>
            </div>

            {scheduleMode !== "manual" ? (
              <>
                <div className="mailSeg" role="tablist" aria-label="Периодичность">
                  {(
                    [
                      ["daily", "День"],
                      ["weekly", "Неделя"],
                      ["monthly", "Месяц"]
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`mailSegBtn ${scheduleMode === id ? "mailSegBtnOn" : ""}`}
                      onClick={() => setScheduleMode(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {scheduleMode === "weekly" ? (
                  <div className="mailWeekdays">
                    {WEEKDAYS.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={`mailWeekday ${weekdays.includes(d.id) ? "mailWeekdayOn" : ""}`}
                        onClick={() =>
                          setWeekdays((prev) => (prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id].sort((a, b) => a - b)))
                        }
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {scheduleMode === "monthly" ? (
                  <label className="adminField">
                    <span className="muted">Число месяца</span>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={monthDay}
                      onChange={(e) => setMonthDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
                    />
                  </label>
                ) : null}

                <label className="adminField">
                  <span className="muted">Время (МСК)</span>
                  <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value || "09:00")} />
                </label>
              </>
            ) : null}

            <SwitchToggle
              checked={isActive}
              onChange={(next) => {
                setIsActive(next);
                toggleActiveM.mutate(next);
              }}
              label={isActive ? "Рассылка активна" : "Рассылка на паузе"}
              hint="На паузе письма по расписанию не уходят"
            />
          </div>
        ) : null}

        {tab === "who" ? (
          <div className="mailWizardBody">
            <div>
              <strong>Получатели</strong>
              <div className="muted adminHint">Список общий для всех планировщиков. Можно отправить письмо только себе.</div>
            </div>

            <div className="mailChipRow">
              {recipients.length ? (
                recipients.map((email) => (
                  <span key={email} className="mailChip">
                    {email}
                    <button
                      type="button"
                      className="mailChipRemove"
                      aria-label={`Удалить ${email}`}
                      onClick={() => setRecipients((prev) => prev.filter((x) => x !== email))}
                    >
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <span className="muted">Пока никого нет — добавьте адрес ниже.</span>
              )}
            </div>

            <div className="adminFormRow adminFormRowWrap">
              <label className="adminField adminFieldGrow">
                <span className="muted">Email</span>
                <input
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRecipient();
                    }
                  }}
                  placeholder="name@company.com"
                />
              </label>
              <button className="btn" type="button" onClick={addRecipient} disabled={!isEmail(emailDraft)}>
                Добавить
              </button>
            </div>
          </div>
        ) : null}

        {tab === "history" ? (
          <div className="mailWizardBody">
            <div>
              <strong>История</strong>
              <div className="muted adminHint">Дата, время и статус последних отправок.</div>
            </div>
            {historyQ.isLoading ? <div className="muted">Загрузка…</div> : null}
            {historyQ.error ? <div className="error">{String((historyQ.error as Error).message || historyQ.error)}</div> : null}
            {historyQ.data?.items.length ? (
              <div className="mailHistoryWrap">
                <table className="mailHistoryTable">
                  <thead>
                    <tr>
                      <th>Когда</th>
                      <th>Статус</th>
                      <th>Кому</th>
                      <th>Тема</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyQ.data.items.map((row) => (
                      <tr key={row.id}>
                        <td>{formatMsk(row.createdAt)}</td>
                        <td>
                          <span className={`mailHistStatus mailHistStatus_${row.status}`}>{statusLabel(row.status)}</span>
                          {row.error ? <div className="muted">{row.error}</div> : null}
                        </td>
                        <td>
                          {targetLabel(row.target)}
                          {row.recipients.length ? (
                            <div className="muted">{row.recipients.join(", ")}</div>
                          ) : null}
                        </td>
                        <td>{row.subject}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : historyQ.data ? (
              <div className="muted">Пока не было отправок.</div>
            ) : null}
          </div>
        ) : null}
      </section>

      <footer className="mailWizardFooter">
        <div className="mailWizardFooterLeft">
          <button className="btn btnPrimary" disabled={saveComposeM.isPending} onClick={() => saveComposeM.mutate()}>
            Сохранить
          </button>
          {saveComposeM.isSuccess ? <span className="muted">Сохранено</span> : null}
          {saveComposeM.error ? <span className="error">{String(saveComposeM.error.message || saveComposeM.error)}</span> : null}
        </div>
        <div className="mailSendWrap">
          {sendM.data ? (
            <span className="muted">
              Отправлено ({sendM.data.recipients.length}): {sendM.data.recipients.join(", ")}
            </span>
          ) : null}
          {sendM.error ? <span className="error">{String(sendM.error.message || sendM.error)}</span> : null}
          <button
            type="button"
            className="btn"
            disabled={sendM.isPending || !smtpReady}
            onClick={() => setSendMenu((v) => !v)}
          >
            Отправить
          </button>
          {sendMenu ? (
            <div className="mailSendMenu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={sendM.isPending || !myEmail}
                onClick={() => sendM.mutate("self")}
              >
                Только себе{myEmail ? ` (${myEmail})` : ""}
              </button>
              <button type="button" role="menuitem" disabled={sendM.isPending || !recipients.length} onClick={() => sendM.mutate("all")}>
                Всем получателям
              </button>
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
