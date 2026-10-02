-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'import',
ADD COLUMN     "undoData" JSONB;
