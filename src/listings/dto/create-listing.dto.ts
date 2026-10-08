import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { BillRecurrence } from '@prisma/client';

export class CreateListingDto {
  // Whose listing this is — checked against the Section's own Plan owner in
  // ListingsService, so one user can never attach a listing to another
  // user's section even if they guess its id.
  @IsUUID()
  userId!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsNumberString()
  amount!: string;

  // Day of the month the bill is due (1-31).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;

  // How often it comes due (default MONTHLY).
  @IsOptional()
  @IsEnum(BillRecurrence)
  recurrence?: BillRecurrence;

  // ONCE: the due date. YEARLY: its month and day. WEEKLY: its weekday.
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
