import { registerAs } from '@nestjs/config';
import { AppConfig } from './app-config.interface';

export const appConfigFactory = registerAs<AppConfig>('app', (): AppConfig => ({
  nodeEnv: (process.env['NODE_ENV'] as AppConfig['nodeEnv']) ?? 'development',
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  databaseUrl: process.env['DATABASE_URL'] ?? '',
  webhookBaseUrl: process.env['WEBHOOK_BASE_URL'] ?? '',
  mesh: {
    webhookSecret: process.env['MESH_WEBHOOK_SECRET'] ?? '',
    mockEnabled: process.env['MOCK_MESH_ENABLED'] === 'true',
  },
  dispatch: {
    mockEnabled: process.env['MOCK_DISPATCH_ENABLED'] !== 'false',
    mockSettleMs: parseInt(process.env['MOCK_DISPATCH_SETTLE_MS'] ?? '250', 10),
    mockFailureRate: parseFloat(process.env['MOCK_DISPATCH_FAILURE_RATE'] ?? '0'),
    recipientDispatchEnabled: process.env['RECIPIENT_DISPATCH_ENABLED'] === 'true',
  },
  chain: {
    enabled: process.env['CHAIN_DISPATCHER_ENABLED'] !== 'false',
    rpcUrl: process.env['CHAIN_RPC_URL'] ?? '',
    privateKey: process.env['CHAIN_PRIVATE_KEY'] ?? '',
    usdcMainnet: process.env['CHAIN_USDC_CONTRACT_MAINNET'] ?? '',
    usdcBase: process.env['CHAIN_USDC_CONTRACT_BASE'] ?? '',
  },
  custodial: {
    enabled: process.env['CUSTODIAL_DISPATCHER_ENABLED'] === 'true',
    apiKey: process.env['CUSTODIAL_API_KEY'] ?? '',
    apiBaseUrl: process.env['CUSTODIAL_API_BASE_URL'] ?? '',
    webhookSecret: process.env['CUSTODIAL_WEBHOOK_SECRET'] ?? '',
  },
  memberAuth: {
    jwtSecret: process.env['MEMBER_JWT_SECRET'] ?? '',
    magicLinkTtlSeconds: parseInt(process.env['MEMBER_MAGIC_LINK_TTL_SECONDS'] ?? '600', 10),
  },
  admin: {
    jwtSecret: process.env['ADMIN_JWT_SECRET'] ?? '',
  },
  devTools: {
    enabled: process.env['DEV_TOOLS_ENABLED'] === 'true',
  },
}));
