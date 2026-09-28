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
}
