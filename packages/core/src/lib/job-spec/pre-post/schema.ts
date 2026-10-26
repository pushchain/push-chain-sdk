import { READ_FIELDS, TEMPLATE_READ_FIELDS } from '../schema';
export const PRE_POST_READ_FIELDS = [
  ...READ_FIELDS,
  { name: 'at', type: 'uint8' },
] as const;
export const PRE_POST_TEMPLATE_READ_FIELDS = [
  ...TEMPLATE_READ_FIELDS,
  { name: 'at', type: 'uint8' },
] as const;
const sides = [
  { name: 'left', type: 'uint8[]' },
  { name: 'right', type: 'uint8[]' },
  { name: 'evaluation', type: 'uint8' },
  { name: 'operation', type: 'uint8' },
] as const;
export const PRE_POST_LOGIC_FIELDS = [
  { name: 'kind', type: 'uint8' },
  { name: 'check', type: 'uint8' },
  { name: 'children', type: 'uint8[]' },
  { name: 'k', type: 'uint8' },
] as const;
const content = (template: boolean) => [
  {
    name: 'reads',
    type: 'tuple[]',
    components: template ? PRE_POST_TEMPLATE_READ_FIELDS : PRE_POST_READ_FIELDS,
  },
  {
    name: 'checks',
    type: 'tuple[]',
    components: template
      ? [
          ...sides,
          { name: 'source', type: 'uint8' },
          { name: 'value', type: 'int256' },
        ]
      : [...sides, { name: 'target', type: 'int256' }],
  },
  { name: 'logic', type: 'tuple[]', components: PRE_POST_LOGIC_FIELDS },
];
export const PRE_POST_SPEC_PARAM = {
  type: 'tuple',
  components: [
    ...content(false),
    { name: 'allowedMutability', type: 'uint8' },
    { name: 'origin', type: 'bytes32' },
  ],
} as const;
export const PRE_POST_TEMPLATE_PARAM = {
  type: 'tuple',
  components: [
    ...content(true),
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
