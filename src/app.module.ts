import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PlansModule } from './plans/plans.module.js';
import { SectionsModule } from './sections/sections.module.js';
import { IncomeModule } from './income/income.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';

@Module({
  imports: [PrismaModule, PlansModule, SectionsModule, IncomeModule, TransactionsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
