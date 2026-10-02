import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { API_SCOPES } from '../../auth-context.js';

export class CreateTokenDto {
  // What the user calls it, e.g. "Claude on my laptop".
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(API_SCOPES, { each: true })
  scopes!: string[];

  // Leave out for every account.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  accountIds?: string[];

  // Leave out for a token that does not expire.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
