# AGW presets — documentation follow-up

Updated October 15, 2026. Local draft; nothing sent. No blocking preset product question remains for the implemented scope.

Please synchronize SDK section 7 with the decisions recorded during implementation:

1. Missing preset asset caps default to zero, rather than throwing.
2. DEX get can populate a review screen before tokens are selected. Incomplete pairs have a zero swap-input maximum; call get again with both tokens to generate usable token-pinned rules.
3. The catalog includes STAKING (EigenLayer deposits and mainnet Lido), and mainnet as well as testnet templates. Discovery does not guarantee destination support on the connected Push network.
4. Static tuple fields use paths such as arg: [0,3], replacing the ambiguous Uniswap arg: 3 example. Decoded rules preserve exact ABI word positions with a raw selector.

These decisions are already approved in the user session; this is documentation synchronization, not a request to approve them again. [Current scope and remaining expansion](section7-presets.md).
