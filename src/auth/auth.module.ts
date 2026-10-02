import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { OwnershipService } from './ownership.service.js';
import { TokensController } from './tokens/tokens.controller.js';
import { TokensService } from './tokens/tokens.service.js';

@Module({
  imports: [
    JwtModule.register({
      global: false,
      secret: process.env.JWT_SECRET,
      // Env-sourced, so its format isn't statically known to the `ms`-based
      // union type JwtSignOptions expects — cast, not a type worth modeling.
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as never },
    }),
  ],
  controllers: [AuthController, TokensController],
  providers: [AuthService, OwnershipService, TokensService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
