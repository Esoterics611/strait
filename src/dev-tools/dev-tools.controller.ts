import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DevToolsService } from './dev-tools.service';
import { DevToolsGuard } from './dev-tools.guard';

interface EmitLockedBody {
  memberId?: string;
  amountUsdcUnits?: string;
}

interface MeshConnectBody {
  memberId?: string;
}

interface MeshInitiateBody {
  memberId?: string;
  amountUsdcUnits?: string;
  /** S-B3 required: the recipient on whose behalf the transfer is initiated. */
  recipientId?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/dev')
@UseGuards(DevToolsGuard)
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  @Post('emit-locked')
  @HttpCode(200)
  async emitLocked(@Body() body: EmitLockedBody): Promise<{ txId: string }> {
    const memberId = requireUuid(body?.memberId, 'memberId');
    const amount = requirePositiveBigint(body?.amountUsdcUnits, 'amountUsdcUnits');
    return this.devTools.emitLocked(memberId, amount);
  }

  @Post('mesh-connect')
  @HttpCode(200)
  async meshConnect(
    @Body() body: MeshConnectBody,
  ): Promise<{ meshAccountId: string }> {
    const memberId = requireUuid(body?.memberId, 'memberId');
    return this.devTools.meshConnect(memberId);
  }

  @Post('mesh-initiate')
  @HttpCode(200)
  async meshInitiate(
    @Body() body: MeshInitiateBody,
  ): Promise<{ txId: string; correlationId: string; meshTransferId: string }> {
    const memberId = requireUuid(body?.memberId, 'memberId');
    const amount = requirePositiveBigint(body?.amountUsdcUnits, 'amountUsdcUnits');
    const recipientId = requireUuid(body?.recipientId, 'recipientId');
    return this.devTools.meshInitiate(memberId, amount, recipientId);
  }
}

function requireUuid(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new BadRequestException(`${name} must be a UUID`);
  }
  return value;
}

function requirePositiveBigint(
  value: string | undefined,
  name: string,
): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BadRequestException(`${name} must be a non-negative integer string`);
  }
  const n = BigInt(value);
  if (n <= 0n) throw new BadRequestException(`${name} must be positive`);
  return n;
}
