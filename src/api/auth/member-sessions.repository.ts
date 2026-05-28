import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface MemberSessionRow {
  session_id: string;
  member_id: string;
  jti: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  user_agent: string | null;
  ip: string | null;
}

@Injectable()
export class MemberSessionsRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async create(input: {
    memberId: string;
    jti: string;
    expiresAt: Date;
    userAgent?: string;
    ip?: string;
  }): Promise<MemberSessionRow> {
    const rows = await this.ds.query<MemberSessionRow[]>(
      `INSERT INTO member_sessions(member_id, jti, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.memberId,
        input.jti,
        input.expiresAt,
        input.userAgent?.slice(0, 512) ?? null,
        input.ip?.slice(0, 64) ?? null,
      ],
    );
    return rows[0];
  }

  /** Returns the row only if it is unexpired and unrevoked. */
  async findActive(jti: string): Promise<MemberSessionRow | null> {
    const rows = await this.ds.query<MemberSessionRow[]>(
      `SELECT * FROM member_sessions
        WHERE jti = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [jti],
    );
    return rows[0] ?? null;
  }

  async revoke(jti: string): Promise<void> {
    await this.ds.query(
      `UPDATE member_sessions SET revoked_at = NOW() WHERE jti = $1 AND revoked_at IS NULL`,
      [jti],
    );
  }
}
