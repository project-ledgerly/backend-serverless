import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const MAX_BATCH_ROWS = 200;

export class BatchRowDto {
  // Defaults to "transfer" when toAccountId is given, otherwise "transaction".
  @IsOptional()
  @IsIn(['transaction', 'transfer'])
  type?: 'transaction' | 'transfer';

  // The account the money leaves (transfer) or the one it is spent from / paid into.
  @IsUUID()
  accountId!: string;

  // Transfers only: the account the money goes to.
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  // YYYY-MM-DD or a full ISO date.
  @IsDateString()
  date!: string;

  // Transactions: signed, negative = money out (a spend), positive = money in (a refund).
  // Transfers: how much moved, positive.
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsString()
  @Length(1, 200)
  description!: string;

  // Transactions: the plan section this counts toward. Optional when listingId
  // is given, because a bill already belongs to one section.
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  // Transactions: the bill this pays.
  @IsOptional()
  @IsUUID()
  listingId?: string;

  // Transfers: the goal section this money is saved toward.
  @IsOptional()
  @IsUUID()
  goalSectionId?: string;
}

export class LogBatchDto {
  // What this batch is, e.g. "June 2026 statement". Shown in the app's activity log.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  // Check everything and report what would happen, without writing anything.
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_ROWS)
  @ValidateNested({ each: true })
  @Type(() => BatchRowDto)
  rows!: BatchRowDto[];
}
