import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DispatchService } from './dispatch.service';
import { PAYMENT_EVENTS } from '../events/domain-event-emitter.service';
import type { IDomainEvent } from '@common/interfaces';
import { BusinessLogger } from '@common/logging';

@Injectable()
export class DispatchListener {
  private readonly blog = new BusinessLogger('DispatchListener');

  constructor(private readonly dispatch: DispatchService) {}

  @OnEvent(PAYMENT_EVENTS.USDC_LOCKED)
  async onUsdcLocked(event: IDomainEvent<{ txId: string }>): Promise<void> {
    try {
      await this.dispatch.dispatchTransfer(event.payload.txId);
    } catch (err) {
      this.blog.error('onUsdcLocked', {
        txId: event.payload.txId,
        detail: { trigger: PAYMENT_EVENTS.USDC_LOCKED },
        error: err,
      });
    }
  }
}
