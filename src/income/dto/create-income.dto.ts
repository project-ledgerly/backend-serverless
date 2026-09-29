import { IsBoolean, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

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

  // The Account this income credits — immediately if one-off, each cycle if recurring.
  @IsUUID()
  accountId!: string;
}
