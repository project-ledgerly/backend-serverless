-- AlterEnum
ALTER TYPE "GoalMode" ADD VALUE 'RESERVE';

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "goalSectionId" TEXT;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_goalSectionId_fkey" FOREIGN KEY ("goalSectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
