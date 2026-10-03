import { capabilityUnavailable } from './errors';

/**
 * Internal capability flags for an AGW contract generation. A method whose
 * capability is absent fails before any signature. Each unresolved target
 * feature names the plan assumption (A01–A08, plan/agw/implementation-plan.md)
 * or artifact that must close before it can be advertised.
 */
export enum AgenticCapability {
  /** Factory derive/list/deploy and wallet owner/info reads. */
  WALLET_READS = 'walletReads',
  /** Active (enabled) rule enumeration and native-rule decoding. */
  ACTIVE_RULE_READS = 'activeRuleReads',
  /** Owner door: execute(mode, executionCalldata). */
  OWNER_EXECUTE = 'ownerExecute',
  /** Agent door: executeAsAgent(rulesId, mode, executionCalldata). */
  AGENT_EXECUTE = 'agentExecute',
  /** Native (Push-chain) rule grants with NativeTerms encoding. */
  NATIVE_RULES = 'nativeRules',
  /** Exact-equality native spend assertion used by rules.update. */
  ASSERT_SPENT_NATIVE = 'assertSpentNative',
  /** checkpointCount + Checkpointed events. */
  CHECKPOINTS = 'checkpoints',
  /** Agent-door EVM outbound composition against this generation's single-asset terms. */
  UNIVERSAL_EVM_OUTBOUND = 'universalEvmOutbound',
  /** Target UniversalRule (assets[] / maxGasPerCall) encode/decode. A05/A07. */
  UNIVERSAL_EVM_RULES = 'universalEvmRules',
  /** Per-token expected-spend assertion for universal replacement. A05. */
  ASSERT_SPENT_UNIVERSAL_MULTI = 'assertSpentUniversalMulti',
  /** SVM destination rulebook through the public Rule type. A05/A07, Harsh H4.4. */
  UNIVERSAL_SVM_RULES = 'universalSvmRules',
  /** Grant reference emitted in RulesGranted. A07. */
  GRANT_REF = 'grantRef',
  /** Editable wallet label (setLabel / LabelSet). A07. */
  SET_LABEL = 'setLabel',
  /** Revoked-rule history in rules.list/get. A06. */
  RULE_HISTORY = 'ruleHistory',
  /** Canonical card compiler. A08. */
  COMPILE_CARD = 'compileCard',
}

/** Why each target capability is unavailable when a generation lacks it. */
export const CAPABILITY_DEPENDENCY: Record<AgenticCapability, string> = {
  [AgenticCapability.WALLET_READS]: 'no verified AGW deployment for this network (A07)',
  [AgenticCapability.ACTIVE_RULE_READS]: 'no verified AGW deployment for this network (A07)',
  [AgenticCapability.OWNER_EXECUTE]: 'no verified AGW deployment for this network (A07)',
  [AgenticCapability.AGENT_EXECUTE]: 'no verified AGW deployment for this network (A07)',
  [AgenticCapability.NATIVE_RULES]: 'no verified AGW deployment for this network (A07)',
  [AgenticCapability.ASSERT_SPENT_NATIVE]: 'no verified AGW deployment for this network (A07)',
  [AgenticCapability.CHECKPOINTS]: 'no verified AGW deployment for this network (A07)',
  [AgenticCapability.UNIVERSAL_EVM_OUTBOUND]:
    'the selected generation has no verified multi-asset outbound token resolution (A05/A07)',
  [AgenticCapability.UNIVERSAL_EVM_RULES]:
    'the assets[]/maxGasPerCall wire format has no matching contract artifacts or vectors (A05/A07)',
  [AgenticCapability.ASSERT_SPENT_UNIVERSAL_MULTI]:
    'per-token expected-spend assertion ABI is not delivered (A05)',
  [AgenticCapability.UNIVERSAL_SVM_RULES]:
    'SVM destination rule shape and capability are unconfirmed (A05/A07, H4.4)',
  [AgenticCapability.GRANT_REF]:
    'the selected generation has no grant reference parameter/event (A07)',
  [AgenticCapability.SET_LABEL]:
    'the selected generation has no editable label (A07; labels are deploy-time only)',
  [AgenticCapability.RULE_HISTORY]:
    'revoked-rule history scope and reliable metadata are unresolved (A06)',
  [AgenticCapability.COMPILE_CARD]:
    'canonical card schema, encoding and shared vectors are not agreed (A08)',
};

export function hasCapability(
  capabilities: ReadonlySet<AgenticCapability>,
  capability: AgenticCapability
): boolean {
  return capabilities.has(capability);
}

/** Throws CAPABILITY_UNAVAILABLE (before signing) when the flag is absent. */
export function requireCapability(
  capabilities: ReadonlySet<AgenticCapability> | undefined,
  capability: AgenticCapability
): void {
  if (!capabilities || !capabilities.has(capability)) {
    throw capabilityUnavailable(capability, CAPABILITY_DEPENDENCY[capability]);
  }
}
