import { IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

export class UpdateListingDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsNumberString()
  amount?: string;
}
