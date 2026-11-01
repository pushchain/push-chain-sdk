# AGW Address Book - PC Donut

## Contracts we deploy

| Contract | Address | Size | Verified |
| --- | --- | --- | --- |
| **`factoryProxy`** — **use this one** | [`0xF1A131571f89fD06890576e6cD0154114ACBBc8b`](https://donut.push.network/address/0xF1A131571f89fD06890576e6cD0154114ACBBc8b) | — | ✅ |
| `factoryLogic` (AGWFactory) | [`0x4b1dC2bcF9de73d60e7c38E864730866439A368F`](https://donut.push.network/address/0x4b1dC2bcF9de73d60e7c38E864730866439A368F) | 8,300 | ✅ |
| `walletImplementation` (PushAgentWallet) | [`0x959ED7f6943bdd56B3a359BAE0115fef4aa07e17`](https://donut.push.network/address/0x959ED7f6943bdd56B3a359BAE0115fef4aa07e17) | 10,515 | ✅ |
| `ucep` (UCEP) | [`0x79F07D379BdC26468E48025a61bC955909522c1D`](https://donut.push.network/address/0x79F07D379BdC26468E48025a61bC955909522c1D) | 6,833 | ✅ |
| `sessionValidator` (PushSessionValidator) | [`0x5A59a5Ac94d5190553821307F98e4673BF3c4a1D`](https://donut.push.network/address/0x5A59a5Ac94d5190553821307F98e4673BF3c4a1D) | 1,720 | ✅ |
| `sessionEngine` (SmartSession, fork `7dc20e4`) | [`0x7540f9a59693d51CFB4A3727141eAE4836F96749`](https://donut.push.network/address/0x7540f9a59693d51CFB4A3727141eAE4836F96749) | 22,581 | ✅ |

## External dependencies — not deployed by this repo

| Dependency | Address | Used by | Verified |
| --- | --- | --- | --- |
| `universalGateway` | [`0x00000000000000000000000000000000000000C1`](https://donut.push.network/address/0x00000000000000000000000000000000000000C1) | UCEP, wallet | ✅ |
| `universalExecutorModule` | [`0x14191Ea54B4c176fCf86f51b0FAc7CB1E71Df7d7`](https://donut.push.network/address/0x14191Ea54B4c176fCf86f51b0FAc7CB1E71Df7d7) | UCEP | ⚠️ no code |
| `ed25519Precompile` | `0xEC00000000000000000000000000000000000001` | validator | ✅ |

## Admin

| Deployer | `0xa89523351BE1e2De64937AA9AF61Ae06eAd199C7` |
| --- | --- |
| Factory default admin | `0xa89523351BE1e2De64937AA9AF61Ae06eAd199C7` (deployer) |
| Admin transfer delay | 172,800 s (2 days) |
| Paused | no |

##