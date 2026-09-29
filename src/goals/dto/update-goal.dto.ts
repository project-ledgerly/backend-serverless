import { IsBoolean, IsDateString, IsNotEmpty, IsNumberString, IsOptional } from 'class-validator';

export class UpdateGoalDto {
  @IsOptional()
  @IsNotEmpty()
  @IsNumberString()
  targetAmount?: string;

  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @IsOptional()
  @IsBoolean()
  autoCalculated?: boolean;
}
