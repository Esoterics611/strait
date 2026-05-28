import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class WebhookVerifier {
  verify(provider: string, rawBody: Buffer, signatureHex: string, secret: string): boolean {
    void provider;
    const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expectedHex, 'utf8');
    const receivedBuf = Buffer.from(signatureHex, 'utf8');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  }
}
