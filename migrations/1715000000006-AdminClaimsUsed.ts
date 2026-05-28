import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminClaimsUsed1715000000006 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admin_claims_used (
        jti     VARCHAR(128) PRIMARY KEY,
        sub     VARCHAR(128) NOT NULL,
        used_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT ON admin_claims_used TO strait_app
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`REVOKE ALL ON admin_claims_used FROM strait_app`);
    await queryRunner.query(`DROP TABLE IF EXISTS admin_claims_used`);
  }
}
