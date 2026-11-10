-- Справочник причин изменения. Начальный список собран по комментариям рабочего контура.

CREATE TABLE "ChangeReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeReason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChangeReason_code_key" ON "ChangeReason"("code");
CREATE INDEX "ChangeReason_sortOrder_idx" ON "ChangeReason"("sortOrder");

ALTER TABLE "MaintenanceEventAudit" ADD COLUMN "changeReasonIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MaintenanceEventAudit" ADD COLUMN "changeReasonNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MaintenanceEventAudit" ADD COLUMN "changeReasonComment" TEXT;

INSERT INTO "ChangeReason" ("id", "code", "name", "sortOrder", "isActive", "updatedAt")
VALUES
    ('c0ffee00-0000-4000-8000-000000000001', 'OPERATOR_REQUEST', 'Запрос оператора', 10, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000002', 'NEW_REQUEST', 'Новый запрос', 20, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000003', 'FITS_OPERATOR_SLOT', 'Укладываемся в слот оператора', 30, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000004', 'AGREED', 'Согласовано', 40, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000005', 'NOT_AGREED', 'Не согласовано', 50, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000006', 'NO_SLOT', 'Нет слота', 60, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000007', 'NO_HANGAR_FIT', 'Не помещается в ангар', 70, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000008', 'SLOT_CANCELLED', 'Отмена слота', 80, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000009', 'OPERATOR_CANCELLED', 'Отменено оператором', 90, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000010', 'TENDER_LOST', 'Тендер проигран', 100, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000011', 'EVENT_REPLACED', 'Замена события', 110, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000012', 'NEEDS_ESTIMATE', 'Требуется оценка', 120, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000013', 'NO_RESOURCES', 'Нет ресурсов', 130, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000014', 'HIGH_WORKSHOP_LOAD', 'Высокая загрузка цеха', 140, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000015', 'ENGINE_PLAN', 'План по двигателям', 150, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000016', 'NO_ENGINE_RATING', 'Нет рейтинга двигателя', 160, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000017', 'RESOURCE_OR_SB', 'Продление ресурса или директива', 170, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000018', 'AOG', 'AOG', 180, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000019', 'WAITING_PARTS', 'Ожидание оборудования', 190, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000020', 'SLOT_EXTENSION', 'Увеличение слота из-за объёма работ', 200, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000021', 'SLOT_OVERLAP', 'Пересечение с другим слотом', 210, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000022', 'FLIGHT_SCHEDULE', 'Обеспечение расписания полётов', 220, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000023', 'DONOR_AIRCRAFT', 'Донорство ВС', 230, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000024', 'NOT_RU_REGISTER', 'ВС не в российском регистре', 240, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000025', 'FINANCE_REJECTED', 'Не согласовано финансово', 250, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000026', 'TENT_PLACEMENT', 'Размещение в палатке', 260, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000027', 'NO_CHANGE', 'Без изменений', 270, true, CURRENT_TIMESTAMP),
    ('c0ffee00-0000-4000-8000-000000000028', 'NO_OPERATOR_REPLY', 'Без ответа оператора', 280, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
