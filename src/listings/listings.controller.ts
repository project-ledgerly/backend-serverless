import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ListingsService } from './listings.service.js';
import { CreateListingDto } from './dto/create-listing.dto.js';
import { UpdateListingDto } from './dto/update-listing.dto.js';

@ApiTags('listings')
@Controller()
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Post('sections/:sectionId/listings')
  create(@Param('sectionId') sectionId: string, @Body() dto: CreateListingDto) {
    return this.listingsService.create(sectionId, dto);
  }

  @Get('listings')
  findAllForUser(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('userId query param is required');
    }
    return this.listingsService.findAllForUser(userId);
  }

  @Get('sections/:sectionId/listings')
  findAllForSection(@Param('sectionId') sectionId: string) {
    return this.listingsService.findAllForSection(sectionId);
  }

  @Patch('listings/:listingId')
  update(@Param('listingId') listingId: string, @Body() dto: UpdateListingDto) {
    return this.listingsService.update(listingId, dto);
  }

  @Delete('listings/:listingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('listingId') listingId: string) {
    return this.listingsService.remove(listingId);
  }
}
