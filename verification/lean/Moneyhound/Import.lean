/-
Moneyhound import match-key model.

This file models the part of `applyImport` that decides whether a normalized row
inserts a transaction, updates one, or tombstones one. It does not model account
or category creation (`ensureAccount`, `ensureCategory`, `categoryFromRules`).

TypeScript:
- `dedupe`, `findExisting`, and `applyImport` in
  `packages/core/src/importers/applyImport.ts`
- `Transaction.amountYen`, `Transaction.deletedAt`, and `Transaction.source` in
  `packages/core/src/types.ts`

A key here is the match key those functions already computed:
`id:${externalId}` when `externalId` is present, otherwise `hash:${contentHash}`
after the occurrence suffix inside `dedupe`. The suffix string itself is not modeled.
-/

namespace Moneyhound.Import

abbrev Key := String

/-- Fields of `NormalizedTransaction` that affect identity and inclusion. -/
structure Row where
  key : Key
  amount : Int
  includeRow : Bool
  deriving DecidableEq, Repr

/-- `amountYen` and whether `deletedAt` is set, for one match key. -/
structure Cell where
  amount : Int
  deleted : Bool
  deriving DecidableEq, Repr

/-- Transactions for one import `sourceId`, in ledger order. Models the list
`findExisting` scans in `packages/core/src/importers/applyImport.ts`. -/
abbrev Store := List (Key × Cell)

/-- `findExisting` restricted to the match key. Returns the first match. -/
def findKey : Store → Key → Option Cell
  | [], _ => none
  | (k, cell) :: rest, key => if k = key then some cell else findKey rest key

/-- Replace the first cell for `key`, or append one. Mirrors the in-place update
in the `applyImport` loop, which rewrites the matched transaction and inserts
only when `findExisting` misses. -/
def upsert : Store → Key → Cell → Store
  | [], key, cell => [(key, cell)]
  | (k, cell) :: rest, key, next =>
    if k = key then (key, next) :: rest else (k, cell) :: upsert rest key next

/-- One iteration of the `applyImport` loop. -/
def step (store : Store) (row : Row) : Store :=
  match findKey store row.key with
  | some cell =>
    if row.includeRow then upsert store row.key { amount := row.amount, deleted := false }
    else if cell.deleted then store
    else upsert store row.key { cell with deleted := true }
  | none =>
    if row.includeRow then upsert store row.key { amount := row.amount, deleted := false }
    else store

/-- Same transition as `step`, on the optional cell for a single key. -/
def stepCell (cell : Option Cell) (row : Row) (key : Key) : Option Cell :=
  if row.key = key then
    match cell with
    | some found =>
      if row.includeRow then some { amount := row.amount, deleted := false }
      else if found.deleted then some found
      else some { found with deleted := true }
    | none =>
      if row.includeRow then some { amount := row.amount, deleted := false }
      else none
  else
    cell

def countKey : Store → Key → Nat
  | [], _ => 0
  | (k, _) :: rest, key => (if k = key then 1 else 0) + countKey rest key

/-- `dedupe` in `packages/core/src/importers/applyImport.ts`.
The `Map` keeps the first-seen slot and the last row for that key. -/
def upsertRow : List Row → Row → List Row
  | [], row => [row]
  | current :: rest, row =>
    if current.key = row.key then row :: rest else current :: upsertRow rest row

def dedupeAux : List Row → List Row → List Row
  | [], acc => acc
  | row :: rows, acc => dedupeAux rows (upsertRow acc row)

def dedupe (rows : List Row) : List Row :=
  dedupeAux rows []

def countRow : List Row → Key → Nat
  | [], _ => 0
  | row :: rows, key => (if row.key = key then 1 else 0) + countRow rows key

/-- Left-to-right loop over already deduped rows. -/
def applyRows (store : Store) : List Row → Store
  | [] => store
  | row :: rows => applyRows (step store row) rows

