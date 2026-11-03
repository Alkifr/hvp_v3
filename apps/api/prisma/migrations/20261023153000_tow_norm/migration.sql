CREATE TABLE "TowNorm" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TowNorm_pkey" PRIMARY KEY ("code")
);

INSERT INTO "TowNorm" ("code", "name", "minutes", "isActive", "createdAt", "updatedAt")
VALUES (
    'EDGE_TOW_MINUTES',
    'Буксировка в начале и в конце события',
    30,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
