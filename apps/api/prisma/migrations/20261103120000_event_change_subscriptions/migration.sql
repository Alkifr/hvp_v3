-- CreateTable
CREATE TABLE "EventChangeSubscription" (
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventChangeSubscription_pkey" PRIMARY KEY ("userId","eventId")
);

-- CreateIndex
CREATE INDEX "EventChangeSubscription_eventId_idx" ON "EventChangeSubscription"("eventId");

-- CreateIndex
CREATE INDEX "EventChangeSubscription_userId_createdAt_idx" ON "EventChangeSubscription"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EventChangeSubscription" ADD CONSTRAINT "EventChangeSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChangeSubscription" ADD CONSTRAINT "EventChangeSubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
