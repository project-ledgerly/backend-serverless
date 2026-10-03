import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AccountsService } from './accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { SetBalanceDto } from './dto/set-balance.dto.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.accountsService.create(dto);
  }

  @Get()
  findAllForUser(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.accountsService.findAllForUser(userId);
  }

  // Declared before ':accountId' so 'transfers' isn't read as an id.
  @Post('transfers')
  transfer(@Body() dto: CreateTransferDto) {
    return this.accountsService.transfer(dto);
  }

  @Get('transfers')
  findTransfers(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.accountsService.findTransfers(userId);
  }

  @Delete('transfers/:transferId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTransfer(@Param('transferId') transferId: string) {
    return this.accountsService.removeTransfer(transferId);
  }

  @Post(':accountId/reset')
  reset(@Param('accountId') accountId: string) {
    return this.accountsService.reset(accountId);
  }

  // "This is what the account holds today": sets the balance and the day it is true for.
  @Post(':accountId/balance')
  @HttpCode(HttpStatus.OK)
  setBalance(@Param('accountId') accountId: string, @Body() dto: SetBalanceDto) {
    return this.accountsService.setBalance(accountId, dto);
  }

  @Get(':accountId')
  findOne(@Param('accountId') accountId: string) {
    return this.accountsService.findOne(accountId);
  }

  @Patch(':accountId')
  update(@Param('accountId') accountId: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(accountId, dto);
  }

  @Delete(':accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('accountId') accountId: string) {
    return this.accountsService.remove(accountId);
  }
}