/-- `applyImport` for match keys: `dedupe`, then the loop. -/
def applyImport (store : Store) (rows : List Row) : Store :=
  applyRows store (dedupe rows)

def foldCells (cell : Option Cell) (rows : List Row) (key : Key) : Option Cell :=
  match rows with
  | [] => cell
  | row :: rows => foldCells (stepCell cell row key) rows key

/-- Summary of every row for one key. `untouched` means the key never appeared.
`deleteKeepingAmount` means the key appeared only as `include = false`.
`set` means an included row reset the amount; a later exclusion only tombstones it. -/
inductive Outcome where
  | untouched
  | deleteKeepingAmount
  | set (amount : Int) (deleted : Bool)
  deriving DecidableEq, Repr

def stepOutcome (acc : Outcome) (row : Row) (key : Key) : Outcome :=
  if row.key = key then
    if row.includeRow then .set row.amount false
    else
      match acc with
      | .untouched => .deleteKeepingAmount
      | .deleteKeepingAmount => .deleteKeepingAmount
      | .set amount _ => .set amount true
  else
    acc

def outcomeFrom (acc : Outcome) (rows : List Row) (key : Key) : Outcome :=
  match rows with
  | [] => acc
  | row :: rows => outcomeFrom (stepOutcome acc row key) rows key

def outcomeOf (rows : List Row) (key : Key) : Outcome :=
  outcomeFrom .untouched rows key

def applyOutcome (cell : Option Cell) : Outcome → Option Cell
  | .untouched => cell
  | .deleteKeepingAmount =>
    match cell with
    | none => none
    | some found => some { found with deleted := true }
  | .set amount deleted => some { amount, deleted := deleted }

theorem findKey_upsert_same (store : Store) (key : Key) (cell : Cell) :
    findKey (upsert store key cell) key = some cell := by
  induction store with
  | nil => simp [upsert, findKey]
  | cons head rest ih =>
    match head with
    | (k, _) =>
      by_cases h : k = key
      · simp [upsert, findKey, h, ih]
      · simp [upsert, findKey, h, ih]

theorem findKey_upsert_other (store : Store) (key key' : Key) (cell : Cell) (h : key' ≠ key) :
    findKey (upsert store key cell) key' = findKey store key' := by
  induction store <;> grind [upsert, findKey]

theorem countKey_zero_iff (store : Store) (key : Key) :
    countKey store key = 0 ↔ findKey store key = none := by
  induction store with
  | nil => simp [countKey, findKey]
  | cons head rest ih =>
    match head with
    | (k, _) =>
      by_cases h : k = key
      · simp [countKey, findKey, h]
      · simp [countKey, findKey, h, ih]

theorem countKey_upsert_same (store : Store) (key : Key) (cell : Cell) :
    countKey (upsert store key cell) key =
      if countKey store key = 0 then 1 else countKey store key := by
  induction store with
  | nil => simp [upsert, countKey]
  | cons head rest ih =>
    match head with
    | (k, _) =>
      by_cases h : k = key
      · simp [upsert, countKey, h]
      · simp [upsert, countKey, h, ih]

theorem countKey_upsert_other (store : Store) (key key' : Key) (cell : Cell) (h : key' ≠ key) :
    countKey (upsert store key cell) key' = countKey store key' := by
  induction store <;> grind [upsert, countKey]

theorem findKey_step (store : Store) (row : Row) (key : Key) :
    findKey (step store row) key = stepCell (findKey store key) row key := by
  by_cases hkey : row.key = key
  · grind [step, stepCell, findKey_upsert_same]
  · cases hfind : findKey store row.key with
    | none =>
      cases hinc : row.includeRow
      · simp [step, stepCell, hfind, hinc, hkey]
      · simp [step, stepCell, hfind, hinc, hkey,
          findKey_upsert_other store row.key key { amount := row.amount, deleted := false } (Ne.symm hkey)]
    | some found =>
      cases hinc : row.includeRow
      · cases hdel : found.deleted
        · simp [step, stepCell, hfind, hinc, hdel, hkey,
            findKey_upsert_other store row.key key { found with deleted := true } (Ne.symm hkey)]
        · simp [step, stepCell, hfind, hinc, hdel, hkey]
      · simp [step, stepCell, hfind, hinc, hkey,
          findKey_upsert_other store row.key key { amount := row.amount, deleted := false } (Ne.symm hkey)]

