-- CreateTable
CREATE TABLE "AppAnnouncement" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppAnnouncementDismissal" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppAnnouncementDismissal_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateIndex
CREATE INDEX "AppAnnouncement_isActive_createdAt_idx" ON "AppAnnouncement"("isActive", "createdAt");

-- CreateIndex
CREATE INDEX "AppAnnouncement_endsAt_idx" ON "AppAnnouncement"("endsAt");

-- CreateIndex
CREATE INDEX "AppAnnouncementDismissal_userId_idx" ON "AppAnnouncementDismissal"("userId");

-- AddForeignKey
ALTER TABLE "AppAnnouncement" ADD CONSTRAINT "AppAnnouncement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppAnnouncementDismissal" ADD CONSTRAINT "AppAnnouncementDismissal_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "AppAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppAnnouncementDismissal" ADD CONSTRAINT "AppAnnouncementDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
