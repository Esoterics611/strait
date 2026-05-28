// MONEY-PATH GUARANTEE (CLAUDE.md / MEMBER_APP_DESIGN.md §6.5): with
// RECIPIENT_DISPATCH_ENABLED off (default), the dispatcher pays the SENDER's
// own funding identity (legacy self-loop) byte-for-byte and ignores
// recipient_id. With the flag on but no ready recipient, NO money moves (the
// row holds at USDC_LOCKED). This oracle proves the gate against the real
// Postgres so later structural phases cannot silently change it.
//
// PLACEHOLDER — restore once src/dispatch/ (the new crypto-out dispatcher
// service that replaces src/bridge/) is written. Original test wired
// BridgeService + IBridgeApiClient + RecipientsRepository against a real
// Postgres; the new dispatcher's interface will look similar but is not yet
// committed.

describe('INTEGRATION: RECIPIENT_DISPATCH_ENABLED off => sender-loop unchanged', () => {
  it.todo(
    'flag OFF: dispatch pays the SENDERs own funding identity (legacy self-loop), recipient_id ignored',
  );
  it.todo(
    'flag ON + no recipient: NO money moves; tx holds at USDC_LOCKED',
  );
});
