import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IncomeService } from './income.service.js';
import { IncomeSchedulerService } from './income-scheduler.service.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { UpdateIncomeDto } from './dto/update-income.dto.js';

@ApiTags('income')
@Controller('incomes')
export class IncomeController {
  constructor(
    private readonly incomeService: IncomeService,
    private readonly incomeSchedulerService: IncomeSchedulerService,
  ) {}

  @Post()
  create(@Body() dto: CreateIncomeDto) {
    return this.incomeService.create(dto);
  }

  // Lazy catch-up: call this on app open. Applies every recurring income
  // cycle that's already due since the last time anyone asked, however long
  // that's been — no background scheduler needed.
  @Post('catch-up')
  catchUp(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.incomeSchedulerService.catchUp(userId);
  }

  @Get()
  findAllForUser(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.incomeService.findAllForUser(userId);
  }

  // Static path — must stay above :incomeId or Nest would try to match
  // "receipts" as an incomeId.
  @Get('receipts')
  findReceiptsForUser(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.incomeService.findReceiptsForUser(userId);
  }

  @Get(':incomeId')
  findOne(@Param('incomeId') incomeId: string) {
    return this.incomeService.findOne(incomeId);
  }

  @Patch(':incomeId')
  update(@Param('incomeId') incomeId: string, @Body() dto: UpdateIncomeDto) {
    return this.incomeService.update(incomeId, dto);
  }

  @Delete(':incomeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('incomeId') incomeId: string) {
    return this.incomeService.remove(incomeId);
  }
}
