import { IsBoolean, IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTransactionDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  accountId!: string;

  @IsUUID()
  sectionId!: string;

  @IsNotEmpty()
  @IsNumberString()
  amount!: string;

  @IsNotEmpty()
  @IsString()
  description!: string;

  @IsDateString()
  date!: string;

  @IsNotEmpty()
  @IsString()
  source!: string;

  // Rule 4: spending from a `protected` section needs explicit confirmation.
  // Omitted/false against a protected section is rejected with 400, not
  // silently allowed or silently blocked.
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}
