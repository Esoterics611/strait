import { EnvSecretProvider } from './env-secret.provider';

describe('EnvSecretProvider', () => {
  let provider: EnvSecretProvider;
  const TEST_KEY = '__LIRABRIDGE_TEST_SECRET_KEY__';

  beforeEach(() => {
    provider = new EnvSecretProvider();
    delete process.env[TEST_KEY];
  });

  afterEach(() => {
    delete process.env[TEST_KEY];
  });

  describe('get()', () => {
    it('returns the value when the env var is set', async () => {
      process.env[TEST_KEY] = 'my-secret-value';
      await expect(provider.get(TEST_KEY)).resolves.toBe('my-secret-value');
    });

    it('throws (not returns undefined) when the env var is missing', async () => {
      await expect(provider.get(TEST_KEY)).rejects.toThrow();
    });

    it('throws when the env var is an empty string', async () => {
      process.env[TEST_KEY] = '';
      await expect(provider.get(TEST_KEY)).rejects.toThrow();
    });

    it('does not expose the secret value in the error message', async () => {
      // Value should never appear in error messages — only absence is reported
      await expect(provider.get(TEST_KEY)).rejects.not.toThrow(
        expect.objectContaining({ message: expect.stringContaining('undefined') }),
      );
    });

    it('includes the key name in the error so the caller can debug', async () => {
      await expect(provider.get(TEST_KEY)).rejects.toThrow(TEST_KEY);
    });
  });

  describe('set()', () => {
    it('writes the value to process.env in-process', async () => {
      await provider.set(TEST_KEY, 'written-value');
      expect(process.env[TEST_KEY]).toBe('written-value');
    });

    it('a value written via set() is returned by a subsequent get()', async () => {
      await provider.set(TEST_KEY, 'set-then-get');
      await expect(provider.get(TEST_KEY)).resolves.toBe('set-then-get');
    });

    it('overwrites an existing env var', async () => {
      process.env[TEST_KEY] = 'original';
      await provider.set(TEST_KEY, 'overwritten');
      await expect(provider.get(TEST_KEY)).resolves.toBe('overwritten');
    });
  });
});
