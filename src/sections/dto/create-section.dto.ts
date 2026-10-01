import { SectionType, AllocationMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSectionDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsEnum(SectionType)
  type!: SectionType;

  @IsEnum(AllocationMode)
  allocationMode!: AllocationMode;

  @IsNumberString()
  percentage!: string;

  @IsInt()
  priorityOrder!: number;

  @IsOptional()
  @IsBoolean()
  protected?: boolean;

  // Where this Section's money sits. Optional — type-matched against the
  // Section's own type in SectionsService (SAVINGS Section -> SAVINGS
  // Account only, Essential/Flexible -> SPENDING Account only, GOAL -> either).
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
