import { MigrationInterface, QueryRunner } from 'typeorm';

// ARCH-1 Phase 3 — transactional outbox.
//
// payment.* events are emitted in-process today; if the process dies between
// the state-transition COMMIT and the emit, the event is lost (the dispatch
// listener never fires). This table makes the event DURABLE and ATOMIC with
// the state transition: StateMachineService writes the outbox row in the SAME
// transaction as the tx_state_transitions row. An in-process relay drains it
// to the existing event bus (behaviour identical) and a periodic sweep
// re-delivers anything left PENDING by a crash — dedup keeps re-delivery safe.
//
// DESIGNED-FOR, NOT BUILT: this is consumed in-process. To scale out later,
// run the SAME image with a flag that starts ONLY the relay sweep as a
// separate process against the SAME database — an ops change, not a rewrite.
// (See CLAUDE.md §10h / ARCHITECTURE_REFACTOR.md.)
//
// Append-only event body: strait_app gets SELECT,INSERT plus a
// COLUMN-SCOPED UPDATE on (status, dispatched_at) only — the relay can flip
// delivery state but can never rewrite an event payload. When the relay is
// extracted, a dedicated worker role takes that UPDATE and strait_app
// keeps SELECT,INSERT only.
export class OutboxEvents1715000000009 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE outbox_status AS ENUM ('PENDING', 'DISPATCHED')
    `);
    await queryRunner.query(`
      CREATE TABLE outbox_events (
        id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        event_name    VARCHAR(64)   NOT NULL,
        aggregate_id  UUID          NOT NULL,
        payload       JSONB         NOT NULL,
        status        outbox_status NOT NULL DEFAULT 'PENDING',
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        dispatched_at TIMESTAMPTZ
      )
    `);
    // The sweep selects oldest-first PENDING rows.
    await queryRunner.query(`
      CREATE INDEX idx_outbox_pending
        ON outbox_events(created_at)
        WHERE status = 'PENDING'
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT ON outbox_events TO strait_app
    `);
    await queryRunner.query(`
      GRANT UPDATE (status, dispatched_at) ON outbox_events TO strait_app
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`REVOKE ALL ON outbox_events FROM strait_app`);
    await queryRunner.query(`DROP TABLE IF EXISTS outbox_events`);
    await queryRunner.query(`DROP TYPE IF EXISTS outbox_status`);
  }
}
