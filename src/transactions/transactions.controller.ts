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
  ) {
    if (accountId) return this.transactionsService.findAllForAccount(accountId);
    if (sectionId) return this.transactionsService.findAllForSection(sectionId);
    if (userId) return this.transactionsService.findAllForUser(userId);
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
