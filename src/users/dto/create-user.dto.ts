import { IsNotEmpty, IsString } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  name!: string;

  // ISO 4217 code (USD, LKR, ...) — kept as a free string, not validated
  // against a fixed list, since the app doesn't hardcode a currency set.
  @IsNotEmpty()
  @IsString()
  currency!: string;
}
