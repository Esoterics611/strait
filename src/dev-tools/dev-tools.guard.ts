import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  ISecretProvider,
  SECRET_PROVIDER,
} from '../secrets/secret-provider.interface';

// Two-gate check on every /api/dev/* request:
//   1. NODE_ENV must NOT equal 'production'.
//   2. DEV_TOOLS_ENABLED must be a non-empty value (any non-empty string opts in).
// Either failure → HTTP 403 (never 404) so a probing caller cannot tell whether
// the route exists.
@Injectable()
export class DevToolsGuard implements CanActivate {
  constructor(
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
  ) {}

  async canActivate(_ctx: ExecutionContext): Promise<boolean> {
    const nodeEnv = await this.safeGet('NODE_ENV');
    if (nodeEnv === 'production') {
      throw new ForbiddenException('dev-tools endpoints are disabled');
    }
    const flag = await this.safeGet('DEV_TOOLS_ENABLED');
    if (!flag || flag.trim().length === 0) {
      throw new ForbiddenException('dev-tools endpoints are disabled');
    }
    return true;
  }

  private async safeGet(key: string): Promise<string | undefined> {
    try {
      return await this.secrets.get(key);
    } catch {
      return undefined;
    }
  }
}
