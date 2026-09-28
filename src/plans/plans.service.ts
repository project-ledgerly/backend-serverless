import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreatePlanDto } from './dto/create-plan.dto.js';
import type { UpdatePlanDto } from './dto/update-plan.dto.js';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreatePlanDto) {
    return this.prisma.plan.create({ data: dto });
  }

  findAllForUser(userId: string) {
    return this.prisma.plan.findMany({ where: { userId } });
  }

  async findOne(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { sections: true },
    });
    if (!plan) throw new NotFoundException(`Plan ${id} not found`);
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findOne(id);
    return this.prisma.plan.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.plan.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('Plan still has sections — delete those first');
      }
      throw error;
    }
  }
}
