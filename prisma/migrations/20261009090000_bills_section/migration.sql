-- A section type for bills, and bills that can recur on other schedules or be one-off.
-- Additive: existing sections and bills are untouched (every existing bill is MONTHLY).
ALTER TYPE "SectionType" ADD VALUE 'BILLS';

CREATE TYPE "BillRecurrence" AS ENUM ('MONTHLY', 'WEEKLY', 'YEARLY', 'ONCE');

ALTER TABLE "Listing" ADD COLUMN "recurrence" "BillRecurrence" NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "Listing" ADD COLUMN "dueDate" TIMESTAMP(3);
