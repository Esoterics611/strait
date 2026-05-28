import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { SourceType } from '@common/enums';

@Injectable()
export class IdempotencyService {
  buildKey(
    memberId: string,
    sourceType: SourceType,
    sourceReferenceId: string,
  ): string {
    // Colon delimiter prevents (memberId='a', ref='bc') ≡ (memberId='ab', ref='c').
    return createHash('sha256')
      .update(`${memberId}:${sourceType}:${sourceReferenceId}`)
      .digest('hex');
  }
}
