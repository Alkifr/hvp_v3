-- CreateEnum
CREATE TYPE "UserActivityAction" AS ENUM ('SANDBOX_CREATE', 'SANDBOX_DELETE', 'CLEANUP');

-- CreateTable
CREATE TABLE "UserActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actor" TEXT NOT NULL,
    "action" "UserActivityAction" NOT NULL,
    "reason" TEXT,
    "title" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'prod',
    "sandboxId" TEXT,
    "sandboxName" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserActivityLog_actor_createdAt_idx" ON "UserActivityLog"("actor", "createdAt");

-- CreateIndex
CREATE INDEX "UserActivityLog_userId_createdAt_idx" ON "UserActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserActivityLog_action_createdAt_idx" ON "UserActivityLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceEventAudit_actor_createdAt_idx" ON "MaintenanceEventAudit"("actor", "createdAt");

-- AddForeignKey
ALTER TABLE "UserActivityLog" ADD CONSTRAINT "UserActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
