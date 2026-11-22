---
name: verify-core-invariants
description: Use when changing packages/core money calculations (applyImport, summarizeMonth, projectAccountBalances, mergeLedgers, planSync) or when checking that a core change still matches the proved invariants.
---

# Verify core money invariants

moneyhound's pure calculation core is checked two ways that must stay paired. Lean proves a spec model. fast-check holds the real TypeScript functions to the same property. Lean does not read the TypeScript.

Sync commit: `bad04156cc9307578212ae8bed9ca49dca97bd6c`

That commit is the `packages/core` and `verification/lean` revision `bun run verify:formal` passed against. Do not move it until the command passes again after an intentional behavior change. A failing proof or property test is not a reason to advance this SHA.

## What is checked

Re-import. The same rows must not insert a second transaction for a match key. `dedupe` keeps one row per key and the last row wins. TypeScript: `dedupe`, `findExisting`, and `applyImport` in `packages/core/src/importers/applyImport.ts`. Test: `packages/core/src/invariants/importIdempotence.property.test.ts`. Lean: `verification/lean/Moneyhound/Import.lean` theorems `dedupe_unique`, `countKey_applyImport_le`, `applyImport_reimport_same_cell`, `reimport_countKey`.

Month totals. Income, expense, and balance are the exact integer sums of non-deleted in-month income and expense. Transfers and tombstones stay out of those three numbers. Category buckets add up to the same totals. TypeScript: `summarizeMonth` in `packages/core/src/aggregate.ts`. Test: `packages/core/src/invariants/aggregateMoney.property.test.ts`. Lean: `Aggregate.lean` theorems `balance_eq_income_minus_expense`, `transfer_excluded_from_income`, `transfer_excluded_from_expense`, `deleted_excluded_from_income`, `deleted_excluded_from_expense`, `expense_splits_by_category`, `income_splits_by_category`.

Account balances. A transfer between two distinct live accounts does not change the sum of account balances. A transfer with a null destination only debits the source. A transfer with a null source only credits the destination. TypeScript: `projectAccountBalances` in `packages/core/src/aggregate.ts`, same test file. Lean: `paired_transfers_neutral`, `one_sided_transfer_debits_source`, `one_sided_transfer_credits_destination`.

Imported transfers. Two Money Forward `振替=1` rows with the same absolute amount, the same date, opposite signs, and different `保有金融機関` become one transfer. The negative row is the source and the positive row's institution is `transferAccountId`. The positive row is not inserted again. Re-importing that file does not add a second transfer, and the paired movement does not change the sum of account balances. A lone outflow stays one-sided (`transferAccountId` null, `accountId` set) and debits 保有金融機関. A lone inflow stores `accountId` null and `transferAccountId` set to 保有金融機関, and `projectAccountBalances` credits that account by the amount. Both null is rejected by `assertLedger`. Re-import of those rows inserts nothing. TypeScript: `planTransferRows` in `packages/core/src/importers/pairTransfers.ts` and `applyImport`. Tests: `pairTransfers.test.ts`, `applyImport.test.ts`, and `packages/core/src/invariants/transferPair.property.test.ts`. Lean: `verification/lean/Moneyhound/TransferPair.lean` theorems `paired_balance_zero_two`, `plan_idempotent_without_inflows`, `lone_inflow_credits`, and `lone_outflow_debits`. The Lean model pairs an outflow with the first later inflow. The TypeScript search also accepts an earlier inflow and prefers a matching description.

Sync merge. Every id is kept. Absence is not a delete. When both sides differ from the base, higher `revision` wins, then later `updatedAt`. A winning tombstone stays in the list. Merging a ledger with itself is the identity. Swapping local and remote keeps the same record for each id when both records share that id. TypeScript: `mergeCollection` in `packages/core/src/merge.ts` and `planSync` in `packages/core/src/sync/plan.ts`. Test: `packages/core/src/invariants/mergeSync.property.test.ts`. Lean: `Merge.lean` theorems `mergeOne_no_loss`, `mergeOne_absence_keeps_ours`, `mergeOne_absence_keeps_remote`, `mergeOne_base_survives`, `mergeOne_higher_revision`, `mergeOne_later_updatedAt`, `mergeOne_tombstone_kept`, `mergeOne_idempotent`, `mergeOne_commutative`. `ours` is the local side.

`exchangeLedgers` in `packages/core/src/sync/exchange.ts` only retries the Drive read/write around `planSync`. The retry loop is not in the Lean model.

## How to run

From the repo root, with Bun 1.4.5 and the Lean toolchain in `verification/lean/lean-toolchain` (Lean 4.36.0 via elan):

```bash
bun run verify:formal
```

That runs `bun test packages/core/src/invariants` and then `lake build` in `verification/lean`. fast-check is pinned at 4.11.0. CI job `formal` runs the same two steps. `verify` also runs the property tests because they live under `packages/core/src` and `bun test` picks them up.

## Real bug or modeling error

A property-test failure is about the TypeScript the user runs. Read the fast-check counterexample. If a small input really changes a yen total, drops or duplicates a transaction, or loses a merged id, it is a product bug. Do not edit the assertion to make that input pass.

A Lean failure with green property tests is a modeling error, or a proof that no longer matches an intentional change. The model is not the implementation. It omits account and category creation, category rules, the content-hash suffix string, calendar dates (`inMonth` is a boolean), JSON `canonical()` byte order (Lean uses revision, then `updatedAt`, then payload and the tombstone bit), and the Drive retry loop. Unique ids are assumed; `assertLedger` rejects duplicates, and the model is wrong if a caller bypasses that.

`mergeOne_commutative` assumes the two records have the same id, because `chooseWinner` is only called for one id.

## When behavior changes on purpose

1. Change the TypeScript.
2. Change the Lean definition that names that function, and the theorem if the statement should change.
3. Change the property test so it demands the new behavior.
4. Run `bun run verify:formal`.
5. Only then replace the sync commit above with the new full SHA.

If the command fails, the sync commit stays where it is. A red property test is a failed check, not a reason to weaken the statement.

## Not covered

Category-rule ordering (`categoryFromRules`) is deterministic in tests but not proved. JavaScript `RegExp` is not the same engine Lean would model. `exchangeLedgers` precondition retries are IO. Float totals outside `Number.MAX_SAFE_INTEGER` are outside the property generators; the Lean sums are unbounded `Int`. Self-transfers, and transfers with both account ids null, are rejected by `addTransaction` and `assertLedger`. Schema version is 2. Version 1 is rejected and is not migrated.
