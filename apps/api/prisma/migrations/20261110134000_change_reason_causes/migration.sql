-- Причины изменения: почему сдвинули даты, борт, срок, ангар или отменили событие.
-- Исходы вроде «согласовано» и «укладываемся» причиной не являются.

DELETE FROM "ChangeReason";

INSERT INTO "ChangeReason" ("id", "code", "name", "sortOrder", "isActive", "updatedAt")
VALUES
    ('c0ffee00-0000-4000-8000-000000000101', 'OPERATOR_ASKED_MOVE', 'Оператор попросил перенести слот', 10, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000102', 'OPERATOR_ASKED_NEW', 'Оператор попросил поставить событие в план', 20, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000103', 'OPERATOR_CANCELLED_SLOT', 'Оператор отменил слот', 30, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000104', 'NO_OPERATOR_SLOT', 'У оператора нет свободного слота', 40, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000105', 'NO_OPERATOR_REPLY', 'Оператор не ответил на запрос слота', 50, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000106', 'OPERATOR_REFUSED_CANCEL', 'Оператор не разрешил отменить слот, его пришлось продлить', 60, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000107', 'FLIGHT_SCHEDULE', 'Слот сдвинут, чтобы сохранить расписание полётов', 70, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000108', 'DISPLACED_BY_OTHER', 'Слот сдвинут из-за другого воздушного судна', 80, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000109', 'SCOPE_BIGGER', 'Объём работ больше плана, слот пришлось увеличить', 90, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000110', 'SCOPE_REDUCED', 'Часть работ снята, слот сократился', 100, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000111', 'SLOT_OVERLAP', 'Слот пересекается с другим слотом', 110, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000112', 'NO_HANGAR_FIT', 'ВС не помещается в ангар', 120, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000113', 'HANGAR_TAKEN', 'Ангар занят другим событием', 130, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000114', 'MOVED_TO_TENT', 'В ангаре нет места, работы перенесены в палатку', 140, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000115', 'WORKSHOP_OVERLOAD', 'Цех перегружен на эти даты', 150, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000116', 'NO_STAFF', 'Не хватает персонала', 160, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000117', 'WAITING_PARTS', 'Нет запчастей или оборудования', 170, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000118', 'DEFECTS_FOUND', 'На ВС найдены дефекты, ремонт дольше плана', 180, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000119', 'NO_REPAIR_SCHEME', 'Нет схемы или рекомендаций по ремонту', 190, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000120', 'AOG', 'AOG не даёт выпустить ВС в срок', 200, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000121', 'ENGINE_PLAN', 'Пересмотрен план по двигателям', 210, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000122', 'NO_ENGINE_RATING', 'Нет рейтинга на двигатель, работы выполнить нельзя', 220, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000123', 'RESOURCE_OR_SB', 'Продлён ресурс или вышла директива, плановые работы отменены', 230, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000124', 'DONOR_AIRCRAFT', 'ВС удерживается как донор для другого борта', 240, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000125', 'NOT_RU_REGISTER', 'ВС не переведено в российский регистр', 250, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000126', 'TENDER_LOST', 'Тендер проигран, работы не состоятся', 260, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000127', 'EVENT_REPLACED', 'Событие заменено другим', 270, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000128', 'NEEDS_ESTIMATE', 'Объём работ не оценён, срок подтвердить нельзя', 280, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000129', 'FINANCE_REJECTED', 'Финансы не согласовали работы', 290, true, CURRENT_TIMESTAMP);
