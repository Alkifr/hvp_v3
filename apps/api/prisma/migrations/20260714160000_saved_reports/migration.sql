-- CreateEnum
CREATE TYPE "ReportShareRole" AS ENUM ('VIEWER', 'EDITOR');

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReportShare" (
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ReportShareRole" NOT NULL DEFAULT 'VIEWER',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedReportShare_pkey" PRIMARY KEY ("reportId","userId")
);

-- CreateIndex
CREATE INDEX "SavedReport_ownerId_idx" ON "SavedReport"("ownerId");

-- CreateIndex
CREATE INDEX "SavedReport_updatedAt_idx" ON "SavedReport"("updatedAt");

-- CreateIndex
CREATE INDEX "SavedReportShare_userId_idx" ON "SavedReportShare"("userId");

-- AddForeignKey
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReportShare" ADD CONSTRAINT "SavedReportShare_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SavedReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReportShare" ADD CONSTRAINT "SavedReportShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
