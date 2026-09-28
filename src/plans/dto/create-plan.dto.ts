import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreatePlanDto {
  @IsUUID()
  userId!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsString()
  status!: string;
}
