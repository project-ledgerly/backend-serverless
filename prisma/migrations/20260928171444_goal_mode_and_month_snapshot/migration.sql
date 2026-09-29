-- CreateEnum
CREATE TYPE "GoalMode" AS ENUM ('TARGET', 'MONTHLY_RECURRING');

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN     "mode" "GoalMode" NOT NULL DEFAULT 'TARGET',
ALTER COLUMN "targetDate" DROP NOT NULL,
ALTER COLUMN "monthlyContribution" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GoalMonthSnapshot" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "targetAmount" DECIMAL(65,30) NOT NULL,
    "actualAmount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalMonthSnapshot_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GoalMonthSnapshot" ADD CONSTRAINT "GoalMonthSnapshot_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
