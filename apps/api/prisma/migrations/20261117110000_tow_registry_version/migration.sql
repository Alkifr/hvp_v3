-- CreateTable
CREATE TABLE "EventTowWaiver" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sandboxId" TEXT,
    "role" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTowWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TowRegistrySend" (
    "id" TEXT NOT NULL,
    "sandboxId" TEXT,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "note" TEXT,
    "subject" TEXT NOT NULL,
    "messageId" TEXT,
    "rows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TowRegistrySend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TowFieldChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "towId" TEXT,
    "sandboxId" TEXT,
    "actor" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT NOT NULL DEFAULT '',
    "after" TEXT NOT NULL DEFAULT '',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TowFieldChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventTowWaiver_eventId_role_key" ON "EventTowWaiver"("eventId", "role");

-- CreateIndex
CREATE INDEX "EventTowWaiver_sandboxId_idx" ON "EventTowWaiver"("sandboxId");

-- CreateIndex
CREATE INDEX "TowRegistrySend_sandboxId_createdAt_idx" ON "TowRegistrySend"("sandboxId", "createdAt");

-- CreateIndex
CREATE INDEX "TowRegistrySend_fromAt_toAt_idx" ON "TowRegistrySend"("fromAt", "toAt");

-- CreateIndex
CREATE INDEX "TowFieldChange_eventId_createdAt_idx" ON "TowFieldChange"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "TowFieldChange_sandboxId_createdAt_idx" ON "TowFieldChange"("sandboxId", "createdAt");

-- AddForeignKey
ALTER TABLE "EventTowWaiver" ADD CONSTRAINT "EventTowWaiver_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TowFieldChange" ADD CONSTRAINT "TowFieldChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
