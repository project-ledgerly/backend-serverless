import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PlansModule } from './plans/plans.module.js';
import { SectionsModule } from './sections/sections.module.js';
import { ListingsModule } from './listings/listings.module.js';
import { IncomeModule } from './income/income.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { GoalsModule } from './goals/goals.module.js';
import { UsersModule } from './users/users.module.js';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [
    PrismaModule,
    PlansModule,
    SectionsModule,
    ListingsModule,
    IncomeModule,
    TransactionsModule,
    AccountsModule,
    GoalsModule,
    UsersModule,
    AuthModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
