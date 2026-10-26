import type { AgenticErrorCode } from './errors';

/** UI copy only. Codes, original messages, hints and causes remain diagnostic data. */
const MESSAGES: Record<AgenticErrorCode, string> = {
  DUPLICATE_RULE:
    'Keep one rule per agent and network. Edit the existing rule or remove the duplicate.',
  AGENT_IS_OWNER: 'Choose an agent address different from the wallet owner.',
  AMBIGUOUS_RULE:
    'More than one rule matches this agent and network. Keep one active matching rule before sending.',
  TARGET_NOT_ON_RULE_CHAIN:
    'Choose an app on the network selected for this rule.',
  ASSET_CHAIN_MISMATCH:
    'The selected token belongs to a different network. Choose a token on this rule’s network.',
  TOKEN_ROUTE_UNAVAILABLE:
    'This token cannot currently be transferred from Push to the selected network. Choose a token with a supported Push route.',
  REQUEST_REJECTED:
    'The wallet request was cancelled. Check wallet activity before trying again.',
  NOT_OWNER_OR_AGENT:
    'Connect the wallet owner or an agent authorized by its rules.',
  WALLET_NOT_DEPLOYED: 'This agentic wallet has not been created yet.',
  NOT_AGENTIC_WALLET: 'This address is not a supported agentic wallet.',
  DELETE_NEEDS_TARGET: 'Choose which rules to remove.',
  NO_RULES_FOR_CHAIN: 'This agent has no active rule for the selected network.',
  FROM_NOT_ALLOWED:
    'The agentic wallet is the sender. Remove the custom sender selection.',
  NOT_ALLOWED_IN_AGENTIC_MODE:
    'This action is unavailable while using an agentic wallet.',
  INVALID_RULE:
    'Some rule settings are invalid. Review the rule and try again.',
  CAPABILITY_UNAVAILABLE:
    'This feature is not available for this wallet or network yet.',
  READ_ONLY: 'Connect a signing wallet to continue.',
  NOT_WALLET_OWNER: 'Connect the owner wallet to change these permissions.',
  RULE_NOT_FOUND:
    'This rule could not be found. Refresh the wallet’s rules and try again.',
  RULE_READ_FAILED:
    'The wallet’s current state could not be loaded. Refresh and try again.',
  INCONSISTENT_READ:
    'The wallet changed while it was being checked. Refresh before trying again.',
  INDEX_RACE:
    'The expected wallet address changed. Refresh wallet information before trying again.',
  RECEIPT_MISMATCH:
    'The transaction result needs verification. Check its status before retrying.',
  RECEIPT_UNAVAILABLE:
    'The transaction was submitted, but its status could not be confirmed. Check its status before trying again.',
  AGENT_GAS_INSUFFICIENT:
    'The agent needs more Push coins to pay transaction fees.',
  WALLET_BALANCE_INSUFFICIENT:
    'The agentic wallet does not have enough funds for this action.',
};

/** Tokens-only rules and MOVEABLE ALL (management/rule-inputs). */
const REASON_MESSAGES: Readonly<Record<string, string>> = {
  TOKENS_ONLY_NATIVE:
    'Native ETH and BNB cannot be transferred by a rule. Remove them, or add an app.',
  TOKENS_ONLY_UNSUPPORTED:
    'Tokens alone can only be allowed on EVM networks. Add an app for this network.',
  TRANSFER_RECIPIENT_REQUIRED:
    'Name at least one recipient: the owner has no address on this network.',
  TRANSFER_RECIPIENT_INVALID: 'Enter a valid recipient address.',
  TRANSFER_TO_WITH_CALLS:
    'Recipients apply only to rules without apps. Add the transfer as an allowed function instead.',
  ALL_WITH_LIMITS:
    'All tokens uses each token’s default limits. Remove the limits, or select the tokens individually.',
  ALL_TOO_MANY: 'A rule can include at most eight tokens. Select fewer tokens.',
  ALL_UNAVAILABLE: 'No token can be sent from Push to this network yet.',
};

export function agenticUserMessage(
  code: AgenticErrorCode,
  diagnostic: string,
  details?: Readonly<Record<string, unknown>>
): string {
  if (code === 'CAPABILITY_UNAVAILABLE') {
    if (details?.['capability'] === 'nativeActions')
      return 'A Push rule can allow at most eight functions. Select fewer functions.';
    if (details?.['capability'] === 'presetCalls')
      return 'Choose a preset configuration with 1 to 32 allowed functions.';
    if (
      details?.['capability'] === 'presetChain' ||
      details?.['capability'] === 'presetCatalog'
    )
      return 'This preset is unavailable for the selected network.';
  }
  if (code !== 'INVALID_RULE') return MESSAGES[code];
  if (details?.['reason'] === 'ALLOWED_FUNCTION_REQUIRED')
    return 'Add at least one allowed function, or select tokens on an EVM network to allow transfers back to the owner.';
  const reasonMessage = REASON_MESSAGES[String(details?.['reason'])];
  if (reasonMessage) return reasonMessage;
  if (/validUntil|expiry|expired|future.*timestamp/i.test(diagnostic))
    return 'Choose an expiry date in the future.';
  if (/label.*(64|length|most)/i.test(diagnostic))
    return 'The wallet name is too long. Shorten it and try again.';
  if (/label/i.test(diagnostic)) return 'Enter a valid wallet name.';
  if (/maxGasPerCall.*positive/i.test(diagnostic))
    return 'Set a gas budget greater than zero for this rule.';
  if (/allowedCalls.*(1\.\.32|contain|array)/i.test(diagnostic))
    return 'Select between 1 and 32 allowed functions for this rule.';
  if (/rules.*(eight|8)|eight initial rules/i.test(diagnostic))
    return 'A wallet can be created with at most eight rules. Remove some rules before creating it.';
  if (/assets.*(eight|8)/i.test(diagnostic))
    return 'A rule can include at most eight tokens. Select fewer tokens.';
  if (/duplicate.*pin|pin.*duplicate/i.test(diagnostic))
    return 'The same function input has more than one condition. Keep one condition for each input.';
  if (/pins.*(eight|8)/i.test(diagnostic))
    return 'A function can have at most eight conditions. Choose a simpler function configuration.';
  if (/pins.*32|32.*pins/i.test(diagnostic))
    return 'This rule has too many conditions. Select fewer tokens or allowed functions.';
  if (/selector|function signature/i.test(diagnostic))
    return 'The selected function format is invalid. Select the function again or check its signature.';
  if (/dynamic|static|offset|argument.*range|tuple/i.test(diagnostic))
    return 'This function input cannot be constrained in that format. Choose a supported input or function.';
  if (/uint256|bigint|non-negative/i.test(diagnostic))
    return 'One of the spending limits is invalid. Review the amounts and try again.';
  if (/chainNamespace|unsupported.*chain/i.test(diagnostic))
    return 'Choose a supported network for this rule.';
  if (/address/i.test(diagnostic))
    return 'Enter a valid wallet, token or app address for this rule.';
  return MESSAGES.INVALID_RULE;
}

