# AGW source links and refresh procedure

Latest complete Notion export: October 3, 2026 at 13:23 IST. All 12 pages were imported; pages 1 and 5 changed. Page 5 defines the target public SDK API. Native exports omit comment threads.

Focused October 4 recheck: page 5 was downloaded again; its body matches the saved snapshot after normalizing links. [Comparison evidence](research/notion-check-2026-10-04/comparison.json). This was not a full refresh and does not replace the full-import manifest. Harsh’s newer replies are recorded separately in [product decisions](product-decisions-2026-10-04.md).

## Notion inventory

| Document | Source | Local snapshot | Authority |
| --- | --- | --- | --- |
| AGW design overview | [Notion](https://app.notion.com/p/pushprotocol/AGW-UniversalMarketplace-8183-UniversalEvaluator-3e9188aea7f481c8b38ccba332b0afa2) | [Snapshot](notion/overview.md) | Supporting design |
| 1 AGW Contract Changes | [Notion](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d) | [Snapshot](notion/1-agw-contract-changes.md) | WIP contract target |
| 2 Universal Marketplace | [Notion](https://app.notion.com/p/pushprotocol/2-Universal-Marketplace-3e9188aea7f48118b90ac9b267496295) | [Snapshot](notion/2-universal-marketplace.md) | Supporting WIP design |
| 3 ERC-8183 job kernel and hook | [Notion](https://app.notion.com/p/pushprotocol/3-8183-job-kernel-and-hook-3e9188aea7f48188a838c3a740d8c858) | [Snapshot](notion/3-8183-job-kernel-and-hook.md) | Supporting WIP design |
| 4 Universal Evaluation | [Notion](https://app.notion.com/p/pushprotocol/4-Universal-Evaluation-3e9188aea7f4817bb03ef4c78c883f8b) | [Snapshot](notion/4-universal-evaluation.md) | Supporting WIP design |
| 5 SDK AGW | [Notion](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) | [Snapshot](notion/5-sdk-agw.md) | Primary SDK API target |
| 6 SDK Universal Marketplace | [Notion](https://app.notion.com/p/pushprotocol/6-SDK-Universal-Marketplace-3ea188aea7f481e2961ed97129f3a4e6) | [Snapshot](notion/6-sdk-universal-marketplace.md) | Supporting WIP SDK |
| 7 SDK ERC-8183 Job | [Notion](https://app.notion.com/p/pushprotocol/7-SDK-8183-Job-3ea188aea7f481e0a137f5a896723376) | [Snapshot](notion/7-sdk-8183-job.md) | Supporting WIP SDK |
| 8 SDK Universal Evaluation | [Notion](https://app.notion.com/p/pushprotocol/8-SDK-Universal-Evaluation-3ea188aea7f48197a3b3cfdedfa74fee) | [Snapshot](notion/8-sdk-universal-evaluation.md) | Supporting WIP SDK |
| Legacy PUSH AGW SDK Doc v1 | [Notion](https://app.notion.com/p/pushprotocol/PUSH-AGW-SDK-Doc-v1-d2d188aea7f4825cbcea81ef86eca607) | [Snapshot](notion/legacy-agw-sdk-v1.md) | Historical encoding and deployment reference |
| AGW Address Book PC Donut | [Notion](https://app.notion.com/p/pushprotocol/AGW-Address-Book-PC-Donut-3d1188aea7f480ddbb4af6d0efb211e6) | [Snapshot](notion/agw-address-book-donut-2026-09-04.md) | Historical deployment |
| Agentic wallet flow updated | [Notion](https://app.notion.com/p/pushprotocol/agentic_wallet_flow-updated-3d1188aea7f4801f9cb3fbd9318ec536) | [Snapshot](notion/agentic-wallet-flow-2026-09-07.md) | Historical validator-based flow |

The [manifest](source-manifest.json) stores stable page IDs, pull times and hashes. Latest raw ZIPs are under the timestamped notion/exports folder referenced by the manifest. The latest comparison, previous changed-page bodies and diffs are retained under notion/history. Older duplicate pulls were archived locally; paths inside manifest-before.json are historical metadata and may point to pruned archives.

## Contract sources

- [AGW e704d5b](https://github.com/pushchain/push-agentic-wallets/tree/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9), branch pushAgenticWallet_v3. nomenclature-changes was merged and deleted.
- [AGW design](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/docs/1_AGW.md) and [policy design](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/docs/2_UniversalRulesPolicy.md).
- [Core marketplace cb69e0b](https://github.com/pushchain/push-chain-core-contracts/tree/cb69e0ba101bef1bb4440e54b2c45396be3e92ce).
- [Gateway eight-field baseline bcbf7df](https://github.com/pushchain/push-chain-gateway-contracts/tree/bcbf7df42e8e6dd11088a43bcc0b056a54ea0a18).
- [Historical deployed AGW 67929f2](https://github.com/pushchain/push-agentic-wallets/tree/67929f208886187ec7bab5479d4036d45394cfb1).

Source revisions describe inspected code, not a guarantee of current remote head or live deployment. Recheck before sharing questions. See [current baseline](current-baseline.md) and [review summary](review-summary.md).

## Repeatable refresh

1. Export the overview as Markdown and CSV with Include subpages enabled. Export the three historical references individually.
2. Supply all four downloaded ZIPs to the importer. Use --dry-run first to inspect the comparison.
3. Match pages by stable ID; retain raw exports, previous changed snapshots, diffs and manifest history.
4. Review changed requirements and update affected plans/questions; do not declare source features deployed without evidence.
5. Re-fetch contract refs and record exact SHAs before sharing.

```sh
python3 plan/agw/scripts/import-notion-exports.py overview.zip legacy-sdk.zip address-book.zip flow.zip --dry-run
python3 plan/agw/scripts/import-notion-exports.py overview.zip legacy-sdk.zip address-book.zip flow.zip
```

Use actual ZIP paths. The script does not download or authenticate to Notion. It rejects conflicting inputs or locally edited snapshots, requires all registered pages unless --partial is explicitly used, and reports unexpected page IDs. Last-edited observations are not inferred from download time. No scheduled refresh is configured.

The historical SDK refers to AGW-SDK-v1-agent.md, 05-universal-marketplace-startjob.md and SDK_HELPER.md. Their source URLs/files were not included in its export; those original unresolved references remain as written.
