/** Public fixture values only. No network, key loading, signing or broadcasting. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { encodeSvmTerms, type SvmTermsWire } from '../../../../packages/core/src/lib/agentic/codec/svm-terms';
import { encodeEnvelope } from '../../../../packages/core/src/lib/agentic/codec/session';
import { encodeAgwSvmPayload } from '../../../../packages/core/src/lib/agentic/execution/svm-payload';
const key = (b: string) => `0x${b.repeat(32)}` as Hex;
const cea = key('11'), ata = key('44'), program = key('33');
const terms: SvmTermsWire = {
  validUntil: 2_000_000_000, expectedCEA: cea, gatewayProgram: key('22'),
  assets: [{ token: '0x0000000000000000000000000000000000007070', maxPerCall: BigInt(2) ** BigInt(256) - BigInt(1), maxTotal: BigInt(2) ** BigInt(256) - BigInt(1) }], maxGasPerCall: BigInt(10) ** BigInt(16),
  ceaAccounts: [cea, ata], programs: [{ program, discriminator: '0x0100000000000000', discriminatorLen: 1, dataless: false, maxAccounts: 0 }],
  pins: [{ ruleIndex: 0, accountIndex: 0, expected: cea }, { ruleIndex: 0, accountIndex: 1, expected: ata }],
  dataPins: [{ ruleIndex: 0, fromEnd: true, offset: 4, offsetB: 2, len: 2, mode: 3, expected: key('00'), num: BigInt(9), den: BigInt(10) }],
};
const accounts = [{ pubkey: cea, isWritable: true }, { pubkey: ata, isWritable: true }];
const payload = (a: typeof accounts, out = 90) => encodeAgwSvmPayload(program, a, new Uint8Array([1, out, 0, 100, 0]));
const valid = payload(accounts), wrongId = Buffer.from(valid.slice(2), 'hex'); wrongId[wrongId.length - 33] = 1;
const dataless = { ...terms, programs: [{ ...terms.programs[0], discriminatorLen: 0, dataless: true }], dataPins: [] };
writeFileSync(join(__dirname, 'sdk-vectors.json'), JSON.stringify({
  source: 'e8db74815cfbbf5389593805e464fe8d85f7f735',
  note: 'Deterministic owner-committed Solana keys; no live PDA/cluster or transport claim.',
  initData: encodeEnvelope('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', encodeSvmTerms(terms, 0)),
  datalessInitData: encodeEnvelope('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', encodeSvmTerms(dataless, 0)),
  valid, badRatio: payload(accounts, 89), badPin: payload([{ ...accounts[0], pubkey: key('77') }, accounts[1]]),
  alias: payload([...accounts, accounts[0]]), trailing: `${valid}00`, wrongId: `0x${wrongId.toString('hex')}`,
  datalessPayload: encodeAgwSvmPayload(program, accounts, new Uint8Array()),
}, null, 2) + '\n');
