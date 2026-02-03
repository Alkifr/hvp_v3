-- CreateEnum
CREATE TYPE "PlanningLevel" AS ENUM ('STRATEGIC', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AircraftType" (
    "id" TEXT NOT NULL,
    "icaoType" TEXT,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AircraftType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aircraft" (
    "id" TEXT NOT NULL,
    "tailNumber" TEXT NOT NULL,
    "serialNumber" TEXT,
    "operatorId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Aircraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hangar" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hangar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HangarLayout" (
    "id" TEXT NOT NULL,
    "hangarId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "widthMeters" DOUBLE PRECISION,
    "heightMeters" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HangarLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HangarStand" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "rotate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HangarStand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceEvent" (
    "id" TEXT NOT NULL,
    "level" "PlanningLevel" NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "hangarId" TEXT,
    "layoutId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandReservation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "standId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operator_code_key" ON "Operator"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AircraftType_icaoType_key" ON "AircraftType"("icaoType");

-- CreateIndex
CREATE UNIQUE INDEX "Aircraft_tailNumber_key" ON "Aircraft"("tailNumber");

-- CreateIndex
CREATE INDEX "Aircraft_operatorId_idx" ON "Aircraft"("operatorId");

-- CreateIndex
CREATE INDEX "Aircraft_typeId_idx" ON "Aircraft"("typeId");

-- CreateIndex
CREATE UNIQUE INDEX "EventType_code_key" ON "EventType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Hangar_code_key" ON "Hangar"("code");

-- CreateIndex
CREATE INDEX "HangarLayout_hangarId_idx" ON "HangarLayout"("hangarId");

-- CreateIndex
CREATE UNIQUE INDEX "HangarLayout_hangarId_code_key" ON "HangarLayout"("hangarId", "code");

-- CreateIndex
CREATE INDEX "HangarStand_layoutId_idx" ON "HangarStand"("layoutId");

-- CreateIndex
CREATE UNIQUE INDEX "HangarStand_layoutId_code_key" ON "HangarStand"("layoutId", "code");

-- CreateIndex
CREATE INDEX "MaintenanceEvent_aircraftId_idx" ON "MaintenanceEvent"("aircraftId");

-- CreateIndex
CREATE INDEX "MaintenanceEvent_eventTypeId_idx" ON "MaintenanceEvent"("eventTypeId");

-- CreateIndex
CREATE INDEX "MaintenanceEvent_startAt_endAt_idx" ON "MaintenanceEvent"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "MaintenanceEvent_hangarId_idx" ON "MaintenanceEvent"("hangarId");

-- CreateIndex
CREATE INDEX "MaintenanceEvent_layoutId_idx" ON "MaintenanceEvent"("layoutId");

-- CreateIndex
CREATE UNIQUE INDEX "StandReservation_eventId_key" ON "StandReservation"("eventId");

-- CreateIndex
CREATE INDEX "StandReservation_layoutId_idx" ON "StandReservation"("layoutId");

-- CreateIndex
CREATE INDEX "StandReservation_standId_startAt_endAt_idx" ON "StandReservation"("standId", "startAt", "endAt");

-- AddForeignKey
ALTER TABLE "Aircraft" ADD CONSTRAINT "Aircraft_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aircraft" ADD CONSTRAINT "Aircraft_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AircraftType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HangarLayout" ADD CONSTRAINT "HangarLayout_hangarId_fkey" FOREIGN KEY ("hangarId") REFERENCES "Hangar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HangarStand" ADD CONSTRAINT "HangarStand_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "HangarLayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_hangarId_fkey" FOREIGN KEY ("hangarId") REFERENCES "Hangar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "HangarLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandReservation" ADD CONSTRAINT "StandReservation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MaintenanceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandReservation" ADD CONSTRAINT "StandReservation_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "HangarLayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandReservation" ADD CONSTRAINT "StandReservation_standId_fkey" FOREIGN KEY ("standId") REFERENCES "HangarStand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
