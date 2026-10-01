import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // ISO 4217 code, free string like CreateUserDto.currency.
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  currency?: string;
}
