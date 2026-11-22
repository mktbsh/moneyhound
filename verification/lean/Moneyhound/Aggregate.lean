/-
Moneyhound month totals and account-balance model.

TypeScript: `summarizeMonth` and `projectAccountBalances` in
`packages/core/src/aggregate.ts`. `inMonth` stands in for
`yearMonthOf(transaction.date) === yearMonth` from `packages/core/src/dates.ts`.
Amounts are `Int`, so the sums are exact. The TypeScript property tests check the
same equalities on the real functions with a `BigInt` oracle, inside the safe
integer range those functions actually use.
-/

namespace Moneyhound.Aggregate

inductive Kind where
  | income
  | expense
  | transfer
  deriving DecidableEq, Repr

/-- One transaction, as `summarizeMonth` reads it. -/
structure AggTxn where
  inMonth : Bool
  amount : Int
  kind : Kind
  deleted : Bool
  category : Option String
  deriving DecidableEq, Repr

/-- Active in-month income. Transfers, tombstones, and other months are excluded. -/
def incomePred (t : AggTxn) : Bool :=
  t.inMonth && !t.deleted && t.kind == .income

def expensePred (t : AggTxn) : Bool :=
  t.inMonth && !t.deleted && t.kind == .expense

def transferPred (t : AggTxn) : Bool :=
  t.inMonth && !t.deleted && t.kind == .transfer

def sumIf : List AggTxn → (AggTxn → Bool) → Int
  | [], _ => 0
  | t :: ts, pred => (if pred t then t.amount else 0) + sumIf ts pred

/-- `MonthSummary.incomeYen`. -/
def incomeYen (txs : List AggTxn) : Int :=
  sumIf txs incomePred

/-- `MonthSummary.expenseYen`. -/
def expenseYen (txs : List AggTxn) : Int :=
  sumIf txs expensePred

/-- `MonthSummary.transferYen`. -/
def transferYen (txs : List AggTxn) : Int :=
  sumIf txs transferPred

/-- `MonthSummary.balanceYen`: income minus expense. Transfers are not included. -/
def balanceYen (txs : List AggTxn) : Int :=
  incomeYen txs - expenseYen txs

/-- One bucket of `expenseByCategory` / `incomeByCategory`. -/
def expenseOf (txs : List AggTxn) (cat : Option String) : Int :=
  sumIf txs fun t => expensePred t && t.category == cat

def incomeOf (txs : List AggTxn) (cat : Option String) : Int :=
  sumIf txs fun t => incomePred t && t.category == cat

theorem balance_eq_income_minus_expense (txs : List AggTxn) :
    balanceYen txs = incomeYen txs - expenseYen txs :=
  rfl

theorem sumIf_head_skip {t : AggTxn} {ts : List AggTxn} {pred : AggTxn → Bool}
    (h : pred t = false) : sumIf (t :: ts) pred = sumIf ts pred := by
  simp [sumIf, h]

theorem transfer_excluded_from_income (t : AggTxn) (ts : List AggTxn) (h : t.kind = .transfer) :
    incomeYen (t :: ts) = incomeYen ts := by
  have hp : incomePred t = false := by simp [incomePred, h]
  simp [incomeYen, sumIf, hp]

theorem transfer_excluded_from_expense (t : AggTxn) (ts : List AggTxn) (h : t.kind = .transfer) :
    expenseYen (t :: ts) = expenseYen ts := by
  have hp : expensePred t = false := by simp [expensePred, h]
  simp [expenseYen, sumIf, hp]

theorem deleted_excluded_from_income (t : AggTxn) (ts : List AggTxn) (h : t.deleted = true) :
    incomeYen (t :: ts) = incomeYen ts := by
  have hp : incomePred t = false := by simp [incomePred, h]
  simp [incomeYen, sumIf, hp]

theorem deleted_excluded_from_expense (t : AggTxn) (ts : List AggTxn) (h : t.deleted = true) :
    expenseYen (t :: ts) = expenseYen ts := by
  have hp : expensePred t = false := by simp [expensePred, h]
  simp [expenseYen, sumIf, hp]

theorem other_month_excluded_from_income (t : AggTxn) (ts : List AggTxn) (h : t.inMonth = false) :
    incomeYen (t :: ts) = incomeYen ts := by
  have hp : incomePred t = false := by simp [incomePred, h]
  simp [incomeYen, sumIf, hp]

theorem other_month_excluded_from_expense (t : AggTxn) (ts : List AggTxn) (h : t.inMonth = false) :
    expenseYen (t :: ts) = expenseYen ts := by
  have hp : expensePred t = false := by simp [expensePred, h]
  simp [expenseYen, sumIf, hp]

