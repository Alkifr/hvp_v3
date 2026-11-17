import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost, apiPut } from "../../lib/api";

type Template = { subjectTemplate: string; bodyTemplate: string };
type SendItem = {
  id: string;
  fromMsk: string;
  toMsk: string;
  actor: string;
  subject: string;
  recipients: string[];
  sentMsk: string;
  rowCount: number;
  messageId: string;
};

function parseEmails(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.includes("@"))
    )
  ];
}

export function TowRegistryMailPanel() {
  const qc = useQueryClient();
  const templateQ = useQuery({
    queryKey: ["tow-mail-template"],
    queryFn: () => apiGet<Template>("/api/mail-digest/tow-template")
  });
  const sendsQ = useQuery({
    queryKey: ["tows-sends"],
    queryFn: () => apiGet<{ items: SendItem[] }>("/api/tows/sends")
  });
  const [subject, setSubject] = useState("Реестр буксировок {{period}}");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!templateQ.data) return;
    setSubject(templateQ.data.subjectTemplate);
    setBody(templateQ.data.bodyTemplate);
  }, [templateQ.data]);

  const saveM = useMutation({
    mutationFn: () => apiPut<Template>("/api/mail-digest/tow-template", { subjectTemplate: subject, bodyTemplate: body }),
    onSuccess: async () => {
      setMessage("Шаблон сохранён.");
      await qc.invalidateQueries({ queryKey: ["tow-mail-template"] });
    }
  });
  const sendM = useMutation({
    mutationFn: () => {
      const list = parseEmails(recipients);
      if (!selectedId) throw new Error("Выберите зафиксированную версию");
      if (!list.length) throw new Error("Укажите получателей");
      return apiPost<{ subject: string; recipients: string[]; rows: number }>("/api/tows/dispatch", {
        sendId: selectedId,
        recipients: list,
        target: "list"
      });
    },
    onSuccess: async (res) => {
      setMessage(`Письмо «${res.subject}» отправлено: ${res.recipients.join(", ")}. Вложений: Excel, строк ${res.rows}.`);
      await qc.invalidateQueries({ queryKey: ["tows-sends"] });
    }
  });

  const items = sendsQ.data?.items ?? [];

  return (
    <section className="card mailWizardCard">
      <div className="mailWizardBody">
        <div>
          <strong>Шаблон реестра буксировок</strong>
          <div className="muted adminHint">
            Снимок плана фиксируется в РМ «Буксировки». Здесь задаётся письмо: тема и вступление. В письме таблица сгруппирована по ангарам, к письму прикладывается Excel.
            Подстановки: {"{{period}}"}, {"{{contour}}"}, {"{{rows}}"}.
          </div>
        </div>
        <label className="tgField">
          <span className="tgFieldLabel">Тема</span>
          <input className="evInput" value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <label className="tgField">
          <span className="tgFieldLabel">Вступление</span>
          <textarea className="towsMemo" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <div className="row">
          <button className="btn" type="button" disabled={saveM.isPending} onClick={() => saveM.mutate()}>
            Сохранить шаблон
          </button>
        </div>
        {saveM.isError ? <div className="error">{String((saveM.error as Error).message ?? saveM.error)}</div> : null}

        <div>
          <strong>Журнал фиксаций и отправок</strong>
          <div className="muted adminHint">Версия без письма ещё не отправлена. Повторная отправка пишет новый идентификатор письма к той же версии.</div>
        </div>
        {sendsQ.isFetching ? <div className="muted">обновление…</div> : null}
        {items.length === 0 && !sendsQ.isFetching ? <div className="muted">Зафиксированных версий пока нет</div> : null}
        <div className="towSendJournal">
          {items.map((send) => (
            <label key={send.id} className="towSendJournalItem">
              <input type="radio" name="towSend" checked={selectedId === send.id} onChange={() => setSelectedId(send.id)} />{" "}
              <b>{send.sentMsk}</b> · {send.actor} · {send.rowCount} строк · {send.messageId ? "отправлен" : "только фиксация"}
              <div className="muted">
                {send.fromMsk} – {send.toMsk}
              </div>
              {send.recipients.length ? <div className="muted">{send.recipients.join(", ")}</div> : null}
            </label>
          ))}
        </div>
        <label className="tgField">
          <span className="tgFieldLabel">Получатели</span>
          <textarea className="towsMemo" rows={2} value={recipients} placeholder="адреса через запятую или с новой строки" onChange={(event) => setRecipients(event.target.value)} />
        </label>
        <div className="row">
          <button className="btn btnPrimary" type="button" disabled={sendM.isPending || !selectedId} onClick={() => sendM.mutate()}>
            Отправить с Excel
          </button>
        </div>
        {sendM.isError ? <div className="error">{String((sendM.error as Error).message ?? sendM.error)}</div> : null}
        {message ? <div className="muted">{message}</div> : null}
      </div>
    </section>
  );
}
