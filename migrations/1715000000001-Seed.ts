import { MigrationInterface, QueryRunner } from 'typeorm';

// Strait dev seed: one test member with a deterministic UUID + Bridge identity.
// No reserve-pool seed (Path C is removed). No on-ramp data (Path B is removed).
// The member_accounts row deliberately uses chain_id=8453 (Base) so the default
// dev member matches the cheaper / faster of the two supported USDC chains.
export class Seed1715000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO member_accounts (
        member_id,
        bridge_liquid_address,
        bridge_customer_id,
        usdc_virtual_balance_wei,
        preferred_inbound_path,
        chain_id,
        created_at,
        updated_at
      ) VALUES (
        'a0000000-0000-0000-0000-000000000001',
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        'test-bridge-customer-001',
        0,
        'SELF',
        8453,
        NOW(),
        NOW()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM member_accounts WHERE member_id = 'a0000000-0000-0000-0000-000000000001'`,
    );
  }
}
