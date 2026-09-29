---
'@pushchain/ui-kit': patch
---

Sign Phantom typed data through Phantom.

`PhantomProvider.signTypedData` checked `window.phantom.ethereum` but then built
its viem transport from `window.ethereum`, the legacy EIP-1193 slot any installed
EVM wallet claims. Every other method in the class uses `window.phantom.ethereum`.

Two user-visible failures followed. With Phantom as the only injected EVM
wallet, `window.ethereum` is undefined and the call throws
`Cannot read properties of undefined (reading 'request')`, so the user confirms
in Phantom and the request never reaches it. With a second wallet installed, the
prompt and the account both come from that wallet, and the resulting signature is
attributed to the connected Phantom account while a different key produced it.

The transport now uses `window.phantom.ethereum`, matching the guard directly
above it.
