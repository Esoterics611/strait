import { Logger } from '@nestjs/common';
import { StubOFACScreener } from './ofac-screener.service';
import { ISecretProvider } from '../secrets/secret-provider.interface';

class StubSecretProvider implements ISecretProvider {
  constructor(private readonly map: Record<string, string>) {}
  async get(key: string): Promise<string> {
    const v = this.map[key];
    if (v === undefined) throw new Error(`Missing ${key}`);
    return v;
  }
  async set(key: string, value: string): Promise<void> {
    this.map[key] = value;
  }
}

describe('StubOFACScreener', () => {
  it('returns blocked=false when OFAC_BLOCKLIST_CSV is unset', async () => {
    const screener = new StubOFACScreener(new StubSecretProvider({}));
    const res = await screener.screenAddress(
      '0x0000000000000000000000000000000000000001',
    );
    expect(res).toEqual({ blocked: false });
  });

  it('returns blocked=false when CSV is empty', async () => {
    const screener = new StubOFACScreener(
      new StubSecretProvider({ OFAC_BLOCKLIST_CSV: '' }),
    );
    expect(await screener.screenAddress('0xabc')).toEqual({ blocked: false });
  });

  it('returns blocked=true with reason when address matches the list', async () => {
    const target = '0xDeAdBeEfCaFeBaBe000000000000000000000001';
    const screener = new StubOFACScreener(
      new StubSecretProvider({
        OFAC_BLOCKLIST_CSV: `0x1111, ${target.toLowerCase()}, 0xffff`,
      }),
    );
    const res = await screener.screenAddress(target);
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('static_blocklist');
  });

  it('is case-insensitive on both the list and the address', async () => {
    const screener = new StubOFACScreener(
      new StubSecretProvider({
        OFAC_BLOCKLIST_CSV: '0xABC123',
      }),
    );
    const res = await screener.screenAddress('0xabc123');
    expect(res.blocked).toBe(true);
  });

  it('does not echo the address into the warn log payload', async () => {
    const screener = new StubOFACScreener(
      new StubSecretProvider({ OFAC_BLOCKLIST_CSV: '0xabc' }),
    );
    // BusinessLogger emits the structured envelope through NestJS Logger.warn —
    // spy there to assert the serialized line never contains the address.
    const calls: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((msg: unknown) => {
        calls.push(String(msg));
      });

    await screener.screenAddress('0xabc');
    spy.mockRestore();
    expect(calls.length).toBe(1);
    expect(calls[0]).not.toContain('0xabc');
    // The log should contain the category for the audit join.
    expect(calls[0]).toContain('ofac_screen_hit');
  });
});
