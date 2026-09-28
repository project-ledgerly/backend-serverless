import { AccountType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAccountDto {
  @IsUUID()
  userId!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsEnum(AccountType)
  type!: AccountType;

  // Starting balance. Defaults to 0 — from here on, balance is derived from
  // Transaction amounts, not set directly (see TransactionsService).
  @IsOptional()
  @IsNumberString()
  balance?: string;
}
