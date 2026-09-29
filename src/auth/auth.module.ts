import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

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
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
