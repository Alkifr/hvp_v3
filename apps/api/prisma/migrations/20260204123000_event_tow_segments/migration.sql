-- CreateTable
CREATE TABLE "EventTow" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventTow_eventId_startAt_idx" ON "EventTow"("eventId", "startAt");

-- AddForeignKey
ALTER TABLE "EventTow" ADD CONSTRAINT "EventTow_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

