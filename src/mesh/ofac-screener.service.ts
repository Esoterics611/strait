import { Inject, Injectable } from '@nestjs/common';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';
import { BusinessLogger } from '@common/logging';

export const OFAC_SCREENER = Symbol('OFAC_SCREENER');

export interface ScreeningResult {
  blocked: boolean;
  reason?: string;
}

export interface IOFACScreener {
  screenAddress(walletAddress: string): Promise<ScreeningResult>;
}

// Stub OFAC implementation: reads a CSV blocklist from SECRET_PROVIDER.get
// ('OFAC_BLOCKLIST_CSV'). Comma-separated, case-insensitive, whitespace-trimmed.
// Empty string = no list = nothing blocked.
//
// Real OFAC API integration is blocked behind CU-05 (FinCEN money-transmission
// classification). The interface is the swap point — when the legal review
// resolves, drop in a Chainalysis / TRM / Elliptic adapter behind this same
// IOFACScreener contract.
@Injectable()
export class StubOFACScreener implements IOFACScreener {
  private readonly blog = new BusinessLogger('StubOFACScreener');

  constructor(
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
  ) {}

  async screenAddress(walletAddress: string): Promise<ScreeningResult> {
    const csv = await this.safeGet('OFAC_BLOCKLIST_CSV');
    if (!csv) return { blocked: false };

    const blocklist = csv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    const target = walletAddress.trim().toLowerCase();
    const hit = blocklist.includes(target);

    if (hit) {
      // Structured WARN — do NOT log the address itself; auditors will pull
      // the underlying tx via category + memberId in the calling site.
      this.blog.warn('screenAddress', {
        detail: {
          category: 'ofac_screen_hit',
          reason: 'static_blocklist',
          addressLen: walletAddress.length,
        },
      });
      return { blocked: true, reason: 'static_blocklist' };
    }

    return { blocked: false };
  }

  private async safeGet(key: string): Promise<string | undefined> {
    try {
      return await this.secrets.get(key);
    } catch {
      return undefined;
    }
  }
}
