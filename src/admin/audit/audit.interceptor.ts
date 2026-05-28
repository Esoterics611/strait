import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { createHash } from 'crypto';
import { Request } from 'express';
import { AdminAuthedReq } from '../auth/role.guard';
import { AuditLogRepository } from './audit-log.repository';

/**
 * Records an admin_audit_log entry after every successful /admin/* write call.
 * Action: METHOD <controller-path>. target_type/target_id inferred from URL params.
 *
 * NOTE: this interceptor records *after* the controller resolves. Atomic
 * write-with-audit (rollback-safe) inside a single transaction is handled
 * inside individual services (DualApprovalService.approve, manualCredit, …)
 * via AuditLogRepository.writeInTransaction. This interceptor is the catch-all
 * for everything else, sufficient for non-critical operator visibility.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditLogRepository) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AdminAuthedReq & Request>();
    const method = req.method;
    const path = req.route?.path ?? req.path;
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (!isWrite || !req.adminUser) {
      return next.handle();
    }
    const operatorId = req.adminUser.sub;
    const action = `${method} ${path}`;
    const { targetType, targetId } = inferTarget(path, req.params);
    const payloadHash =
      req.body && Object.keys(req.body).length > 0
        ? createHash('sha256').update(JSON.stringify(req.body)).digest('hex')
        : null;
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? null;
    const userAgent = req.headers['user-agent'] ?? null;

    return next.handle().pipe(
      tap(() => {
        this.audit
          .write({ operatorId, action, targetType, targetId, payloadHash, ip, userAgent })
          .catch(() => undefined);
      }),
    );
  }
}

function inferTarget(
  path: string,
  params: Record<string, string> | undefined,
): { targetType: string; targetId: string | null } {
  if (!params) return { targetType: 'unknown', targetId: null };
  if (params.txId) return { targetType: 'tx', targetId: params.txId };
  if (params.id && path.includes('/members/')) return { targetType: 'member', targetId: params.id };
  if (params.id && path.includes('/users/'))   return { targetType: 'admin_user', targetId: params.id };
  if (params.id && path.includes('/webhooks/'))return { targetType: 'webhook', targetId: params.id };
  if (params.id && path.includes('/approvals/'))return { targetType: 'approval', targetId: params.id };
  if (params.name)return { targetType: 'flag', targetId: params.name };
  return { targetType: 'system', targetId: null };
}
