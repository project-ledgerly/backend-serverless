import { IncomeFrequency } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateIncomeDto {
  @IsUUID()
  userId!: string;

  @IsNotEmpty()
  @IsNumberString()
  amount!: string;

  @IsNotEmpty()
  @IsString()
  source!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsBoolean()
  recurring?: boolean;

  // Required when recurring is true — how often it repeats. Ignored for
  // one-off income.
  @IsOptional()
  @IsEnum(IncomeFrequency)
  frequency?: IncomeFrequency;

  // The Account this income credits — immediately if one-off, each cycle if recurring.
  @IsUUID()
  accountId!: string;
}
