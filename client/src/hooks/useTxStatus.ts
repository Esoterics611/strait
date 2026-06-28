import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { stageFor } from '../lib/state-labels';
import type { ConnectionState, StatusSnapshot } from '../lib/contract';

export interface TxStatusState {
  snapshot: StatusSnapshot | null;
  connection: ConnectionState;
  lastEventAt: number;
}

// Subscribes via the contract API client (mock or live SSE). Surfaces the
// §9 stage projection + connection state. When the stream goes dead it falls
// back to polling the REST transfer every 15s so the UI never goes blank.
export function useTxStatus(
  txId: string | undefined,
  initial?: StatusSnapshot | null,
): TxStatusState {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(
    initial ?? null,
  );
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number>(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!txId) return;
    const unsub = api.subscribeStatus(txId, {
      onFrame: (s) => {
        setSnapshot(s);
        setLastEventAt(Date.now());
      },
      onConn: (c) => setConnection(c),
    });
    return () => {
      unsub();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [txId]);

  // poll fallback while disconnected
  useEffect(() => {
    if (!txId) return;
    if (connection === 'closed' || connection === 'reconnecting') {
      pollRef.current = setInterval(() => {
        api
          .getTransfer(txId)
          .then((t) => {
            setSnapshot((prev) => ({
              state: t.state,
              stage: stageFor(t.state),
              etaText: prev?.etaText ?? null,
              dispatchTxHash: prev?.dispatchTxHash ?? null,
              settledAt: prev?.settledAt ?? null,
              payoutMethodUsed: prev?.payoutMethodUsed ?? null,
              failureReason: prev?.failureReason ?? null,
              refundExpectedBy: prev?.refundExpectedBy ?? null,
            }));
            setLastEventAt(Date.now());
          })
          .catch(() => undefined);
      }, 15_000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
    return;
  }, [connection, txId]);

  return { snapshot, connection, lastEventAt };
}
