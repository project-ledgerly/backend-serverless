import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';

@Module({ controllers: [AiController] })
export class AiModule {}
