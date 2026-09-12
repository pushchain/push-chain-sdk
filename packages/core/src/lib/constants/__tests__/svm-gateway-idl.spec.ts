import { PublicKey } from '@solana/web3.js';
import SVM_GATEWAY_IDL from '../abi/universalGatewayV0.json';

describe('SVM gateway IDL', () => {
  it('includes the Anchor event CPI accounts for send_universal_tx', () => {
    // Gateway commit a268b0c added #[event_cpi] to SendUniversalTx. Anchor
    // appends these two named accounts before any remaining PC20 accounts.
    const instruction = SVM_GATEWAY_IDL.instructions.find(
      ({ name }) => name === 'send_universal_tx'
    );

    expect(instruction).toBeDefined();
    const accounts = instruction!.accounts as Array<{
      name: string;
      address?: string;
      pda?: { seeds: Array<{ kind: string; value: number[] }> };
    }>;
    const eventAuthority = accounts.at(-2);
    const program = accounts.at(-1);

    expect(eventAuthority?.name).toBe('event_authority');
    expect(program).toEqual({
      name: 'program',
      address: SVM_GATEWAY_IDL.address,
    });

    const seed = eventAuthority?.pda?.seeds[0];
    expect(seed).toEqual({
      kind: 'const',
      value: Array.from(Buffer.from('__event_authority')),
    });

    const expectedPda = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      new PublicKey(SVM_GATEWAY_IDL.address)
    )[0];
    expect(expectedPda.toBase58()).toBe(
      'Hd8hF5GsJ3a54yxA1HNNNUvB55QCXsXA5mgyL167rJk5'
    );
  });
});
