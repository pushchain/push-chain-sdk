# Token route validation — 20 October 2026

Read-only RPC queries; no signing, funding or transactions. SDK source: 1ac02f56. Donut chain 42101, block 24453693. Fresh fetches completed for core and gateway repositories. Core main: b2f22241681c6587a1c130e638949856dfcbd33f. Gateway gateway-testnet: b205770f2c65df090eb282fd2f3b4234d30faa1f. Gateway addresses were taken from that branch's script/config/testnet/GatewayConfig.sol.

## Conclusion

The creation failures are confirmed SDK mapping gaps. However, the claim that all affected tokens require gateway enablement was too broad. Several exact preset tokens are already allow-listed by the external gateway. A matching Push PRC20 still needs to be identified; the existing published/SDK USDC PRC20s point to different mock token addresses.

The official address book (https://push.org/docs/chain/setup/smart-contract-address-book/) agrees with the known PRC20 list. Live SOURCE_CHAIN_NAMESPACE and SOURCE_TOKEN_ADDRESS reads confirm exact identities. This is not an exhaustive search of every deployed contract: an unpublished PRC20 may exist. Do not claim proven nonexistence. Ask the core/node/gateway team for the canonical mapping first.

Sepolia DEX WETH fff997 already has a matching PRC20 0x0d0dF7E8807430A81104EA84d926139816eC7586 and gateway support. EigenLayer WETH 7b799 is a different token.

## Gateway observations

isSupportedToken is a token allow-list/rate-limit threshold predicate. A true result alone does not establish end-to-end minting, burning or settlement support. A false result identifies missing support at that gateway, not a proof that destination-held token calls cannot execute.

| Chain | Token | Gateway allow-listed | Block |
|---|---|---|---|
| eip155:11155111 | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | True | 11955784 |
| eip155:11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | True | 11955784 |
| eip155:11155111 | `0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5` | False | 11955784 |
| eip155:11155111 | `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` | False | 11955784 |
| eip155:84532 | `0x4200000000000000000000000000000000000006` | True | 48368455 |
| eip155:84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | True | 48368455 |
| eip155:84532 | `0x810D46F9a9027E28F9B01F75E2bdde839dA61115` | False | 48368455 |
| eip155:84532 | `0x4616975f7E6045FD9737e95bC527e9e14c727BD2` | False | 48368455 |
| eip155:84532 | `0x663A6F02d547dFd639BF689FED298712f2FB69Fb` | False | 48368455 |
| eip155:421614 | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` | True | 321080510 |
| eip155:421614 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | True | 321080510 |
| eip155:97 | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` | False | 137899664 |
| eip155:97 | `0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c` | False | 137899664 |
| eip155:97 | `0x16227D60f7a0e586C66B005219dfc887D13C9531` | False | 137899664 |

## Actions

- Core/node team: provide exact source-token → PRC20 mappings for the already allow-listed Circle USDC and wrapped-native tokens. If matching PRC20s exist, the SDK registry addition is ours; otherwise the route needs provisioning.
- Gateway/core team: review support for Aave LINK, EigenLayer WETH, Moonwell mocks and Venus/BNB preset assets before claiming they can move through Push.
- SDK: add only verified mappings, then test grant preparation and bounded end-to-end delivery. Never map a protocol token to a different same-symbol mock asset.

Raw results, including all known PRC20 source metadata and preset readiness, are in probe.json. Scripts run from the SDK root with a current build. No production code changed during this validation.
