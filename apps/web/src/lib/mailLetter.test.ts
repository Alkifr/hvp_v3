import assert from "node:assert/strict";
import test from "node:test";

import { composeOutgoingLetter, plainLetterHtml, prependLetterNote } from "./mailLetter.ts";

test("prependLetterNote ставит комментарий перед текстом", () => {
  assert.equal(prependLetterNote("  Добрый день  ", "таблица"), "Добрый день\n\nтаблица");
  assert.equal(prependLetterNote("", "таблица"), "таблица");
  assert.equal(prependLetterNote("только комментарий", "  "), "только комментарий");
});

test("plainLetterHtml экранирует разметку и пустой текст не шлёт", () => {
  assert.equal(plainLetterHtml("  "), "");
  assert.match(plainLetterHtml("a < b"), /a &lt; b/);
  assert.match(plainLetterHtml("a\nb"), /white-space:pre-wrap/);
});

test("без предпросмотра и комментария сервер собирает письмо сам", () => {
  const letter = composeOutgoingLetter({
    note: "",
    draftText: "",
    generatedText: "",
    generatedHtml: "",
    textDirty: false
  });
  assert.equal(letter.explicit, false);
});

test("правка текста заменяет таблицу, комментарий остаётся сверху", () => {
  const letter = composeOutgoingLetter({
    note: "Смотрите перенос",
    draftText: "только текст",
    generatedText: "авто",
    generatedHtml: "<table></table>",
    textDirty: true
  });
  assert.equal(letter.explicit, true);
  assert.equal(letter.text, "Смотрите перенос\n\nтолько текст");
  assert.match(letter.html ?? "", /Смотрите перенос/);
  assert.doesNotMatch(letter.html ?? "", /<table>/);
});

test("без правки текста таблица сохраняется, комментарий добавляется", () => {
  const letter = composeOutgoingLetter({
    note: "Коллеги,",
    draftText: "авто",
    generatedText: "авто",
    generatedHtml: "<table></table>",
    textDirty: false
  });
  assert.match(letter.html ?? "", /Коллеги,/);
  assert.match(letter.html ?? "", /<table>/);
  assert.match(letter.text ?? "", /^Коллеги,\n\nавто$/);
});
