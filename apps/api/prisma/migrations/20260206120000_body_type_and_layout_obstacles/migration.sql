-- CreateEnum
CREATE TYPE "BodyType" AS ENUM ('NARROW_BODY', 'WIDE_BODY');

-- AlterTable
ALTER TABLE "AircraftType" ADD COLUMN IF NOT EXISTS "bodyType" "BodyType";

-- AlterTable
ALTER TABLE "HangarLayout" ADD COLUMN IF NOT EXISTS "obstacles" JSONB;

-- AlterTable
ALTER TABLE "HangarStand" ADD COLUMN IF NOT EXISTS "bodyType" "BodyType";
