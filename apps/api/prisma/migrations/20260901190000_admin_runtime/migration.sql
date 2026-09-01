-- Session invalidation + contour read-only flag.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "AppRuntimeConfig" (
    "id" TEXT NOT NULL,
    "writeBlocked" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "AppRuntimeConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppRuntimeConfig" ("id", "writeBlocked", "updatedAt")
VALUES ('default', false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
