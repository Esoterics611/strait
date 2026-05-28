// ARCH-1 Phase 3 oracle: the payment.* event is ATOMIC with the state
// transition (one outbox row committed in the same tx as tx_state_transitions)
// and DURABLE — if the process dies between COMMIT and emit, the relay sweep
// re-delivers exactly once. Money-path behaviour is unchanged: the happy
// path still emits the in-memory event on the same bus.
//
// PLACEHOLDER — the original assertions referenced `TxState.BRIDGE_DISPATCHED`
// and the `payment.bridge_dispatched` event name; both are renamed in the
// crypto-only state machine (BRIDGE_DISPATCHED → DISPATCHED). Restore once
// the src/dispatch/ and src/state-machine/ rewrite settles the new event-name
// convention.

describe('INTEGRATION: transactional outbox — atomic emission + crash re-delivery', () => {
  it.todo(
    'happy path: state transition + outbox row commit atomically; event emitted; row retired',
  );
  it.todo(
    'crash recovery: a PENDING row left by a dead process is re-delivered exactly once',
  );
});
