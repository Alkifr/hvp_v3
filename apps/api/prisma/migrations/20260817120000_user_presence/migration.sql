-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserPresenceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "page" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPresenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPresenceEvent_userId_createdAt_idx" ON "UserPresenceEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserPresenceEvent_createdAt_idx" ON "UserPresenceEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "UserPresenceEvent" ADD CONSTRAINT "UserPresenceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
