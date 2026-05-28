export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string;
  webhookBaseUrl: string;

  mesh: {
    webhookSecret: string;
    mockEnabled: boolean;
  };

  dispatch: {
    mockEnabled: boolean;
    mockSettleMs: number;
    mockFailureRate: number;
    recipientDispatchEnabled: boolean;
  };

  chain: {
    enabled: boolean;
    rpcUrl: string;
    privateKey: string;
    usdcMainnet: string;
    usdcBase: string;
  };

  custodial: {
    enabled: boolean;
    apiKey: string;
    apiBaseUrl: string;
    webhookSecret: string;
  };

  memberAuth: {
    jwtSecret: string;
    magicLinkTtlSeconds: number;
  };

  admin: {
    jwtSecret: string;
  };

  devTools: {
    enabled: boolean;
  };
}
