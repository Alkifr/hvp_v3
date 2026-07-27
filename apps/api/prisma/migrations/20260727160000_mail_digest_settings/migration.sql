-- CreateTable
CREATE TABLE "MailDigestSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "smtpHost" TEXT,
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "mailFrom" TEXT,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "subjectTemplate" TEXT NOT NULL DEFAULT 'Изменения плана ТО',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailDigestSettings_pkey" PRIMARY KEY ("id")
);
