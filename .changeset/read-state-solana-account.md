---
'@pushchain/core': minor
---

Solana token reads now detect the mint's owning token program through the configured
destination RPC. Remove `tokenProgram` from read options; both SPL Token and Token-2022
remain supported. Missing/invalid mints fail before broadcast. Preparation now needs a
Solana RPC lookup for token reads; an offline public-options conversion cannot resolve them.

Add `idl` plus `accountName` for decoding finalized Solana account state through the
existing raw-account query. The subject is an account address, not a program instruction.
No node changes are required. Results retain Anchor native types (including BN and
PublicKey); an incorrect discriminator/layout produces `decodeError`. For resumed reads,
pass `resultShape: { kind: 'svmAccount', idl, accountName }` because the IDL is not on-chain.
