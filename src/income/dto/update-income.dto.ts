import { IncomeFrequency } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

// What can change depends on the kind of income (see IncomeService.update):
// a recurring income is a template, so all of these are fine and only affect
// cycles that haven't been credited yet; a one-off income has already moved
// money into an account, so only its `source` label can be edited.
export class UpdateIncomeDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  source?: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsEnum(IncomeFrequency)
  frequency?: IncomeFrequency;

  // The next payday (recurring only). Moves the schedule: the next cycle is
  // credited on this date and later ones follow `frequency` from it.
  @IsOptional()
  @IsDateString()
  nextRunDate?: string;

  // The account future cycles are credited to (recurring only).
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