/-- A category bucket plus every other expense equals the month expense.
Sorting in `sortedTotals` does not change this sum. -/
theorem expense_splits_by_category (txs : List AggTxn) (cat : Option String) :
    expenseYen txs = expenseOf txs cat + sumIf txs fun t => expensePred t && t.category != cat := by
  induction txs <;> grind [expenseYen, expenseOf, sumIf]

theorem income_splits_by_category (txs : List AggTxn) (cat : Option String) :
    incomeYen txs = incomeOf txs cat + sumIf txs fun t => incomePred t && t.category != cat := by
  induction txs <;> grind [incomeYen, incomeOf, sumIf]

/-
Account projection. `projectAccountBalances` walks live accounts and, for each
transfer, debits `accountId` when it is set and credits `transferAccountId`
when it is set. The `else if` means a row whose two ids are equal only debits;
`assertLedger` and `addTransaction` reject that shape, and they reject a
transfer with both ids null. A null destination only debits the source. A null
source only credits the destination.
-/

structure BalTxn where
  amount : Int
  kind : Kind
  deleted : Bool
  account : Option Nat
  dest : Option Nat
  deriving DecidableEq, Repr

def nodup : List Nat → Bool
  | [] => true
  | n :: ns => !ns.contains n && nodup ns

/-- Contribution of one transaction to one account. This is the `else if` chain
inside `projectAccountBalances`. -/
def rowNet (t : BalTxn) (a : Nat) : Int :=
  if t.deleted || t.kind != .transfer then 0
  else
    (if t.dest = some a ∧ t.account ≠ some a then t.amount else 0) -
      (if t.account = some a then t.amount else 0)

def accountNet : List BalTxn → Nat → Int
  | [], _ => 0
  | t :: ts, a => rowNet t a + accountNet ts a

/-- Sum of `transferInYen - transferOutYen` over the live account ids, in order. -/
def net : List Nat → List BalTxn → Int
  | [], _ => 0
  | a :: as, txs => accountNet txs a + net as txs

def netOfRow : List Nat → BalTxn → Int
  | [], _ => 0
  | a :: as, t => rowNet t a + netOfRow as t

def outSum : List Nat → BalTxn → Int
  | [], _ => 0
  | a :: as, t => (if t.account = some a then t.amount else 0) + outSum as t

def inSum : List Nat → BalTxn → Int
  | [], _ => 0
  | a :: as, t => (if t.dest = some a ∧ t.account ≠ some a then t.amount else 0) + inSum as t

/-- Global transfer contribution of one transaction. -/
def contrib (ids : List Nat) (t : BalTxn) : Int :=
  if t.deleted || t.kind != .transfer then 0
  else
    let inn :=
      match t.dest with
      | some d => if ids.contains d && t.account ≠ some d then t.amount else 0
      | none => 0
    let out :=
      match t.account with
      | some s => if ids.contains s then t.amount else 0
      | none => 0
    inn - out

def contribSum : List Nat → List BalTxn → Int
  | _, [] => 0
  | ids, t :: ts => contrib ids t + contribSum ids ts

/-- Both ends are distinct live accounts. -/
def paired (ids : List Nat) (t : BalTxn) : Bool :=
  !t.deleted && t.kind == .transfer &&
    match t.account, t.dest with
    | some s, some d => d != s && ids.contains s && ids.contains d
    | _, _ => false

def transferOk (ids : List Nat) (t : BalTxn) : Bool :=
  t.deleted || t.kind != .transfer || paired ids t

def allTransferOk (ids : List Nat) : List BalTxn → Bool
  | [] => true
  | t :: ts => transferOk ids t && allTransferOk ids ts

theorem netOfRow_eq_in_out (ids : List Nat) (t : BalTxn) (hd : t.deleted = false)
    (hk : t.kind = .transfer) : netOfRow ids t = inSum ids t - outSum ids t := by
  induction ids with
  | nil => simp [netOfRow, inSum, outSum]
  | cons a as ih =>
    simp [netOfRow, inSum, outSum, rowNet, hd, hk, ih]
    omega

