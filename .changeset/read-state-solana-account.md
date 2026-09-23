---
'@pushchain/core': minor
---

Solana token reads now detect the mint's owning token program through the configured
destination RPC. Remove `tokenProgram` from read options; both SPL Token and Token-2022
remain supported. Missing/invalid mints fail before broadcast. Preparation now needs a
Solana RPC lookup for token reads; an offline public-options conversion cannot resolve them.

Add `idl`, the Solana counterpart of `abi`, for decoding finalized Solana account state
through the existing raw-account query. There is no `accountName`: the subject account is
decoded with the IDL layout whose discriminator matches its data. `functionName` optionally
names the layout (snake_case, camelCase or the IDL's PascalCase) and types `value` at compile
time. With the program id as the subject, `functionName` plus positional `args` derive the PDA
from the seeds the IDL declares (pubkey args accept base58, 0x 32-byte hex or PublicKey;
integers take bigint). Reads never execute an instruction. No node changes are required.
Results keep Anchor native types (BN, PublicKey); a layout mismatch produces `decodeError`.
For resumed reads, pass `resultShape: { kind: 'svmAccount', idl }` because the IDL is not on-chain.
