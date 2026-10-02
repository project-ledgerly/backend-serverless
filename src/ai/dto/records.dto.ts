import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const MAX_IDS = 200;
export const MAX_UPDATES = 100;

export class ListTransactionsQuery {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Matches the description, merchant or original statement line.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListTransfersQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class DeleteRecordsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('all', { each: true })
  ids!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class TransactionChangeDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  // null clears the bill link.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  listingId?: string | null;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  merchant?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;
}

export class UpdateTransactionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_UPDATES)
  @ValidateNested({ each: true })
  @Type(() => TransactionChangeDto)
  changes!: TransactionChangeDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class ReconcileDto {
  // What the bank says the balance is.
  @IsNumber({ maxDecimalPlaces: 2 })
  balance!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
