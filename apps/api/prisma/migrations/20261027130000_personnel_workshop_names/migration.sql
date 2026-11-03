-- Recognize compound workshop names such as «ЦПТО» when assigning default categories.
INSERT INTO "PersonnelWorkshopCategory" ("workshopId", "categoryCode", "department", "createdAt", "updatedAt")
SELECT w."id", c."code", c."department", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workshop" w
JOIN "PersonnelCategory" c ON (
  ((UPPER(w."code") LIKE '%PTO%' OR UPPER(w."code") LIKE '%ПТО%' OR UPPER(w."name") LIKE '%PTO%' OR UPPER(w."name") LIKE '%ПТО%')
    AND c."code" IN ('B1', 'LBMM', 'B2', 'LBMA', 'AM', 'SM')) OR
  ((UPPER(w."code") LIKE '%SDRK%' OR UPPER(w."code") LIKE '%СДРК%' OR UPPER(w."name") LIKE '%SDRK%' OR UPPER(w."name") LIKE '%СДРК%')
    AND c."code" IN ('NDT', 'SHOP')) OR
  ((UPPER(w."code") LIKE '%SOIO%' OR UPPER(w."code") LIKE '%СОИО%' OR UPPER(w."name") LIKE '%SOIO%' OR UPPER(w."name") LIKE '%СОИО%')
    AND c."code" = 'INT') OR
  ((UPPER(w."code") LIKE '%CRIO%' OR UPPER(w."code") LIKE '%ЦРИО%' OR UPPER(w."name") LIKE '%CRIO%' OR UPPER(w."name") LIKE '%ЦРИО%')
    AND c."code" = 'CAB_REP') OR
  ((UPPER(w."code") LIKE '%LKP%' OR UPPER(w."code") LIKE '%ЛКП%' OR UPPER(w."name") LIKE '%LKP%' OR UPPER(w."name") LIKE '%ЛКП%')
    AND c."code" = 'PAINT')
)
ON CONFLICT ("workshopId", "categoryCode") DO NOTHING;
