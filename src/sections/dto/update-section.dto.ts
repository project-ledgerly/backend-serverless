import { SectionType, AllocationMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateSectionDto {
  // Null clears the parent (moves the section to top level); undefined leaves it unchanged.
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(SectionType)
  type?: SectionType;

  @IsOptional()
  @IsEnum(AllocationMode)
  allocationMode?: AllocationMode;

  @IsOptional()
  @IsNumberString()
  percentage?: string;

  @IsOptional()
  @IsInt()
  priorityOrder?: number;

  @IsOptional()
  @IsBoolean()
  protected?: boolean;
}
