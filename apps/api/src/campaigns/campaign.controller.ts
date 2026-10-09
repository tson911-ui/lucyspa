import type {
  CampaignCreateRequest,
  CampaignDetailResponse,
  CampaignEditRequest,
  CampaignEndRequest,
  CampaignGroupRequest,
  CampaignItemsAddFilteredRequest,
  CampaignItemsAddRequest,
  CampaignItemsRemoveRequest,
  CampaignItemsResponse,
  CampaignListResponse,
  CampaignPickerResponse,
  CampaignPublishRequest,
} from '@lucy-spa/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { sessionCookie } from '../auth/cookies.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { CampaignService } from './campaign.service.js';

/*
 * Only the contract's fields are accepted (the global pipe forbids unknown ones). Values are validated again, with exact rules, in the
 * core: the decorators only keep the wrong types out.
 */
const version = () => IsInt();

class CreateDto implements CampaignCreateRequest {
  @ApiProperty() @IsString() @MaxLength(80) slug!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameVi!: string;
  @ApiProperty() @IsString() @MaxLength(400) nameEn!: string;
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(4000)
  internalNote?: string | null;
  @ApiProperty() @IsString() @MaxLength(40) startsAt!: string;
  @ApiProperty() @IsString() @MaxLength(40) endsAt!: string;
}

const optionalText = (max: number) => (target: object, key: string | symbol) => {
  IsOptional()(target, key);
  ValidateIf((_object: unknown, value: unknown) => value !== null)(target, key);
  IsString()(target, key);
  MaxLength(max)(target, key);
  ApiProperty({ required: false, nullable: true })(target, key);
};

class EditDto implements CampaignEditRequest {
  @ApiProperty() @version() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) nameVi?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(400) nameEn?: string;
  @optionalText(4000) internalNote?: string | null;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) startsAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) endsAt?: string;
  @optionalText(200) badgeVi?: string | null;
  @optionalText(200) badgeEn?: string | null;
  @optionalText(600) headlineVi?: string | null;
  @optionalText(600) headlineEn?: string | null;
  @optionalText(1600) messageVi?: string | null;
  @optionalText(1600) messageEn?: string | null;
  @optionalText(200) ctaLabelVi?: string | null;
  @optionalText(200) ctaLabelEn?: string | null;
  @optionalText(64) bannerMediaId?: string | null;
}

class VersionDto implements CampaignPublishRequest {
  @ApiProperty() @version() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
}
class GroupDto implements CampaignGroupRequest {
  @ApiProperty() @version() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsObject() rule!: CampaignGroupRequest['rule'];
}
class ItemsAddDto implements CampaignItemsAddRequest {
  @ApiProperty() @version() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) groupId!: string;
  @ApiProperty() @IsArray() variantIds!: string[];
}
class ItemsAddFilteredDto implements CampaignItemsAddFilteredRequest {
  @ApiProperty() @version() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(64) groupId!: string;
  @ApiProperty() @IsObject() filter!: CampaignItemsAddFilteredRequest['filter'];
}
class ItemsRemoveDto implements CampaignItemsRemoveRequest {
  @ApiProperty() @version() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsArray() variantIds!: string[];
}
class EndDto implements CampaignEndRequest {
  @ApiProperty() @version() @Min(1) @Max(2_147_483_647) expectedVersion!: number;
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
}

class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(16) state?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(8) page?: string;
}
class ItemsQueryDto {
  @IsOptional() @IsString() @MaxLength(8) page?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(64) groupId?: string;
  @IsOptional() @IsString() @MaxLength(16) problem?: string;
}
class PickerQueryDto {
  @IsOptional() @IsString() @MaxLength(8) page?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsString() @MaxLength(64) brandId?: string;
  @IsOptional() @IsString() @MaxLength(64) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(20) minPriceVnd?: string;
  @IsOptional() @IsString() @MaxLength(20) maxPriceVnd?: string;
  @IsOptional() @IsString() @MaxLength(5) inStockOnly?: string;
}

