import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';

export interface AuthResult {
  accessToken: string;
  userId: string;
  planId: string | null;
  accountId: string | null;
  name: string;
  currency: string;
}

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // One call creates the User, its default Plan, and its default Account —
    // the old passwordless flow (mobile/) made the caller do this as separate
    // requests; email/password registration is a natural point to fold it
    // into one, so the onboarding wizard always has an accountId to use.
    const { user, planId, accountId } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: dto.name, email: dto.email, passwordHash, currency: dto.currency },
      });
      const plan = await tx.plan.create({
        data: { userId: user.id, name: 'My Plan', status: 'ACTIVE' },
      });
      const account = await tx.account.create({
        data: { userId: user.id, name: 'Main Account', type: 'SPENDING', balance: 0 },
      });
      return { user, planId: plan.id, accountId: account.id };
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, userId: user.id, planId, accountId, name: user.name, currency: user.currency };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Same rejection whether the email doesn't exist or the password is
    // wrong — an old passwordless User (no passwordHash) can never log in
    // this way, which correctly falls into the same "invalid" branch.
    if (!user || !user.passwordHash || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const plan = await this.prisma.plan.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    const account = await this.prisma.account.findFirst({
      where: { userId: user.id },
      orderBy: { id: 'asc' },
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return {
      accessToken,
      userId: user.id,
      planId: plan?.id ?? null,
      accountId: account?.id ?? null,
      name: user.name,
      currency: user.currency,
    };
  }
}
