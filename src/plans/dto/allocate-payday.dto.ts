import { IsNotEmpty, IsNumberString, IsUUID } from 'class-validator';

export class AllocatePaydayDto {
  @IsUUID()
  incomeId!: string;

  @IsNotEmpty()
  @IsNumberString()
  incomeAmount!: string;
}
