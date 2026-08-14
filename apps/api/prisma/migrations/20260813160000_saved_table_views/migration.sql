-- CreateTable
CREATE TABLE "SavedTableView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tableKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedTableView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedTableView_userId_tableKey_name_key" ON "SavedTableView"("userId", "tableKey", "name");

-- CreateIndex
CREATE INDEX "SavedTableView_userId_tableKey_idx" ON "SavedTableView"("userId", "tableKey");

-- AddForeignKey
ALTER TABLE "SavedTableView" ADD CONSTRAINT "SavedTableView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
