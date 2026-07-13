-- CreateEnum
CREATE TYPE "SandboxStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Sandbox" ADD COLUMN "status" "SandboxStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Sandbox_status_idx" ON "Sandbox"("status");
