import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AdminRole } from './jwt.service';

export interface AdminUserRow {
  user_id: string;
  email: string;
  password_hash: string;
  mfa_secret_enc: Buffer | null;
  mfa_enrolled: boolean;
  role: AdminRole;
  is_active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

@Injectable()
export class AdminUsersRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findByEmail(email: string): Promise<AdminUserRow | null> {
    const rows = await this.dataSource.query<AdminUserRow[]>(
      `SELECT * FROM admin_users WHERE email = $1 LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }

  async findById(userId: string): Promise<AdminUserRow | null> {
    const rows = await this.dataSource.query<AdminUserRow[]>(
      `SELECT * FROM admin_users WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async list(): Promise<AdminUserRow[]> {
    return this.dataSource.query<AdminUserRow[]>(
      `SELECT * FROM admin_users ORDER BY created_at DESC`,
    );
  }

  async insert(
    email: string,
    passwordHash: string,
    role: AdminRole,
  ): Promise<AdminUserRow> {
    const rows = await this.dataSource.query<AdminUserRow[]>(
      `INSERT INTO admin_users(email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [email, passwordHash, role],
    );
    return rows[0];
  }

  async updateMfa(userId: string, secretEnc: Buffer): Promise<void> {
    await this.dataSource.query(
      `UPDATE admin_users SET mfa_secret_enc = $1, mfa_enrolled = TRUE WHERE user_id = $2`,
      [secretEnc, userId],
    );
  }

  async markMfaPendingVerification(userId: string): Promise<void> {
    // Set mfa_enrolled = FALSE while keeping the secret around so the next
    // verifyCode call can both confirm the code and flip enrolled=true.
    await this.dataSource.query(
      `UPDATE admin_users SET mfa_enrolled = FALSE WHERE user_id = $1`,
      [userId],
    );
  }

  async markMfaConfirmed(userId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE admin_users SET mfa_enrolled = TRUE WHERE user_id = $1`,
      [userId],
    );
  }

  async resetMfa(userId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE admin_users SET mfa_secret_enc = NULL, mfa_enrolled = FALSE WHERE user_id = $1`,
      [userId],
    );
  }

  async updateRole(userId: string, role: AdminRole): Promise<void> {
    await this.dataSource.query(`UPDATE admin_users SET role = $1 WHERE user_id = $2`, [role, userId]);
  }

  async setActive(userId: string, active: boolean): Promise<void> {
    await this.dataSource.query(`UPDATE admin_users SET is_active = $1 WHERE user_id = $2`, [active, userId]);
  }

  async touchLogin(userId: string): Promise<void> {
    await this.dataSource.query(`UPDATE admin_users SET last_login_at = NOW() WHERE user_id = $1`, [userId]);
  }

  async insertInTransaction(
    em: EntityManager,
    email: string,
    passwordHash: string,
    role: AdminRole,
  ): Promise<AdminUserRow> {
    const rows = await em.query<AdminUserRow[]>(
      `INSERT INTO admin_users(email, password_hash, role)
       VALUES ($1, $2, $3) RETURNING *`,
      [email, passwordHash, role],
    );
    return rows[0];
  }

  async countActive(): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM admin_users WHERE is_active = TRUE`,
    );
    return parseInt(rows[0].count, 10);
  }
}
