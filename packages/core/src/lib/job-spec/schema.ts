export const READ_FIELDS = [
  { name: 'chainNamespace', type: 'string' },
  { name: 'chainId', type: 'string' },
  { name: 'minConfirmations', type: 'uint16' },
  { name: 'target', type: 'address' },
  { name: 'selector', type: 'bytes4' },
  { name: 'args', type: 'bytes' },
  { name: 'outputs', type: 'bytes' },
  { name: 'field', type: 'uint8[]' },
] as const;
export const FILL_FIELDS = [
  { name: 'word', type: 'uint8' },
  { name: 'source', type: 'uint8' },
  { name: 'param', type: 'uint8' },
] as const;
export const TEMPLATE_READ_FIELDS = [
  ...READ_FIELDS.slice(0, 6),
  { name: 'fills', type: 'tuple[]', components: FILL_FIELDS },
  ...READ_FIELDS.slice(6),
] as const;
export const CHECK_FIELDS = [
  { name: 'read', type: 'uint8' },
  { name: 'evaluation', type: 'uint8' },
  { name: 'operation', type: 'uint8' },
  { name: 'target', type: 'int256' },
] as const;
export const TEMPLATE_CHECK_FIELDS = [
  ...CHECK_FIELDS.slice(0, 3),
  { name: 'source', type: 'uint8' },
  { name: 'value', type: 'int256' },
] as const;
export const LOGIC_FIELDS = [
  { name: 'kind', type: 'uint8' },
  { name: 'checks', type: 'uint8[]' },
  { name: 'children', type: 'uint8[]' },
  { name: 'k', type: 'uint8' },
] as const;
export const JOB_SPEC_PARAM = {
  type: 'tuple',
  components: [
    { name: 'reads', type: 'tuple[]', components: READ_FIELDS },
    { name: 'checks', type: 'tuple[]', components: CHECK_FIELDS },
    { name: 'logic', type: 'tuple[]', components: LOGIC_FIELDS },
    { name: 'allowedMutability', type: 'uint8' },
    { name: 'origin', type: 'bytes32' },
    { name: 'executeBy', type: 'uint64' },
    { name: 'failFinalAt', type: 'uint64' },
  ],
} as const;
export const JOB_TEMPLATE_PARAM = {
  type: 'tuple',
  components: [
    { name: 'reads', type: 'tuple[]', components: TEMPLATE_READ_FIELDS },
    { name: 'checks', type: 'tuple[]', components: TEMPLATE_CHECK_FIELDS },
    { name: 'logic', type: 'tuple[]', components: LOGIC_FIELDS },
    { name: 'allowedMutability', type: 'uint8' },
    {
      name: 'params',
      type: 'tuple[]',
      components: [
        { name: 'min', type: 'int256' },
        { name: 'max', type: 'int256' },
      ],
    },
  ],
} as const;
