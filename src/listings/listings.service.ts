import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateListingDto } from './dto/create-listing.dto.js';
import type { UpdateListingDto } from './dto/update-listing.dto.js';

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  // A Section carries no userId of its own — ownership is only reachable
  // through its Plan. One extra query here is what lets Listing.userId be a
  // direct column (cheap lookups later) without trusting the caller's word
  // for who owns the Section it's attached to.
  private async assertUserOwnsSection(sectionId: string, userId: string) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      include: { plan: true },
    });
    if (!section) throw new NotFoundException(`Section ${sectionId} not found`);
    if (section.plan.userId !== userId) {
      throw new BadRequestException(`Section ${sectionId} does not belong to user ${userId}`);
    }
    return section;
  }

  async create(sectionId: string, dto: CreateListingDto) {
    await this.assertUserOwnsSection(sectionId, dto.userId);
    return this.prisma.listing.create({
      data: { sectionId, userId: dto.userId, name: dto.name, amount: dto.amount, dueDay: dto.dueDay ?? null },
    });
  }

  /** Every listing the user has across all their sections (the Bills page). */
  findAllForUser(userId: string) {
    return this.prisma.listing.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  findAllForSection(sectionId: string) {
    return this.prisma.listing.findMany({ where: { sectionId }, orderBy: { createdAt: 'asc' } });
  }

  async findOne(id: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException(`Listing ${id} not found`);
    return listing;
  }

  async update(id: string, dto: UpdateListingDto) {
    await this.findOne(id);
    return this.prisma.listing.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.listing.delete({ where: { id } });
  }
}
