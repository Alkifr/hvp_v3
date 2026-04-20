-- AlterTable: виртуальные борта при массовом планировании (aircraftId nullable, virtualAircraft JSON)
ALTER TABLE "MaintenanceEvent" ALTER COLUMN "aircraftId" DROP NOT NULL;
ALTER TABLE "MaintenanceEvent" ADD COLUMN "virtualAircraft" JSONB;
