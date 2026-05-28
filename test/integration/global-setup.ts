import { execSync } from 'child_process';
import * as path from 'path';
import { DEFAULT_DATABASE_URL } from './db';

// Phase 0 regression oracle: runs against the REAL docker-compose Postgres.
// Applies any pending migrations idempotently via the project's own
// typeorm-ts-node runner (the same path the dev DB was built with), so the
// schema under test is always current (incl. the recipients migration).
export default async function globalSetup(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const DATABASE_URL = process.env['DATABASE_URL'] || DEFAULT_DATABASE_URL;
  try {
    execSync('npm run --silent migration:run', {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL },
      stdio: 'pipe',
      timeout: 120_000,
    });
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const out = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
    throw new Error(
      'Integration global-setup: `migration:run` failed against ' +
        `${DATABASE_URL}\n` +
        'Is the docker-compose Postgres (or a local strait cluster) up?\n' +
        out +
        (e.message ?? ''),
    );
  }
}
