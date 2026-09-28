import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateIncomeDto } from './dto/create-income.dto.js';

@Injectable()
export class IncomeService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateIncomeDto) {
    return this.prisma.income.create({
      data: {
        userId: dto.userId,
        amount: dto.amount,
        source: dto.source,
        date: new Date(dto.date),
        recurring: dto.recurring ?? false,
      },
    });
  }

  findAllForUser(userId: string) {
    return this.prisma.income.findMany({ where: { userId }, orderBy: { date: 'desc' } });
  }

  async findOne(id: string) {
    const income = await this.prisma.income.findUnique({ where: { id } });
    if (!income) throw new NotFoundException(`Income ${id} not found`);
    return income;
  }
}
