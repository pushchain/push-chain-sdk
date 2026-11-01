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
const options = {};
function rules(): AgentCardRules {
  return [
    {
      chain: 'eip155:11155111',
      assets: [
        { token: { prc20: token }, maxPerCall: PRINCIPAL, maxTotal: PRINCIPAL },
      ],

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
    },
  ];
}
it('encodes 2.1 ordered chain rules, accepts pinned approvals and fills published markers', () => {
  const r = rules();
  validateAgentCardRules(r);
  const bytes = encodeAgentCardRules(r, options);
  const w = decodeAbiParameters([CARD_RULES_PARAM], bytes)[0];
  expect(w[0].terms.assets[0].maxTotal).toBe(BigInt(MARKER_PRINCIPAL));
  expect(w[0].terms.allowedCalls[0].pins[1].value).toBe(MARKER_PRINCIPAL);
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
      [
        {
          chainNamespace: w[0].chainNamespace,
          terms: {
            ...w[0].terms,
            allowedCalls: [
              {
                ...w[0].terms.allowedCalls[1],
                hasBeneficiary: true,
                beneficiaryOffset: 4,
                pins: [],
              },
            ],
          },
        },
      ],
    ]
  );
  expect(encodeAgentCardRules(decodeAgentCardRules(bytes), options)).toBe(
    bytes
  );
});
it('uses the explicit execution chain for native-token objects shared by several networks', () => {
  const r = rules();
  r[0].assets[0].token = {
    symbol: 'ETH',
    decimals: 18,
    mechanism: 'native',
    address: '0x0000000000000000000000000000000000000000',
  };
  const w = decodeAbiParameters(
    [CARD_RULES_PARAM],
    encodeAgentCardRules(r, options)
  )[0];
  expect(w[0].terms.assets[0].token.toLowerCase()).toBe(
    SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pETH.toLowerCase()
  );
});
it.each(['spender', 'amount', 'recipient', 'increaseAllowance', 'oldArray'])(
  'refuses unsupported approval or transfer authority: %s',
  (which) => {
    const r = rules();
    if (which === 'spender') r[0].allowedCalls[0].pins!.shift();
    if (which === 'amount') r[0].allowedCalls[0].pins!.pop();
    if (which === 'recipient') r[0].allowedCalls[1].pins!.shift();
    if (which === 'increaseAllowance')
      r[0].allowedCalls[0].selector = 'increaseAllowance(address,uint256)';
    if (which === 'oldArray') Object.assign(r[0], { approvals: [] });
    expect(() => encodeAgentCardRules(r, options)).toThrow();
  }
);
it('does not silently drop duplicate alternatives or caps off the principal asset', () => {
  const r = rules();
  r[0].allowedCalls.push(r[0].allowedCalls[0]);
  expect(() => encodeAgentCardRules(r, options)).toThrow(/Duplicate/);
  r[0].allowedCalls.pop();
  r[0].assets.push({ token: { prc20: spender }, maxPerCall: PRINCIPAL });
  expect(() => encodeAgentCardRules(r, options)).toThrow(/principal asset/);
});
it('roundtrips four ordered chains with the only principal on the last chain', () => {
  const legs = [
    'eip155:11155111',
    'eip155:84532',
    'eip155:421614',
    'eip155:97',
  ].map((chain, i) => {
    const leg = rules()[0];
    leg.chain = chain;
    if (i !== 3)
      leg.assets = [
        {
          token: { prc20: token },
          maxPerCall: BigInt(2),
          maxTotal: BigInt(10),
        },
      ];
    return leg;
  });
  const bytes = encodeAgentCardRules(legs);
  expect(decodeAgentCardRules(bytes).map((r) => r.chain)).toEqual(
    legs.map((r) => r.chain)
  );
  expect(encodeAgentCardRules(decodeAgentCardRules(bytes))).toBe(bytes);
  expect(() => encodeAgentCardRules([...legs, legs[0]])).toThrow(/1..4/);
  expect(() =>
    encodeAgentCardRules([legs[3], { ...legs[0], chain: legs[3].chain }])
  ).toThrow(/distinct/);
  expect(() =>
    encodeAgentCardRules([rules()[0], { ...rules()[0], chain: 'eip155:84532' }])
  ).toThrow(/Exactly one/);
  expect(() => encodeAgentCardRules([legs[0]])).toThrow(/Exactly one/);
});
