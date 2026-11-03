function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML письма из правленного текста: переносы строк сохраняются. */
export function plainLetterHtml(text: string): string {
  const body = text.trim();
  if (!body) return "";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;white-space:pre-wrap;color:#0f172a">${escapeHtml(body)}</div>`;
}

export function prependLetterNote(note: string, text: string): string {
  const n = note.trim();
  const body = text.trim();
  if (!n) return body;
  if (!body) return n;
  return `${n}\n\n${body}`;
}

export function prependLetterNoteHtml(note: string, html: string): string {
  const n = note.trim();
  if (!n) return html;
  const head = plainLetterHtml(n);
  const rest = html.trim();
  if (!rest) return head;
  return `${head}<div style="height:12px"></div>${rest}`;
}

export type OutgoingLetter = {
  /** true — отправлять переданный текст, не подменяя его автосборкой */
  explicit: boolean;
  text?: string;
  html?: string;
};

/** Что уйдёт получателю: комментарий, правка текста или исходная таблица. */
export function composeOutgoingLetter(input: {
  note: string;
  draftText: string;
  generatedText: string;
  generatedHtml: string;
  textDirty: boolean;
}): OutgoingLetter {
  const note = input.note.trim();
  const hasGenerated = Boolean(input.generatedText.trim() || input.generatedHtml.trim());
  if (!hasGenerated && !note) return { explicit: false };
  if (!hasGenerated) {
    return { explicit: true, text: note, html: plainLetterHtml(note) };
  }
  if (input.textDirty) {
    const text = prependLetterNote(note, input.draftText);
    return { explicit: true, text, html: plainLetterHtml(text) };
  }
  return {
    explicit: true,
    text: prependLetterNote(note, input.generatedText),
    html: prependLetterNoteHtml(note, input.generatedHtml)
  };
}
