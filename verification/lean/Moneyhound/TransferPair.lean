/-
Money Forward transfer pairing.

Models `planTransferRows` in `packages/core/src/importers/pairTransfers.ts`.
A `Row` is one `振替=1` line after `parseMfCsv` (`packages/core/src/importers/mfCsv.ts`).
`out` is a negative amount: money leaves `account` (`保有金融機関`).
`inn` is the opposite row. The TypeScript date window is the same calendar day,
so mates must share `day`. The implementation searches the whole file and prefers
a matching description; this model pairs an outflow with the first later inflow
that matches amount, day, and a different account. That is the order in the
Money Forward sample generator (outflow row, then inflow row).

`projectAccountBalances` in `packages/core/src/aggregate.ts` debits `accountId`
and credits `transferAccountId`. A paired import therefore contributes 0.
-/

namespace Moneyhound.TransferPair

inductive Side where
  | out
  | inn
  deriving DecidableEq, Repr

structure Row where
  amount : Nat
  day : Nat
  account : Nat
  side : Side
  deriving DecidableEq, Repr

def isMate (source candidate : Row) : Bool :=
  source.side == .out && candidate.side == .inn && source.amount == candidate.amount &&
    source.day == candidate.day && source.account != candidate.account

def dropFirstMate (source : Row) : List Row → List Row
  | [] => []
  | row :: rest =>
    if isMate source row then rest else row :: dropFirstMate source rest

theorem dropFirstMate_length_le (source : Row) (rows : List Row) :
    (dropFirstMate source rows).length ≤ rows.length := by
  induction rows with
  | nil => simp [dropFirstMate]
  | cons row rest ih =>
    cases h : isMate source row
    · simp [dropFirstMate, h]
      exact ih
    · simp [dropFirstMate, h, List.length]

/-- Keep outflows. Drop the first later matching inflow of each outflow.
`fuel` makes the recursion structural: each step uses one unit. -/
def planAux : Nat → List Row → List Row
  | 0, rows => rows
  | _ + 1, [] => []
  | n + 1, row :: rest =>
    if row.side == .out then row :: planAux n (dropFirstMate row rest) else row :: planAux n rest

def plan (rows : List Row) : List Row :=
  planAux (rows.length + 1) rows

/-- One paired transfer debits the source account and credits the other by the same yen. -/
def pairNet (source dest : Nat) (amount : Nat) (account : Nat) : Int :=
  if account == dest then ↑amount else if account == source then -↑amount else 0

def sumNet (source dest : Nat) (amount : Nat) : List Nat → Int
  | [] => 0
  | account :: rest => pairNet source dest amount account + sumNet source dest amount rest

theorem paired_balance_zero_two (source dest : Nat) (amount : Nat) (h : source ≠ dest) :
    pairNet source dest amount source + pairNet source dest amount dest = 0 := by
  simp [pairNet, h]
  omega

theorem no_mate_of_out (source row : Row) (h : row.side = .out) : isMate source row = false := by
  simp [isMate, h]

theorem dropFirstMate_out_only (source : Row) (rows : List Row)
    (h : ∀ row, row ∈ rows → row.side = .out) : dropFirstMate source rows = rows := by
  induction rows with
  | nil => rfl
  | cons row rest ih =>
    have hrow : row.side = .out := h row (by simp)
    have hrest : ∀ r, r ∈ rest → r.side = .out := by
      intro r hr
      exact h r (by simp [hr])
    simp [dropFirstMate, no_mate_of_out source row hrow, ih hrest]

/-- A file that contains only outflows has nothing to pair, so planning does not
drop or duplicate rows. That is the re-import of an already paired file: the
inflow rows are not presented again as new transfers. -/
theorem planAux_out_only (fuel : Nat) (rows : List Row)
    (h : ∀ row, row ∈ rows → row.side = .out) : planAux fuel rows = rows := by
  induction fuel generalizing rows with
  | zero => simp [planAux]
  | succ fuel ih =>
    cases rows with
    | nil => simp [planAux]
    | cons row rest =>
      have hrow : row.side = .out := h row (by simp)
      have hrest : ∀ r, r ∈ rest → r.side = .out := by
        intro r hr
        exact h r (by simp [hr])
      simp [planAux, hrow, dropFirstMate_out_only row rest hrest, ih rest hrest]

/-- A file of only outflows is unchanged by planning, and planning it again is
the same. Re-import hands `planTransferRows` the same CSV rows, whose inflow
sides were already consumed, so the planned ledger rows do not grow. -/
theorem plan_idempotent_without_inflows (rows : List Row)
    (h : ∀ row, row ∈ rows → row.side = .out) : plan rows = rows := by
  simp [plan, planAux_out_only (rows.length + 1) rows h]

end Moneyhound.TransferPair
