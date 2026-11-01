import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';

/** AGW MAX_LABEL_BYTES. Empty resets the default; lengths count UTF-8 bytes. */
export const MAX_LABEL_BYTES = 64;

export function assertLabel(label: string): void {
  if (typeof label !== 'string') {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'label must be a string'
    );
  }
  const length = new TextEncoder().encode(label).length;
  if (length > MAX_LABEL_BYTES) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `label must be at most ${MAX_LABEL_BYTES} UTF-8 bytes (received ${length})`,
      { details: { length, maxLength: MAX_LABEL_BYTES } }
    );
  }
}