@Controller('api/v1/product-campaigns')
export class CampaignController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(CampaignService) private readonly campaigns: CampaignService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'The campaigns, 20 a page, newest first within their state (MANAGE_PRODUCT_PRICES).',
  })
  list(@Query() query: ListQueryDto, @Req() request: Request): Promise<CampaignListResponse> {
    return this.campaigns.list(this.session(request), query);
  }

  @Get(':id')
  @ApiOkResponse({
    description:
      'One campaign with its groups and the review a publisher reads (MANAGE_PRODUCT_PRICES).',
  })
  get(@Param('id') id: string, @Req() request: Request): Promise<CampaignDetailResponse> {
    return this.campaigns.get(this.session(request), id);
  }

  @Get(':id/items')
  @ApiOkResponse({
    description: 'The chosen products of a campaign with the price its rule gives, 20 a page.',
  })
  items(
    @Param('id') id: string,
    @Query() query: ItemsQueryDto,
    @Req() request: Request,
  ): Promise<CampaignItemsResponse> {
    return this.campaigns.items(this.session(request), id, query);
  }

  @Get(':id/picker')
  @ApiOkResponse({ description: 'The products a campaign can take, filtered, 20 a page.' })
  picker(
    @Param('id') id: string,
    @Query() query: PickerQueryDto,
    @Req() request: Request,
  ): Promise<CampaignPickerResponse> {
    return this.campaigns.picker(this.session(request), id, { ...query });
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ description: 'Creates a draft campaign (MANAGE_PRODUCT_PRICES).' })
  create(
    @Body() body: CreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.create(this.session(request), body, this.requestId(response));
  }

  @Post(':id/edit')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Edits a draft; a published campaign takes only its texts and image.',
  })
  edit(
    @Param('id') id: string,
    @Body() body: EditDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.edit(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/groups')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Adds a rule group to a draft.' })
  addGroup(
    @Param('id') id: string,
    @Body() body: GroupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.addGroup(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/groups/:groupId/edit')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Changes the rule of a group of a draft.' })
  editGroup(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: GroupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.editGroup(
      this.session(request),
      id,
      groupId,
      body,
      this.requestId(response),
    );
  }

  @Post(':id/groups/:groupId/remove')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Removes a group and its products from a draft.' })
  removeGroup(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.removeGroup(
      this.session(request),
      id,
      groupId,
      body,
      this.requestId(response),
    );
  }

  @Post(':id/items/add')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Puts products into a group of a draft (up to 2000 at once).' })
  addItems(
    @Param('id') id: string,
    @Body() body: ItemsAddDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.addItems(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/items/add-filtered')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Puts every product that matches a filter into a group of a draft (select all of the result).',
  })
  addFilteredItems(
    @Param('id') id: string,
    @Body() body: ItemsAddFilteredDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.addFilteredItems(
      this.session(request),
      id,
      body,
      this.requestId(response),
    );
  }

  @Post(':id/items/remove')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Takes products out of a draft.' })
  removeItems(
    @Param('id') id: string,
    @Body() body: ItemsRemoveDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.removeItems(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Publishes a draft: from now on its window, rules and products never change.',
  })
  publish(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.publish(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/end')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Ends a published campaign now, with a reason; the prices return by themselves.',
  })
  end(
    @Param('id') id: string,
    @Body() body: EndDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CampaignDetailResponse> {
    return this.campaigns.end(this.session(request), id, body, this.requestId(response));
  }

  @Post(':id/delete')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Deletes a draft that was never published.' })
  remove(
    @Param('id') id: string,
    @Body() body: VersionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ deleted: true }> {
    return this.campaigns.remove(this.session(request), id, body, this.requestId(response));
  }

  private session(request: Request) {
    return sessionCookie(request.headers.cookie, this.environment.auth.cookieName);
  }

  private requestId(response: Response) {
    const value = response.getHeader('x-request-id');
    return typeof value === 'string' ? value : undefined;
  }
}
