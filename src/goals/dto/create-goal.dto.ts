import { GoalMode } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class CreateGoalDto {
  @IsOptional()
  @IsEnum(GoalMode)
  mode?: GoalMode;

  @IsNotEmpty()
  @IsNumberString()
  targetAmount!: string;

  // Required for TARGET mode (drives the monthly-contribution calculation).
  // Ignored for MONTHLY_RECURRING, which has no end date.
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @IsOptional()
  @IsBoolean()
  autoCalculated?: boolean;

  // Already set aside when the goal is created (what its account holds).
  @IsOptional()
  @IsNumberString()
  startingAmount?: string;
}
