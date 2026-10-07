import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAbiItem,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem';
import { AGW_ABI } from '../contracts/abi/v5';
import { agentConfig } from './ids';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';

/**
 * The smartsessions `Session` a grant carries (DataTypes.sol:56-86, pinned
 * v5). The wallet overwrites `salt` with its grant nonce, so the value
 * sent is irrelevant; it is always zero here.
 */
export interface SessionWire {
  sessionValidator: Address;
  sessionValidatorInitData: Hex;
  salt: Hex;
  userOpPolicies: readonly { policy: Address; initData: Hex }[];
  erc7739Policies: {
    allowedERC7739Content: readonly {
      appDomainSeparator: Hex;
      contentNames: readonly string[];
    }[];
    erc1271Policies: readonly { policy: Address; initData: Hex }[];
  };
  actions: readonly {
    actionTargetSelector: Hex;
    actionTarget: Address;
    actionPolicies: readonly { policy: Address; initData: Hex }[];
  }[];
  permitERC4337Paymaster: boolean;
}

export const SESSION_PARAM: AbiParameter = getAbiItem({
  abi: AGW_ABI,
  name: 'grantRules',
}).inputs[0] as AbiParameter;

const ZERO_SALT = `0x${'00'.repeat(32)}` as Hex;

export const ENVELOPE_VERSION = 1;

/** V5 URP envelope: abi.encode(uint16(1), string chainNamespace, bytes body). */
export function encodeEnvelope(chainNamespace: string, body: Hex): Hex {
  return encodeAbiParameters(
    [{ type: 'uint16' }, { type: 'string' }, { type: 'bytes' }],
    [ENVELOPE_VERSION, chainNamespace, body]
  );
}

export function decodeEnvelope(initData: Hex): {
  chainNamespace: string;
  body: Hex;
} {
  try {
    const [version, chainNamespace, body] = decodeAbiParameters(
      [{ type: 'uint16' }, { type: 'string' }, { type: 'bytes' }],
      initData
    );
    if (version !== ENVELOPE_VERSION)
      throw new Error(`unsupported rules envelope version ${version}`);
    return { chainNamespace, body };
  } catch (cause) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RULE_READ_FAILED,
      'malformed URP envelope',
      {
        cause,
      }
    );
  }
}

export function buildSession(ctx: {
  validator: Address;
  agent: Address;
  rulesPolicy: Address;
  actions: { target: Address; selector: Hex; initData: Hex }[];
}): SessionWire {
  return {
    sessionValidator: ctx.validator,
    sessionValidatorInitData: agentConfig(ctx.agent),
    salt: ZERO_SALT,
    userOpPolicies: [],
    erc7739Policies: { allowedERC7739Content: [], erc1271Policies: [] },
    actions: ctx.actions.map((a) => ({
      actionTargetSelector: a.selector,
      actionTarget: a.target,
      actionPolicies: [{ policy: ctx.rulesPolicy, initData: a.initData }],
    })),
    permitERC4337Paymaster: false,
  };
}

export function encodeSession(session: SessionWire): Hex {
  return encodeAbiParameters([SESSION_PARAM], [session]);
}

export function decodeSession(bytes: Hex): SessionWire {
  try {
    const [session] = decodeAbiParameters([SESSION_PARAM], bytes);
    return session as unknown as SessionWire;
  } catch (cause) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RULE_READ_FAILED,
      'malformed Session encoding',
      {
        cause,
      }
    );
  }
}
