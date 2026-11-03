-- PostgreSQL requires a newly added enum value to be committed before another
-- migration can use it in table definitions or data.
ALTER TYPE "PrimaryMetricDepartment" ADD VALUE IF NOT EXISTS 'PAINT';
