-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "identifiers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "merchant" TEXT,
ADD COLUMN     "raw" TEXT;
