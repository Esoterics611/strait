/**
 * Process-wide logging configuration.
 *
 * BusinessLogger and the global exception filter are instantiated outside the
 * Nest DI container (services do `new BusinessLogger('Name')` at field-init
 * time, before any module init), so they cannot inject ConfigService. They
 * only need ONE bit of config: whether we are in production (stack traces are
 * omitted from log envelopes in prod — never log internal frames to an
 * aggregator that ships off-box).
 *
 * Raw environment access is forbidden here (ARCH-1 Phase 2 rule c). The value
 * is pushed in once at boot by LoggingModule, which DOES inject ConfigService.
 * Default is non-production: in the worst case (setter never called, e.g. a
 * unit test) we include stack traces — safe for dev, never leaks in prod
 * because the real boot path always sets it.
 */
let production = false;

export function setLogProduction(isProduction: boolean): void {
  production = isProduction;
}

export function isLogProduction(): boolean {
  return production;
}
