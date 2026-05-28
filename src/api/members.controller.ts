import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SessionStubGuard } from './session-stub.guard';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';

interface InboundPath {
  path: 'MESH' | 'ONRAMP' | 'SELF';
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
  async paths(@Param('memberId') _memberId: string): Promise<{ paths: InboundPath[] }> {
    const pathCEnabled = (await this.safeGet('PATH_C_ENABLED')) === 'true';

    const paths: InboundPath[] = [
      {
        path: 'MESH',
        label: 'Crypto wallet',
        description: 'Connect your CEX or wallet — we pull USDC directly.',
        eta: '~30 min',
        fee: '0.5% network',
        status: 'coming_soon',
      },
      {
        path: 'ONRAMP',
        label: 'ILS via Rapyd',
        description: 'Wire shekels to a Rapyd-issued IL bank account. We convert to USDC.',
        eta: '2 – 24 hours',
        fee: '1.5% + spread',
        status: 'live',
      },
    ];

    if (pathCEnabled) {
      paths.push({
        path: 'SELF',
        label: 'Direct ILS wire',
        description: 'Wire shekels straight to our IL account. Fastest end-to-end.',
        eta: '~15 min',
        fee: '0.9% + spread',
        status: 'live',
      });
    }

    return { paths };
  }

  @Get(':memberId/accounts')
  async accounts(@Param('memberId') memberId: string): Promise<MemberAccountsResponse> {
    const rows = await this.dataSource.query<MemberAccountsRow[]>(
      `SELECT
         member_id,
         bridge_liquid_address,
         bridge_customer_id,
         usdc_virtual_balance_wei,
         ils_collection_account,
         onramp_provider_ref,
         onramp_account_payload,
         chain_id
       FROM member_accounts WHERE member_id = $1`,
      [memberId],
    );
    if (rows.length === 0) {
      return { exists: false };
    }
    const r = rows[0];
    const pathCEnabled = (await this.safeGet('PATH_C_ENABLED')) === 'true';

    return {
      exists: true,
      memberId: r.member_id,
      chainId: r.chain_id,
      usdcBalanceUnits: r.usdc_virtual_balance_wei,
      bridge: {
        liquidAddress: r.bridge_liquid_address,
        customerId: r.bridge_customer_id,
      },
      onramp: r.onramp_account_payload
        ? {
            providerRef: r.onramp_provider_ref ?? '',
            payload: r.onramp_account_payload,
          }
        : null,
      ilsCollection: pathCEnabled
        ? { reference: r.ils_collection_account ?? '' }
        : null,
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
  bridge_liquid_address: string;
  bridge_customer_id: string;
  usdc_virtual_balance_wei: string;
  ils_collection_account: string | null;
  onramp_provider_ref: string | null;
  onramp_account_payload: Record<string, unknown> | null;
  chain_id: number;
}

interface MemberAccountsResponse {
  exists: boolean;
  memberId?: string;
  chainId?: number;
  usdcBalanceUnits?: string;
  bridge?: { liquidAddress: string; customerId: string };
  onramp?: { providerRef: string; payload: Record<string, unknown> } | null;
  ilsCollection?: { reference: string } | null;
}