theorem countKey_step_le (store : Store) (row : Row) (key : Key) (h : countKey store key ≤ 1) :
    countKey (step store row) key ≤ 1 := by
  by_cases row.key = key <;>
    grind [step, countKey, countKey_zero_iff, countKey_upsert_same, countKey_upsert_other]

theorem countKey_applyRows_le (store : Store) (rows : List Row) (key : Key)
    (h : countKey store key ≤ 1) : countKey (applyRows store rows) key ≤ 1 := by
  induction rows generalizing store with
  | nil => simpa [applyRows] using h
  | cons row rows ih =>
    exact ih (step store row) (countKey_step_le store row key h)

/-- Re-importing cannot create a second transaction for a key that was unique. -/
theorem countKey_applyImport_le (store : Store) (rows : List Row) (key : Key)
    (h : countKey store key ≤ 1) : countKey (applyImport store rows) key ≤ 1 := by
  simpa [applyImport] using countKey_applyRows_le store (dedupe rows) key h

theorem countRow_upsert_same (rows : List Row) (row : Row) :
    countRow (upsertRow rows row) row.key =
      if countRow rows row.key = 0 then 1 else countRow rows row.key := by
  induction rows with
  | nil => simp [upsertRow, countRow]
  | cons current rest ih =>
    by_cases h : current.key = row.key
    · simp [upsertRow, countRow, h]
    · simp [upsertRow, countRow, h, ih]

theorem countRow_upsert_other (rows : List Row) (row : Row) (key : Key) (h : key ≠ row.key) :
    countRow (upsertRow rows row) key = countRow rows key := by
  induction rows <;> grind [upsertRow, countRow]

theorem countRow_upsert_le (rows : List Row) (row : Row) (key : Key) (h : countRow rows key ≤ 1) :
    countRow (upsertRow rows row) key ≤ 1 := by
  by_cases hk : key = row.key
  · subst hk
    rw [countRow_upsert_same]
    have h01 : countRow rows row.key = 0 ∨ countRow rows row.key = 1 := by omega
    cases h01 with
    | inl hz => simp [hz]
    | inr hone => simp [hone]
  · simpa [countRow_upsert_other rows row key hk] using h

theorem countRow_dedupeAux_le (rows acc : List Row) (key : Key) (h : countRow acc key ≤ 1) :
    countRow (dedupeAux rows acc) key ≤ 1 := by
  induction rows generalizing acc with
  | nil => simpa [dedupeAux] using h
  | cons row rows ih =>
    exact ih (upsertRow acc row) (countRow_upsert_le acc row key h)

/-- After `dedupe`, each match key occurs at most once. -/
theorem dedupe_unique (rows : List Row) (key : Key) : countRow (dedupe rows) key ≤ 1 := by
  simpa [dedupe, countRow] using countRow_dedupeAux_le rows [] key (by simp [countRow])

theorem findKey_applyRows (store : Store) (rows : List Row) (key : Key) :
    findKey (applyRows store rows) key = foldCells (findKey store key) rows key := by
  induction rows generalizing store with
  | nil => simp [applyRows, foldCells]
  | cons row rows ih =>
    simp [applyRows, foldCells, findKey_step, ih]

