import { BadRequestException } from '@nestjs/common';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';

const MEMBER_ID = 'a0000000-0000-0000-0000-000000000001';

function makeService(): DevToolsService & {
  emitLocked: jest.Mock;
  meshConnect: jest.Mock;
  meshInitiate: jest.Mock;
} {
  return {
    emitLocked: jest.fn().mockResolvedValue({ txId: 'tx-1' }),
    meshConnect: jest.fn().mockResolvedValue({ meshAccountId: 'mesh_acct' }),
    meshInitiate: jest.fn().mockResolvedValue({
      txId: 'tx-2',
      correlationId: 'corr',
      meshTransferId: 'mesh_tr',
    }),
  } as unknown as DevToolsService & {
    emitLocked: jest.Mock;
    meshConnect: jest.Mock;
    meshInitiate: jest.Mock;
  };
}

describe('DevToolsController — input validation', () => {
  let svc: ReturnType<typeof makeService>;
  let ctrl: DevToolsController;

  beforeEach(() => {
    svc = makeService();
    ctrl = new DevToolsController(svc);
  });

  describe('emit-locked', () => {
    it('rejects missing memberId', async () => {
      await expect(
        ctrl.emitLocked({ amountUsdcUnits: '1000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(svc.emitLocked).not.toHaveBeenCalled();
    });

    it('rejects non-UUID memberId', async () => {
      await expect(
        ctrl.emitLocked({ memberId: 'not-a-uuid', amountUsdcUnits: '1000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-numeric amount', async () => {
      await expect(
        ctrl.emitLocked({ memberId: MEMBER_ID, amountUsdcUnits: 'abc' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects zero amount', async () => {
      await expect(
        ctrl.emitLocked({ memberId: MEMBER_ID, amountUsdcUnits: '0' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects negative-looking amount string (signed not allowed by regex)', async () => {
      await expect(
        ctrl.emitLocked({ memberId: MEMBER_ID, amountUsdcUnits: '-100' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forwards a valid request to the service', async () => {
      const res = await ctrl.emitLocked({
        memberId: MEMBER_ID,
        amountUsdcUnits: '5000000',
      });
      expect(res).toEqual({ txId: 'tx-1' });
      expect(svc.emitLocked).toHaveBeenCalledWith(MEMBER_ID, 5_000_000n);
    });
  });

  describe('mesh-connect', () => {
    it('rejects missing memberId', async () => {
      await expect(ctrl.meshConnect({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('forwards a valid request', async () => {
      const res = await ctrl.meshConnect({ memberId: MEMBER_ID });
      expect(res).toEqual({ meshAccountId: 'mesh_acct' });
      expect(svc.meshConnect).toHaveBeenCalledWith(MEMBER_ID);
    });
  });

  describe('mesh-initiate', () => {
    it('rejects missing amount', async () => {
      await expect(
        ctrl.meshInitiate({ memberId: MEMBER_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forwards a valid request', async () => {
      const recipientId = 'b0000000-0000-0000-0000-000000000099';
      const res = await ctrl.meshInitiate({
        memberId: MEMBER_ID,
        amountUsdcUnits: '1000000',
        recipientId,
      });
      expect(res).toEqual({
        txId: 'tx-2',
        correlationId: 'corr',
        meshTransferId: 'mesh_tr',
      });
      expect(svc.meshInitiate).toHaveBeenCalledWith(
        MEMBER_ID,
        1_000_000n,
        recipientId,
      );
    });

    it('rejects missing recipientId (S-B3 cutover)', async () => {
      await expect(
        ctrl.meshInitiate({
          memberId: MEMBER_ID,
          amountUsdcUnits: '1000000',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
