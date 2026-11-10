-- Десять причин изменения. Близкие формулировки собраны в одну.

DELETE FROM "ChangeReason";

INSERT INTO "ChangeReason" ("id", "code", "name", "sortOrder", "isActive", "updatedAt")
VALUES
    ('c0ffee00-0000-4000-8000-000000000201', 'OPERATOR_SLOT', 'Оператор попросил перенести слот', 10, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000202', 'OPERATOR_NO_SLOT', 'Оператор отменил слот или свободного слота нет', 20, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000203', 'OTHER_AIRCRAFT', 'Слот сдвинут из-за другого воздушного судна', 30, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000204', 'NO_HANGAR_FIT', 'ВС не помещается в ангар', 40, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000205', 'SCOPE_MISMATCH', 'Объём работ не совпал с длиной слота', 50, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000206', 'NO_CAPACITY', 'Цех перегружен или не хватает персонала', 60, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000207', 'DEFECT_OR_PARTS', 'Дефект, AOG или ожидание запчастей и схемы ремонта', 70, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000208', 'ENGINE_OR_DIRECTIVE', 'Изменился план по двигателям, ресурсу или директиве', 80, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000209', 'AIRCRAFT_REJECTED', 'ВС нельзя принять: регистр, тендер или финансы', 90, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000210', 'EVENT_REPLACED', 'Событие заменено другим', 100, true, CURRENT_TIMESTAMP);
