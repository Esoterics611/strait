// The §7 wire contract now lives in the shared single-source package
// @strait/contract (consumed identically by apps/api). This file is a thin
// type-only re-export so existing imports (`from '../lib/contract'`) keep
// working unchanged. Edit the types in packages/contract/src/index.ts.
export type * from '@strait/contract';
