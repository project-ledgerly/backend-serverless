-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "nextRunDate" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
