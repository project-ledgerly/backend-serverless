import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { API_TOKEN_PREFIX } from '../auth-context.js';
import { hashApiToken } from '../auth.guard.js';
import type { CreateTokenDto } from './dto/create-token.dto.js';

const publicFields = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  accountIds: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** The secret is returned here once; only its hash is kept. */
  async create(userId: string, dto: CreateTokenDto) {
    const accountIds = dto.accountIds ?? [];
    if (accountIds.length > 0) {
      const owned = await this.prisma.account.count({ where: { id: { in: accountIds }, userId } });
      if (owned !== accountIds.length) throw new BadRequestException('accountIds must all be your accounts');
    }

    const secret = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const expiresAt = dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86_400_000) : null;
    const row = await this.prisma.apiToken.create({
      data: {
        userId,
        name: dto.name,
        prefix: secret.slice(0, 12),
        tokenHash: hashApiToken(secret),
        scopes: dto.scopes,
        accountIds,
        expiresAt,
      },
      select: publicFields,
    });
    return { ...row, token: secret };
  }

  list(userId: string) {
    return this.prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: publicFields,
    });
  }

  async revoke(userId: string, id: string) {
    const row = await this.prisma.apiToken.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Token not found');
    if (row.revokedAt) return { id, revoked: true };
    await this.prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true };
  }
}