theorem outSum_indicator (ids : List Nat) (t : BalTxn) (h : nodup ids = true) :
    outSum ids t =
      match t.account with
      | some s => if ids.contains s then t.amount else 0
      | none => 0 := by
  induction ids with
  | nil => cases t.account <;> simp [outSum]
  | cons a as ih =>
    simp only [nodup, Bool.and_eq_true, Bool.not_eq_true'] at h
    have ih' := ih h.2
    cases hacc : t.account with
    | none =>
      simp [outSum, hacc] at ih'
      simp [outSum, hacc, ih']
    | some s =>
      by_cases ha : a = s <;> grind [outSum]

theorem inSum_indicator (ids : List Nat) (t : BalTxn) (h : nodup ids = true) :
    inSum ids t =
      match t.dest with
      | some d => if ids.contains d && t.account ≠ some d then t.amount else 0
      | none => 0 := by
  induction ids with
  | nil => cases t.dest <;> simp [inSum]
  | cons a as ih =>
    simp only [nodup, Bool.and_eq_true, Bool.not_eq_true'] at h
    have ih' := ih h.2
    cases hdest : t.dest with
    | none =>
      simp [inSum, hdest] at ih'
      simp [inSum, hdest, ih']
    | some d =>
      by_cases ha : a = d <;> by_cases hacc : t.account = some d <;>
        grind [inSum]

theorem netOfRow_zero_deleted (ids : List Nat) (t : BalTxn) (hd : t.deleted = true) :
    netOfRow ids t = 0 := by
  induction ids <;> simp [netOfRow, rowNet, hd, *]

theorem netOfRow_zero_kind (ids : List Nat) (t : BalTxn) (hk : t.kind ≠ .transfer) :
    netOfRow ids t = 0 := by
  induction ids <;> simp [netOfRow, rowNet, hk, *]

theorem netOfRow_eq_contrib (ids : List Nat) (t : BalTxn) (h : nodup ids = true) :
    netOfRow ids t = contrib ids t := by
  by_cases hd : t.deleted = true
  · simp [contrib, hd, netOfRow_zero_deleted ids t hd]
  · by_cases hk : t.kind = .transfer
    · have hd' : t.deleted = false := by
        cases hdel : t.deleted
        · rfl
        · exact absurd hdel hd
      rw [netOfRow_eq_in_out ids t hd' hk, outSum_indicator ids t h, inSum_indicator ids t h]
      simp [contrib, hd', hk]
    · simp [contrib, hk, netOfRow_zero_kind ids t hk]

theorem net_split (ids : List Nat) (t : BalTxn) (ts : List BalTxn) :
    net ids (t :: ts) = netOfRow ids t + net ids ts := by
  induction ids <;> grind [net, netOfRow, accountNet]

theorem net_empty (ids : List Nat) : net ids [] = 0 := by
  induction ids <;> simp [net, accountNet, *]

theorem net_eq_contribSum (ids : List Nat) (txs : List BalTxn) (h : nodup ids = true) :
    net ids txs = contribSum ids txs := by
  induction txs with
  | nil => simp [contribSum, net_empty]
  | cons t ts ih => rw [contribSum, net_split, ih, netOfRow_eq_contrib ids t h]

theorem paired_contrib_zero (ids : List Nat) (t : BalTxn) (h : paired ids t = true) :
    contrib ids t = 0 := by
  grind [paired, contrib]

theorem transferOk_contrib (ids : List Nat) (t : BalTxn) (h : transferOk ids t = true) :
    contrib ids t = 0 := by
  grind [transferOk, contrib, paired_contrib_zero]

theorem contribSum_zero (ids : List Nat) (txs : List BalTxn) (h : allTransferOk ids txs = true) :
    contribSum ids txs = 0 := by
  induction txs <;> grind [contribSum, allTransferOk, transferOk_contrib]

/-- Paired transfers do not change the sum of account balances. -/
theorem paired_transfers_neutral (ids : List Nat) (txs : List BalTxn) (hn : nodup ids = true)
    (hp : allTransferOk ids txs = true) : net ids txs = 0 := by
  grind [net_eq_contribSum, contribSum_zero]

/-- A one-sided outflow (null destination, known source) only leaves the source. -/
theorem one_sided_transfer_debits_source (ids : List Nat) (t : BalTxn) (s : Nat)
    (hn : nodup ids = true) (hd : t.deleted = false) (hk : t.kind = .transfer)
    (hdest : t.dest = none) (hsrc : t.account = some s) (hlive : ids.contains s = true) :
    net ids [t] = -t.amount := by
  rw [net_split, net_empty, netOfRow_eq_contrib ids t hn]
  have hmem : s ∈ ids := by simpa using hlive
  simp [contrib, hd, hk, hdest, hsrc, hmem]

/-- A one-sided inflow (null source, known destination) only enters that account. -/
theorem one_sided_transfer_credits_destination (ids : List Nat) (t : BalTxn) (d : Nat)
    (hn : nodup ids = true) (hd : t.deleted = false) (hk : t.kind = .transfer)
    (hsrc : t.account = none) (hdest : t.dest = some d) (hlive : ids.contains d = true) :
    net ids [t] = t.amount := by
  rw [net_split, net_empty, netOfRow_eq_contrib ids t hn]
  have hmem : d ∈ ids := by simpa using hlive
  simp [contrib, hd, hk, hsrc, hdest, hmem]

end Moneyhound.Aggregate
