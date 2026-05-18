import type { ExecuteParams } from './orchestrator.types';

type PayloadData = ExecuteParams['data'];

export function hasExecutablePayloadData(data: PayloadData): boolean {
  return !(
    data === undefined ||
    data === '0x' ||
    (Array.isArray(data) && data.length === 0)
  );
}

export function isEmptyPayloadData(data: PayloadData): boolean {
  return !hasExecutablePayloadData(data);
}
