import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { BillRecurrence } from '@prisma/client';

export class UpdateListingDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsNumberString()
  amount?: string;

  // Send null to clear the due date.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;

  @IsOptional()
  @IsEnum(BillRecurrence)
  recurrence?: BillRecurrence;

  // Send null to clear it.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  // Move the bill to another of the user's sections (for example into a Bills section).
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}
