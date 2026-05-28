import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { DevToolsGuard } from './dev-tools.guard';
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

const noopCtx = {} as ExecutionContext;

describe('DevToolsGuard', () => {
  it('throws ForbiddenException when DEV_TOOLS_ENABLED is unset', async () => {
    const guard = new DevToolsGuard(
      new StubSecretProvider({ NODE_ENV: 'development' }),
    );
    await expect(guard.canActivate(noopCtx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when DEV_TOOLS_ENABLED is empty', async () => {
    const guard = new DevToolsGuard(
      new StubSecretProvider({ NODE_ENV: 'development', DEV_TOOLS_ENABLED: '' }),
    );
    await expect(guard.canActivate(noopCtx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when NODE_ENV=production even with flag set', async () => {
    const guard = new DevToolsGuard(
      new StubSecretProvider({
        NODE_ENV: 'production',
        DEV_TOOLS_ENABLED: 'true',
      }),
    );
    await expect(guard.canActivate(noopCtx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns true when NODE_ENV!=production AND flag is non-empty', async () => {
    const guard = new DevToolsGuard(
      new StubSecretProvider({
        NODE_ENV: 'development',
        DEV_TOOLS_ENABLED: 'true',
      }),
    );
    await expect(guard.canActivate(noopCtx)).resolves.toBe(true);
  });

  it('accepts any non-empty flag value (treats them as opt-in)', async () => {
    const guard = new DevToolsGuard(
      new StubSecretProvider({
        NODE_ENV: 'development',
        DEV_TOOLS_ENABLED: '1',
      }),
    );
    await expect(guard.canActivate(noopCtx)).resolves.toBe(true);
  });
});
