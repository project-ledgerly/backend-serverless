import { IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

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
}
