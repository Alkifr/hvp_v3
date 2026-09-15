ALTER TABLE "Permission" ADD COLUMN "appLabel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Permission" ADD COLUMN "model" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Permission" ADD COLUMN "action" TEXT NOT NULL DEFAULT '';

CREATE INDEX "Permission_appLabel_model_idx" ON "Permission"("appLabel", "model");
