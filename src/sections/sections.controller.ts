import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SectionsService } from './sections.service.js';
import { CreateSectionDto } from './dto/create-section.dto.js';
import { UpdateSectionDto } from './dto/update-section.dto.js';
import { ReorderSectionsDto } from './dto/reorder-sections.dto.js';

@ApiTags('sections')
@Controller()
export class SectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Post('plans/:planId/sections')
  create(@Param('planId') planId: string, @Body() dto: CreateSectionDto) {
    return this.sectionsService.create(planId, dto);
  }

  @Get('plans/:planId/sections')
  findAllForPlan(@Param('planId') planId: string) {
    return this.sectionsService.findAllForPlan(planId);
  }

  @Post('plans/:planId/sections/reorder')
  reorder(@Param('planId') planId: string, @Body() dto: ReorderSectionsDto) {
    return this.sectionsService.reorder(planId, dto);
  }

  @Get('sections/:sectionId')
  findOne(@Param('sectionId') sectionId: string) {
    return this.sectionsService.findOne(sectionId);
  }

  @Patch('sections/:sectionId')
  update(@Param('sectionId') sectionId: string, @Body() dto: UpdateSectionDto) {
    return this.sectionsService.update(sectionId, dto);
  }

  @Delete('sections/:sectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('sectionId') sectionId: string) {
    return this.sectionsService.remove(sectionId);
  }
}
