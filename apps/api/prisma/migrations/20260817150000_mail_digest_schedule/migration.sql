-- AlterTable
ALTER TABLE "MailDigestSettings" ADD COLUMN "description" TEXT;
ALTER TABLE "MailDigestSettings" ADD COLUMN "periodMode" TEXT NOT NULL DEFAULT 'last7';
ALTER TABLE "MailDigestSettings" ADD COLUMN "periodCustomFrom" TEXT;
ALTER TABLE "MailDigestSettings" ADD COLUMN "periodCustomTo" TEXT;
ALTER TABLE "MailDigestSettings" ADD COLUMN "scheduleMode" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "MailDigestSettings" ADD COLUMN "scheduleTime" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "MailDigestSettings" ADD COLUMN "scheduleWeekdays" JSONB NOT NULL DEFAULT '[1,2,3,4,5]';
ALTER TABLE "MailDigestSettings" ADD COLUMN "scheduleMonthDay" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MailDigestSettings" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MailDigestSettings" ADD COLUMN "lastAutoSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MailDigestSendLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "actorEmail" TEXT,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL,
    "error" TEXT,
    "stats" JSONB,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),

    CONSTRAINT "MailDigestSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailDigestSendLog_createdAt_idx" ON "MailDigestSendLog"("createdAt");
