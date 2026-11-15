-- В базе время DeadLine уже записано как местное MSK. Оставляем календарную дату, время обнуляем.
UPDATE public."MaintenanceEvent"
SET "deadlineAt" = date_trunc('day', "deadlineAt")
WHERE "deadlineAt" IS NOT NULL
  AND "deadlineAt" IS DISTINCT FROM date_trunc('day', "deadlineAt");
