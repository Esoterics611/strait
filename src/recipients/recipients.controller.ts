import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RecipientsService } from './recipients.service';
import {
  DuplicateRecipientError,
  RecipientNotFoundError,
} from './recipients.errors';
import {
  CreateRecipientReq,
  RecipientDto,
  UpdateRecipientReq,
} from './recipient.types';
import { MemberAuthGuard, MemberAuthedReq } from '../api/auth/member-auth.guard';

/**
 * S-B2: owner identity comes from the member-scoped JWT (`req.member.memberId`).
 * The legacy `x-member-id` header path is REMOVED entirely — no member endpoint
 * trusts a body- or header-supplied owner. See MEMBER_APP_DESIGN.md §6 and the
 * S-B2 notes in SESSION_HISTORY.md §9.
 */
@Controller('api/recipients')
@UseGuards(MemberAuthGuard)
export class RecipientsController {
  constructor(private readonly service: RecipientsService) {}

  @Get()
  list(@Req() req: MemberAuthedReq): Promise<RecipientDto[]> {
    return this.service.list(req.member.memberId);
  }

  @Post()
  async create(
    @Body() body: CreateRecipientReq,
    @Req() req: MemberAuthedReq,
  ): Promise<RecipientDto> {
    if (!body?.displayName || !body?.payoutMethod || !body?.bank?.accountNumber) {
      throw new ConflictException('Missing required recipient fields');
    }
    try {
      return await this.service.create(req.member.memberId, body);
    } catch (e) {
      if (e instanceof DuplicateRecipientError) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
    @Req() req: MemberAuthedReq,
  ): Promise<RecipientDto> {
    try {
      return await this.service.get(req.member.memberId, id);
    } catch (e) {
      if (e instanceof RecipientNotFoundError) throw new NotFoundException();
      throw e;
    }
  }

  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() body: UpdateRecipientReq,
    @Req() req: MemberAuthedReq,
  ): Promise<RecipientDto> {
    try {
      return await this.service.update(req.member.memberId, id, body);
    } catch (e) {
      if (e instanceof RecipientNotFoundError) throw new NotFoundException();
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Req() req: MemberAuthedReq,
  ): Promise<void> {
    await this.service.remove(req.member.memberId, id);
  }
}
