-- AlterTable
ALTER TABLE "MailDigestSettings" ADD COLUMN "columns" JSONB NOT NULL DEFAULT '["kind","aircraftType","aircraft","title","detail","previous"]';
