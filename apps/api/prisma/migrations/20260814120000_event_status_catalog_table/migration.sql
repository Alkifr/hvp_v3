-- Editable event status labels and Gantt stripe palette.
-- Codes stay on the EventStatus enum (planning logic).

CREATE TABLE "EventStatusCatalog" (
    "code" "EventStatus" NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "selectable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventStatusCatalog_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "EventStatusCatalog_sortOrder_idx" ON "EventStatusCatalog"("sortOrder");

INSERT INTO "EventStatusCatalog" ("code", "name", "color", "sortOrder", "selectable", "updatedAt")
VALUES
  ('PENDING_EXECUTOR_APPROVAL', 'На согласовании с исполнителем', '#FFC182', 10, true, CURRENT_TIMESTAMP),
  ('PENDING_CUSTOMER_APPROVAL', 'На согласовании с заказчиком', '#F8FA7F', 20, true, CURRENT_TIMESTAMP),
  ('APPROVED_BY_EXECUTOR', 'Согласовано с исполнителем', '#FFC1FF', 30, true, CURRENT_TIMESTAMP),
  ('APPROVED_BY_CUSTOMER', 'Согласовано с заказчиком', '#7BFA7F', 40, true, CURRENT_TIMESTAMP),
  ('IN_PROGRESS', 'В работе', NULL, 50, true, CURRENT_TIMESTAMP),
  ('DONE', 'Завершено', '#16a34a', 60, true, CURRENT_TIMESTAMP),
  ('CANCELLED', 'Отменено', NULL, 70, true, CURRENT_TIMESTAMP),
  ('DELETED', 'Удалено', NULL, 80, false, CURRENT_TIMESTAMP);
