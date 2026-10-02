import { IsDateString, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTransferDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  fromAccountId!: string;

  @IsUUID()
  toAccountId!: string;

  // Positive; the direction comes from from/to.
  @IsNotEmpty()
  @IsNumberString()
  amount!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  note?: string;

  // The goal section this money is for; counts toward that goal's progress.
  @IsOptional()
  @IsUUID()
  goalSectionId?: string;
}
