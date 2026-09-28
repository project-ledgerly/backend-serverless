import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AllocatePaydayService } from './allocate-payday.service.js';
import { AllocatePaydayDto } from './dto/allocate-payday.dto.js';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly allocatePaydayService: AllocatePaydayService) {}

  @Post(':planId/allocate')
  @ApiOkResponse({ description: 'Computed and persisted allocation amounts, keyed by section id.' })
  async allocate(@Param('planId') planId: string, @Body() dto: AllocatePaydayDto) {
    const outcome = await this.allocatePaydayService.run(planId, dto.incomeId, dto.incomeAmount);

    if (!outcome.ok) {
      throw new BadRequestException({ issues: outcome.validation.issues });
    }

    return {
      amounts: Object.fromEntries(
        Array.from(outcome.result.amounts.entries()).map(([sectionId, amount]) => [sectionId, amount.toString()]),
      ),
      order: outcome.result.order,
    };
  }
}