export function agenticRevertUserMessage(name?: string): string {
  if (!name)
    return 'The transaction could not be completed. Check wallet activity before trying again.';
  if (/TooManyAllowedCallPins/.test(name))
    return 'This rule has more than 32 conditions. Select fewer tokens or allowed functions.';
  if (/TooMany.*Pins|PinRuleOutOfRange/.test(name))
    return 'This function has too many conditions. Choose a simpler rule configuration.';
  if (/TooManyActions|TooManyInitialRules|BatchSizeOutOfRange/.test(name))
    return 'Too many rules or functions are selected. Reduce the selection and try again.';
  if (/LabelTooLong/.test(name))
    return 'The wallet name is too long. Shorten it and try again.';
  if (/DuplicateAction|DuplicateAsset|DuplicateSvmPin/.test(name))
    return 'This rule contains duplicate functions, tokens or conditions. Remove the duplicate selection.';
  if (
    /SpentMismatch|SpentLengthMismatch|AssetSpentMismatch|IndexMismatch|InvalidNonce|IntentGrantNonceMismatch|IntentWalletMismatch/.test(
      name
    )
  )
    return 'The wallet changed while this action was being prepared. Refresh its state before trying again.';
  if (/EnforcedPause/.test(name))
    return 'This operation is temporarily paused. Try again later.';
  if (/OwnerSigExpired|SignatureExpired/.test(name))
    return 'The wallet approval has expired. Review and sign a new request.';
  if (/OutsideTimeWindow/.test(name))
    return 'This request is outside its valid time window. Refresh and approve a new request.';
  if (/InvalidExpiry/.test(name))
    return 'Choose a valid future expiry for this rule.';
  if (/Allowance|Approval/.test(name))
    return 'The token spending approval is missing or too small. Review the token approvals.';
  if (
    /RuleWithoutPin|CeaAccountsMissExpectedCEA|CeaAccountAtUnpinnedIndex/.test(
      name
    )
  )
    return 'The rule is missing a required wallet-recipient restriction. Review its recipient settings.';
  if (/Unsupported|WrongVmForCall|WrongModeForCall/.test(name))
    return 'This action is not supported on the selected network or wallet version.';
  if (
    /InvalidOwnerSignature|InvalidEnableSignature|InvalidSessionKeySignature|SignerNotFound/.test(
      name
    )
  )
    return 'The signature could not be verified. Reconnect the authorized wallet and try again.';
  if (/PCValueExceedsCap|Gas.*Cap/.test(name ?? ''))
    return 'The required gas exceeds this rule’s gas budget. Review the budget before trying again.';
  if (
    /ArgPinAboveMax|AmountExceedsCap|TotalSpendCapExceeded|Value.*Cap|InnerValueExceedsAllowance|MaxCalls|CallLimitReached|TotalNativeAmountExceeded|TotalValueExceeded/.test(
      name ?? ''
    )
  )
    return 'This action exceeds a rule’s spending or usage limit. Reduce the amount or ask the owner to update the rule.';
  if (/Expired|Expiry/.test(name ?? ''))
    return 'This rule has expired. Ask the owner to renew it.';
  if (
    /ArgPinMismatch|Beneficiary|NotAllowed|NotEnabled|Permission|RuleNot|RulesNot|RecipientTargetMismatch|TargetMismatch|SelectorMismatch|SvmAccountPinMismatch|SvmDataPinMismatch/.test(
      name ?? ''
    )
  )
    return 'This action does not match the wallet’s permissions. Check the token, recipient and allowed function.';
  if (/CallerIsNotOwner|UnauthorizedOwner|OwnerLaneRequired/.test(name ?? ''))
    return 'Connect the owner wallet to make this change.';
  if (/CallerIsNotAgent/.test(name ?? ''))
    return 'Connect the agent authorized by this rule.';
  if (/Insufficient|Balance/.test(name ?? ''))
    return 'There are not enough funds for this action. Check the wallet balance and fees.';
  return 'The wallet contract rejected this transaction. Review the permissions and transaction details before trying again.';
}
