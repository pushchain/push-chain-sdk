# Contract-delegated SDK and product obligations

Source: [AGW design chapter 10 at 0f279ca](https://github.com/pushchain/push-agentic-wallets/blob/0f279ca02242dfd8067ff716d24cad4b97bf29cb/docs/1_AGW.md#10--what-the-product-must-do-that-the-contracts-cannot). These requirements complement the public SDK spec. UI obligations need SDK metadata and examples even when the SDK itself owns no grant screen.

| Source item | Required SDK/product acceptance work |
| --- | --- |
| 1 | Generate beneficiary positions from ABI information; reject layouts the encoder cannot represent safely. |
| 2 | For each supported protocol, test wrong beneficiary and oversized amount rejection. |
| 3 | Derive and display the wallet's destination account and deployment status. |
| 4 | Display expiry as prominently as the caps. |
| 5 | Expose destination idle balance so permission previews include existing exposure. |
| 6 | Render unlimited sentinels as unlimited, not huge numeric values. |
| 7 | Show old consumption before replacement. |
| 8 | Do not silently subtract prior spend from the user's replacement cap. |
| 9 | Explain that revocation cannot recall already-dispatched outbounds. |
| 10 | Document agent-address rotation, regrant and counter-reset consequences. |
| 11 | Expose the agent's separate PC gas balance and funding requirement. |
| 12 | Explain and support migration of balances across every destination when changing wallet generations. |
| 13 | Provide data for monitoring committed CEA versus current derivation; define the operational owner. |
| 14 | Show derived destination accounts during creation. Derivation is deployment-specific. |
| 15 | Show wallet PC funding and per-action ceiling; repeated zero-amount actions can spend the PC budget without consuming token spend. Any action-count estimate must state its assumptions. |
| 16 | Generate caller-requested native pins from ABI. Per Harsh H1 (October 4), approval screening and mandatory spender policy belong to UI/marketplace, not SDK rejection. |
| 17 | Preserve exact asset-reported chain strings; use connected Push chain identity for native rules. |
| 18 | Preview native actions, pins, value/amount/call limits; explain that any successful call consumes call count. |
| 19 | Compile SVM rules from the program interface, preserve interface hash, pin all relevant accounts/data, and reject unrepresentable layouts; revalidate after upgrades. |
| 20 | Restrict aggregator instruction variants and test substituted downstream programs. |
| 21 | Model SVM swap ratio floors, slippage, zero fees and regrant cadence. |
| 22 | Derive SVM CEA/token accounts from wallet and trusted registry gateway; no pasted gateway identity. |
| 23 | Arrange output token accounts before execution; constrain any permitted ATA creation to exact owner/mint/layout. |

Items 19–23 apply when SVM destinations are enabled. They are not automatically deferred merely because the first SDK implementation may focus on EVM. Destination approval safety also needs the public decision described in the revised Harsh draft; native pinning rules alone do not solve universal approval hazards.
