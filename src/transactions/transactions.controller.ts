import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { UpdateTransactionDto } from './dto/update-transaction.dto.js';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(dto);
  }

  @Get()
  findAll(
    @Query('accountId') accountId?: string,
    @Query('sectionId') sectionId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('limit') limit?: string,
  ) {
    if (accountId) return this.transactionsService.findAllForAccount(accountId);
    if (sectionId) return this.transactionsService.findAllForSection(sectionId);
    if (userId) {
      const fromDate = from ? new Date(from) : undefined;
      if (fromDate && Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException('from must be a valid ISO date');
      }
      const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
      if (limit && (parsedLimit === undefined || Number.isNaN(parsedLimit))) {
        throw new BadRequestException('limit must be an integer');
      }
      return this.transactionsService.findAllForUser(userId, { from: fromDate, limit: parsedLimit });
    }
    throw new BadRequestException('accountId, sectionId, or userId query param is required');
  }

  @Get(':transactionId')
  findOne(@Param('transactionId') transactionId: string) {
    return this.transactionsService.findOne(transactionId);
  }

  @Patch(':transactionId')
  update(@Param('transactionId') transactionId: string, @Body() dto: UpdateTransactionDto) {
    return this.transactionsService.update(transactionId, dto);
  }

  @Delete(':transactionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('transactionId') transactionId: string) {
    return this.transactionsService.remove(transactionId);
  }
}
