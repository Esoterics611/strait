import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SessionStubGuard } from './session-stub.guard';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';

interface PayInOption {
  path: 'MESH';
  label: string;
  description: string;
  eta: string;
  fee: string;
  status: 'live' | 'coming_soon' | 'gated';
}

@Controller('api/members')
@UseGuards(SessionStubGuard)
export class MembersController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
  ) {}

  @Get(':memberId/inbound-paths')
  async paths(@Param('memberId') _memberId: string): Promise<{ paths: PayInOption[] }> {
    const paths: PayInOption[] = [
      {
        path: 'MESH',
        label: 'Crypto wallet',
        description: 'Connect your CEX or wallet — we pull USDC directly.',
        eta: '~30 min',
        fee: '0.5% network',
        status: 'live',
      },
    ];
    return { paths };
  }

  @Get(':memberId/accounts')
  async accounts(@Param('memberId') memberId: string): Promise<MemberAccountsResponse> {
    const rows = await this.dataSource.query<MemberAccountsRow[]>(
      `SELECT
         member_id,
         usdc_virtual_balance_wei,
         chain_id,
         created_at
       FROM member_accounts WHERE member_id = $1`,
      [memberId],
    );
    if (rows.length === 0) return { exists: false };
    const r = rows[0];
    return {
      exists: true,
      memberId: r.member_id,
      chainId: r.chain_id,
      usdcBalanceUnits: r.usdc_virtual_balance_wei,
    };
  }

  private async safeGet(key: string): Promise<string | undefined> {
    try {
      return await this.secrets.get(key);
    } catch {
      return undefined;
    }
  }
}

interface MemberAccountsRow {
  member_id: string;
  usdc_virtual_balance_wei: string;
  chain_id: number;
}

interface MemberAccountsResponse {
  exists: boolean;
  memberId?: string;
  chainId?: number;
  usdcBalanceUnits?: string;
}
