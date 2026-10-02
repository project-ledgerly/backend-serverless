import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export const MAX_PLAN_OPS = 100;

export class EditPlanDto {
  // What this change is, e.g. "Set up a holiday goal". Shown in the app's activity log.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  // Applied in order, all or nothing. Each is { op: '<name>', ...fields }; see
  // plan-ops.ts for the list and the fields each one takes.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PLAN_OPS)
  @IsObject({ each: true })
  ops!: Record<string, unknown>[];
}

export class RecordIncomeDto {
  @IsUUID()
  accountId!: string;

  // Positive: how much arrived.
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  // Who paid it, e.g. "Consulting fee, Acme".
  @IsString()
  @Length(1, 120)
  source!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;
}