theorem stepCell_applyOutcome (cell : Option Cell) (acc : Outcome) (row : Row) (key : Key) :
    stepCell (applyOutcome cell acc) row key = applyOutcome cell (stepOutcome acc row key) := by
  by_cases hkey : row.key = key
  · cases hinc : row.includeRow
    · cases acc
      · cases cell with
        | none => simp [stepCell, stepOutcome, applyOutcome, hkey, hinc]
        | some found =>
          cases found with
          | mk amount deleted =>
            cases deleted <;> simp [stepCell, stepOutcome, applyOutcome, hkey, hinc]
      · cases cell with
        | none => simp [stepCell, stepOutcome, applyOutcome, hkey, hinc]
        | some found =>
          cases found with
          | mk amount deleted =>
            cases deleted <;> simp [stepCell, stepOutcome, applyOutcome, hkey, hinc]
      · rename_i amount deleted
        cases deleted <;> cases cell <;> simp [stepCell, stepOutcome, applyOutcome, hkey, hinc]
    · cases acc <;> cases cell <;> simp [stepCell, stepOutcome, applyOutcome, hkey, hinc]
  · simp [stepCell, stepOutcome, hkey]

theorem foldCells_applyOutcome (cell : Option Cell) (rows : List Row) (key : Key) (acc : Outcome) :
    foldCells (applyOutcome cell acc) rows key = applyOutcome cell (outcomeFrom acc rows key) := by
  induction rows generalizing acc with
  | nil => simp [foldCells, outcomeFrom]
  | cons row rows ih =>
    simp [foldCells, outcomeFrom, stepCell_applyOutcome, ih]

theorem foldCells_outcome (cell : Option Cell) (rows : List Row) (key : Key) :
    foldCells cell rows key = applyOutcome cell (outcomeOf rows key) := by
  simpa [outcomeOf, applyOutcome] using foldCells_applyOutcome cell rows key .untouched

theorem applyOutcome_idem (cell : Option Cell) (acc : Outcome) :
    applyOutcome (applyOutcome cell acc) acc = applyOutcome cell acc := by
  cases acc with
  | untouched => rfl
  | deleteKeepingAmount =>
    cases cell with
    | none => rfl
    | some found =>
      cases h : found.deleted
      · simp [applyOutcome, h]
      · simp [applyOutcome, h]
  | set amount deleted => rfl

/-- Importing the same rows twice leaves every match key's amount and tombstone unchanged. -/
theorem applyImport_reimport_same_cell (store : Store) (rows : List Row) (key : Key) :
    findKey (applyImport (applyImport store rows) rows) key =
      findKey (applyImport store rows) key := by
  unfold applyImport
  have hOuter := findKey_applyRows (applyRows store (dedupe rows)) (dedupe rows) key
  have hInner := findKey_applyRows store (dedupe rows) key
  rw [hOuter, hInner, foldCells_outcome, foldCells_outcome, applyOutcome_idem]

theorem countKey_of_find (store : Store) (key : Key) (h : countKey store key ≤ 1) :
    countKey store key = if (findKey store key).isSome = true then 1 else 0 := by
  induction store with
  | nil => simp [countKey, findKey]
  | cons head rest ih =>
    match head with
    | (k, _) =>
      by_cases hk : k = key
      · simp [countKey, findKey, hk] at h ⊢
        have hz : countKey rest key = 0 := by omega
        simp [hz]
      · have hrest : countKey rest key ≤ 1 := by
          simp [countKey, hk] at h
          omega
        simpa [countKey, findKey, hk, ih hrest] using ih hrest

/-- A second import does not change how many transactions share a match key. -/
theorem reimport_countKey (store : Store) (rows : List Row) (key : Key)
    (h : countKey store key ≤ 1) :
    countKey (applyImport (applyImport store rows) rows) key =
      countKey (applyImport store rows) key := by
  have h1 := countKey_applyImport_le store rows key h
  have h2 := countKey_applyImport_le (applyImport store rows) rows key h1
  have hcell := applyImport_reimport_same_cell store rows key
  rw [countKey_of_find _ _ h1, countKey_of_find _ _ h2, hcell]

end Moneyhound.Import
