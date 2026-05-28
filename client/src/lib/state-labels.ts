// TxState / StageKey are single-sourced in @strait/contract; re-exported here so
// existing `import type { TxState } from './state-labels'` callers are unchanged.
import type { TxState, StageKey } from '@strait/contract';
export type { TxState, StageKey };

interface Label {
  short: string;
  long: string;
  tone: 'pending' | 'progress' | 'success' | 'failure';
}

export const STATE_LABELS: Record<TxState, Label> = {
  MESH_PENDING: {
    short: 'Funding (Mesh)',
    long: 'Waiting for the USDC transfer to be confirmed on-chain.',
    tone: 'pending',
  },
  USDC_LOCKED: {
    short: 'Funded — ready to send',
    long: 'USDC credited. Preparing to dispatch to your recipient.',
    tone: 'progress',
  },
  DISPATCHED: {
    short: 'Sending to recipient',
    long: 'Dispatching USDC to your recipient.',
    tone: 'progress',
  },
  SETTLED: {
    short: 'Delivered',
    long: 'Your recipient has received the funds.',
    tone: 'success',
  },
  FAILED: {
    short: 'Funding failed',
    long: 'The funding did not complete. No funds were taken.',
    tone: 'failure',
  },
  FAILED_DISPATCH: {
    short: 'Delivery failed',
    long: 'The outbound USDC transfer failed. We are reversing the credit.',
    tone: 'failure',
  },
  REFUND_QUEUED: {
    short: 'Refunding',
    long: 'Your refund is queued for processing.',
    tone: 'progress',
  },
  REFUNDED: {
    short: 'Refunded',
    long: 'Your funds have been returned.',
    tone: 'success',
  },
};

// ---- Section 9: state -> human stage projection (the tracker) ----
// The backend states collapse into sender-facing stages. The UI never
// branches on raw enums; it renders STAGE_LABELS[stage]. Copy is owned here.

export type StageTone =
  | 'pending'
  | 'progress'
  | 'success'
  | 'warn'
  | 'danger'
  | 'neutral';

interface StageLabel {
  en: string;
  he: string;
  tone: StageTone;
}

// The four forward nodes the stepper renders, in order. (FX/conversion node
// dropped — crypto-in / crypto-out means there is no currency conversion.)
export const STAGE_ORDER: readonly StageKey[] = [
  'FUNDING',
  'READYING',
  'DELIVERING',
  'DONE',
] as const;

export const STAGE_LABELS: Record<StageKey, StageLabel> = {
  FUNDING: { en: 'Waiting for your funds', he: 'ממתינים לכספים שלך', tone: 'pending' },
  READYING: { en: 'Preparing delivery', he: 'מכינים את ההעברה', tone: 'progress' },
  DELIVERING: { en: 'Sending to your recipient', he: 'שולחים אל הנמען', tone: 'progress' },
  DONE: { en: 'Delivered', he: 'הועבר בהצלחה', tone: 'success' },
  FAILED: { en: "Didn't go through", he: 'ההעברה לא בוצעה', tone: 'danger' },
  FAILED_DISPATCH: { en: "Couldn't deliver", he: 'לא ניתן היה להעביר', tone: 'danger' },
  REVERSING: { en: 'Returning your money', he: 'מחזירים לך את הכסף', tone: 'warn' },
  REFUNDED: { en: 'Money returned', he: 'הכסף הוחזר', tone: 'neutral' },
};

export function stageFor(state: TxState): StageKey {
  switch (state) {
    case 'MESH_PENDING':
      return 'FUNDING';
    case 'USDC_LOCKED':
      return 'READYING';
    case 'DISPATCHED':
      return 'DELIVERING';
    case 'SETTLED':
      return 'DONE';
    case 'FAILED':
      return 'FAILED';
    case 'FAILED_DISPATCH':
      return 'FAILED_DISPATCH';
    case 'REFUND_QUEUED':
      return 'REVERSING';
    case 'REFUNDED':
      return 'REFUNDED';
  }
}

// Index of a stage within the forward stepper, or -1 for terminal/branch
// stages (failure / reversal) that swap the contextual zone instead.
export function stageStepIndex(stage: StageKey): number {
  return STAGE_ORDER.indexOf(stage);
}

export function isTerminalStage(stage: StageKey): boolean {
  return (
    stage === 'DONE' ||
    stage === 'FAILED' ||
    stage === 'FAILED_DISPATCH' ||
    stage === 'REFUNDED'
  );
}
