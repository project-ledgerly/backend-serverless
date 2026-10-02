import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const MAX_IDENTIFIERS = 5;

/** Strips spaces and dashes so "1224-5283 6108" and "122452836108" are the same. */
export const normaliseIdentifier = (value: string) => value.replace(/[\s-]/g, '').toLowerCase();

@Injectable()
export class AccountLinkService {
  constructor(private readonly prisma: PrismaService) {}

  /** Remembers how the bank names one of the user's accounts. */
  async link(userId: string, accountId: string, identifier: string) {
    const wanted = normaliseIdentifier(identifier);
    if (wanted.length < 4) throw new BadRequestException('identifier must have at least 4 characters');

    const accounts = await this.prisma.account.findMany({ where: { userId } });
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new NotFoundException('Account not found');

    // The same number cannot name two accounts, or a statement could not be matched.
    for (const other of accounts) {
      if (other.id !== accountId && other.identifiers.some((i) => normaliseIdentifier(i) === wanted)) {
        throw new ConflictException(`"${identifier}" is already linked to your account "${other.name}"`);
      }
    }
    if (account.identifiers.some((i) => normaliseIdentifier(i) === wanted)) {
      return { id: account.id, name: account.name, identifiers: account.identifiers };
    }
    if (account.identifiers.length >= MAX_IDENTIFIERS) {
      throw new BadRequestException(`An account can have at most ${MAX_IDENTIFIERS} identifiers`);
    }

    const updated = await this.prisma.account.update({
      where: { id: accountId },
      data: { identifiers: { push: identifier.trim() } },
    });
    return { id: updated.id, name: updated.name, identifiers: updated.identifiers };
  }
}
