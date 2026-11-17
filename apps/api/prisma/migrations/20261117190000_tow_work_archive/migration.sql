CREATE TABLE "TowWorkArchive" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "planCount" INTEGER NOT NULL,
    "reportCount" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TowWorkArchive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TowWorkArchive_createdAt_idx" ON "TowWorkArchive"("createdAt");

ALTER TABLE "TowWorkArchive" ADD CONSTRAINT "TowWorkArchive_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
