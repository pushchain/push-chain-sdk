import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { PRINCIPAL } from '../../job-spec/constants';
import { PUSH_NETWORK } from '../../constants/enums';
import { SYNTHETIC_PUSH_ERC20 } from '../../constants/chain';
import {
  CARD_RULES_PARAM,
  MARKER_PRINCIPAL,
  decodeAgentCardRules,
  encodeAgentCardRules,
  validateAgentCardRules,
  type AgentCardRules,
} from '../rules';
const token = '0x1111111111111111111111111111111111111111';
const spender = '0x2222222222222222222222222222222222222222';
const options = { chain: 'eip155:11155111' };
function rules(): AgentCardRules {
  return {
    assets: [
      { token: { prc20: token }, maxPerCall: PRINCIPAL, maxTotal: PRINCIPAL },
    ],
    principalAsset: 0,
    maxGasPerCall: BigInt(1),
    allowedCalls: [
      {
        target: token,
        selector: 'approve(address,uint256)',
        pins: [
          { arg: 0, expected: spender },
          { arg: 1, max: PRINCIPAL },
        ],
      },
      {
        target: token,
        selector: 'transfer(address,uint256)',
        pins: [
          { arg: 0, expected: 'agentic:wallet' },
          { arg: 1, max: PRINCIPAL },
        ],
      },
    ],
  };
}
it('encodes v2’s four-field rules, accepts pinned approvals and fills published markers', () => {
  const r = rules();
  validateAgentCardRules(r);
  const bytes = encodeAgentCardRules(r, options);
  const w = decodeAbiParameters([CARD_RULES_PARAM], bytes)[0];
  expect(w.assets[0].maxTotal).toBe(BigInt(MARKER_PRINCIPAL));
  expect(w.allowedCalls[0].pins[1].value).toBe(MARKER_PRINCIPAL);
  expect(encodeAgentCardRules(decodeAgentCardRules(bytes), options)).toBe(
    bytes
  );
});
it('retains legacy beneficiary fields during an unchanged decode/encode', () => {
  const w = decodeAbiParameters(
    [CARD_RULES_PARAM],
    encodeAgentCardRules(rules(), options)
  )[0];
  const bytes = encodeAbiParameters(
    [CARD_RULES_PARAM],
    [
      {
        ...w,
        allowedCalls: [
          {
            ...w.allowedCalls[1],
            hasBeneficiary: true,
            beneficiaryOffset: 4,
            pins: [],
          },
        ],
      },
    ]
  );
  expect(encodeAgentCardRules(decodeAgentCardRules(bytes), options)).toBe(
    bytes
  );
});
it('uses the explicit execution chain for native-token objects shared by several networks', () => {
  const r = rules();
  r.assets[0].token = {
    symbol: 'ETH',
    decimals: 18,
    mechanism: 'native',
    address: '0x0000000000000000000000000000000000000000',
  };
  const w = decodeAbiParameters(
    [CARD_RULES_PARAM],
    encodeAgentCardRules(r, options)
  )[0];
  expect(w.assets[0].token.toLowerCase()).toBe(
    SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pETH.toLowerCase()
  );
});
it.each(['spender', 'amount', 'recipient', 'increaseAllowance', 'oldArray'])(
  'refuses unsupported approval or transfer authority: %s',
  (which) => {
    const r = rules();
    if (which === 'spender') r.allowedCalls[0].pins!.shift();
    if (which === 'amount') r.allowedCalls[0].pins!.pop();
    if (which === 'recipient') r.allowedCalls[1].pins!.shift();
    if (which === 'increaseAllowance')
      r.allowedCalls[0].selector = 'increaseAllowance(address,uint256)';
    if (which === 'oldArray') Object.assign(r, { approvals: [] });
    expect(() => encodeAgentCardRules(r, options)).toThrow();
  }
);
it('does not silently drop duplicate alternatives or caps off the principal asset', () => {
  const r = rules();
  r.allowedCalls.push(r.allowedCalls[0]);
  expect(() => encodeAgentCardRules(r, options)).toThrow(/Duplicate/);
  r.allowedCalls.pop();
  r.assets.push({ token: { prc20: spender }, maxPerCall: PRINCIPAL });
  expect(() => encodeAgentCardRules(r, options)).toThrow(/principal asset/);
});
