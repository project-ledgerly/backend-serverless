import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller.js';
import { OAuthService } from './oauth.service.js';

@Module({
  controllers: [OAuthController],
  providers: [OAuthService],
})
export class OAuthModule {}
