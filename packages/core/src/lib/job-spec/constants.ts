export const JOB_VOCABULARY = Object.freeze({
  EVALUATION: Object.freeze({
    BOOLEAN: 'BOOLEAN',
    COMPARE: 'COMPARE',
    NUMBER: 'NUMBER',
    PERCENTAGE: 'PERCENTAGE',
  } as const),
  OPERATION: Object.freeze({
    EQUAL: 'EQUAL',
    NOT_EQUAL: 'NOT_EQUAL',
    GREATER_THAN: 'GREATER_THAN',
    GREATER_OR_EQUAL: 'GREATER_OR_EQUAL',
    LESS_THAN: 'LESS_THAN',
    LESS_OR_EQUAL: 'LESS_OR_EQUAL',
  } as const),
  LOGIC: Object.freeze({
    ALL: 'ALL',
    ANY: 'ANY',
    AT_LEAST: 'AT_LEAST',
  } as const),
  ALLOWED_MUTABILITY: Object.freeze({
    NONE: 'NONE',
    CLIENT: 'CLIENT',
    PROVIDER: 'PROVIDER',
    BOTH: 'BOTH',
  } as const),
});
export const PRINCIPAL = 'agentic:principal' as const;
export const EVALUATIONS = Object.values(JOB_VOCABULARY.EVALUATION);
export const OPERATIONS = Object.values(JOB_VOCABULARY.OPERATION);
export const LOGIC_KINDS = Object.values(JOB_VOCABULARY.LOGIC);
export const MUTABILITIES = Object.values(JOB_VOCABULARY.ALLOWED_MUTABILITY);
