import assert from "node:assert/strict";
import test from "node:test";

import { formatEventTooltip, type EventTooltipModel } from "./eventTooltip.ts";

function model(patch: Partial<EventTooltipModel> = {}): EventTooltipModel {
  return {
    tat: "2дн",
    tailNumber: "RA-73001",
    title: "C-Check",
    stage: "Ангар 1 / A-1",
    operationalPeriod: "01.10.2026 08:00 – 03.10.2026 18:00",
    workshop: "Цех ТО",
    maintenanceType: "C-Check",
    deadlineFilled: true,
    hasTows: true,
    status: "IN_PROGRESS",
    actualPeriodFilled: false,
    labor: { budget: true, mps: true, actual: false },
    ...patch
  };
}

test("filled event shows the main block only", () => {
  const text = formatEventTooltip(model());
  assert.equal(
    text,
    [
      "TAT: 2дн",
      "Бортовой номер: RA-73001",
      "Наименование события: C-Check",
      "Этап: Ангар 1 / A-1",
      "Оперативный период: 01.10.2026 08:00 – 03.10.2026 18:00",
      "Цех: Цех ТО"
    ].join("\n")
  );
});

test("empty workshop, maintenance type, deadline and tows go under the line", () => {
  const text = formatEventTooltip(
    model({
      workshop: "  ",
      maintenanceType: "",
      deadlineFilled: false,
      hasTows: false,
      labor: { budget: true, mps: true, actual: false }
    })
  );
  assert.match(text, /────────\n- Цех: Отсутствует\n- Вид ТО: Отсутствует\n- Дедлайн: Отсутствует\n- Буксировки: Отсутствует$/);
  assert.equal(text.includes("Цех: Цех"), false);
});

test("unknown tows and labor are not reported as missing", () => {
  const text = formatEventTooltip(model({ hasTows: null, labor: null, workshop: null, deadlineFilled: false }));
  assert.match(text, /- Цех: Отсутствует\n- Дедлайн: Отсутствует$/);
  assert.equal(text.includes("Буксировки"), false);
  assert.equal(text.includes("Трудоемкость"), false);
});

test("in progress flags empty MPS and budget labor, not fact", () => {
  const text = formatEventTooltip(
    model({
      status: "APPROVED_BY_CUSTOMER",
      labor: { budget: false, mps: false, actual: false },
      actualPeriodFilled: false
    })
  );
  assert.match(text, /- Трудоемкость MPS: Отсутствует\n- Трудоемкость Бюджет: Отсутствует$/);
  assert.equal(text.includes("Фактическое время"), false);
  assert.equal(text.includes("- Трудоемкость: Отсутствует"), false);
});

test("done event flags missing fact time and fact labor", () => {
  const text = formatEventTooltip(
    model({
      status: "DONE",
      actualPeriodFilled: false,
      labor: { budget: false, mps: false, actual: false }
    })
  );
  assert.match(text, /- Фактическое время: Отсутствует\n- Трудоемкость: Отсутствует$/);
  assert.equal(text.includes("Трудоемкость MPS"), false);
  assert.equal(text.includes("Трудоемкость Бюджет"), false);
});

test("done event with fact filled stays quiet about labor that is locked", () => {
  const text = formatEventTooltip(
    model({
      status: "DONE",
      actualPeriodFilled: true,
      labor: { budget: true, mps: true, actual: true }
    })
  );
  assert.equal(text.includes("────────"), false);
});

test("cancelled event does not ask for labor", () => {
  const text = formatEventTooltip(
    model({
      status: "CANCELLED",
      labor: { budget: false, mps: false, actual: false },
      actualPeriodFilled: false,
      deadlineFilled: false
    })
  );
  assert.match(text, /- Дедлайн: Отсутствует$/);
  assert.equal(text.includes("Трудоемкость"), false);
  assert.equal(text.includes("Фактическое время"), false);
});

test("custom status before in progress uses the same MPS and budget rule", () => {
  const text = formatEventTooltip(
    model({
      status: "HOLD",
      statusSortOrder: 45,
      inProgressSortOrder: 50,
      labor: { budget: true, mps: false, actual: false }
    })
  );
  assert.match(text, /- Трудоемкость MPS: Отсутствует$/);
  assert.equal(text.includes("Трудоемкость Бюджет"), false);
});
