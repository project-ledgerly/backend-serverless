import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IncomeService } from './income.service.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';

@ApiTags('income')
@Controller('incomes')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}

  @Post()
  create(@Body() dto: CreateIncomeDto) {
    return this.incomeService.create(dto);
  }

  @Get()
  findAllForUser(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.incomeService.findAllForUser(userId);
  }

  @Get(':incomeId')
  findOne(@Param('incomeId') incomeId: string) {
    return this.incomeService.findOne(incomeId);
  }
}
