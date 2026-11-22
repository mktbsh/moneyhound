/-
Moneyhound sync-merge model.

TypeScript: `chooseWinner` and `mergeCollection` in `packages/core/src/merge.ts`.
`planSync` in `packages/core/src/sync/plan.ts` uploads the merged ledger; its
pure decision is this merge. `exchangeLedgers` adds Drive reads and `If-Match`
retries, which are IO and are not modeled.

`tie` is a stand-in for `canonical()` in `packages/core/src/canonical.ts`.
The real comparison is lexicographic order of the canonical JSON string.
This model keeps the same decision order: higher `revision`, then later
`updatedAt`, then a deterministic total order, with either record acceptable
when the records are equal. The property tests call the real `canonical`.

Inputs are assumed to have unique ids. `assertLedger` rejects duplicate ids.
Under that assumption the model matches `indexById`. A duplicate id would make
`findEnt` keep the first row, while the TypeScript `Map` keeps the last.
-/

namespace Moneyhound.Merge

structure Ent where
  id : Nat
  revision : Nat
  updatedAt : Nat
  payload : Int
  deleted : Bool
  deriving DecidableEq, Repr

/-- A side changed when its row exists and is not identical to the base row.
Absence is not a change and not a delete. Mirrors the `canonical` comparison
in `mergeCollection`. -/
def changed (base side : Option Ent) : Bool :=
  match side with
  | none => false
  | some s =>
    match base with
    | none => true
    | some b => !(s == b)

/-- `chooseWinner`. Higher revision, then later `updatedAt`, then a total order
on payload and the tombstone bit. That order stands in for `canonical()`; it is
not JSON byte order. `true` means the first argument wins. -/
def prefer (ours remote : Ent) : Bool :=
  if ours.revision.blt remote.revision then false
  else if remote.revision.blt ours.revision then true
  else if ours.updatedAt.blt remote.updatedAt then false
  else if remote.updatedAt.blt ours.updatedAt then true
  else if decide (ours.payload < remote.payload) then false
  else if decide (remote.payload < ours.payload) then true
  else if ours.deleted == false && remote.deleted == true then false
  else true

def choose (ours remote : Ent) : Ent :=
  if prefer ours remote then ours else remote

/-- One id in `mergeCollection`. -/
def mergeOne (base ours remote : Option Ent) : Option Ent :=
  match ours, remote with
  | some l, some r =>
    if l == r then some l
    else if changed base (some l) && changed base (some r) then some (choose l r)
    else if changed base (some l) then some l
    else if changed base (some r) then some r
    else some l
  | some l, none => some l
  | none, some r => some r
  | none, none => base

def findEnt : List Ent → Nat → Option Ent
  | [], _ => none
  | e :: es, i => if e.id = i then some e else findEnt es i

def nodupIds : List Ent → Bool
  | [] => true
  | e :: es => !(es.any fun x => x.id == e.id) && nodupIds es

/-- Merge the ids in `ids`, in that order. `mergeCollection` builds this list
as the first-seen order of ours, then remote, then base. -/
def mergeIds (base ours remote : List Ent) (ids : List Nat) : List Ent :=
  ids.filterMap fun id =>
    mergeOne (findEnt base id) (findEnt ours id) (findEnt remote id)

theorem not_changed_eq {b s : Ent} (h : changed (some b) (some s) = false) : s = b := by
  simp only [changed] at h
  cases hb : s == b
  · simp [hb] at h
  · exact (beq_iff_eq).mp hb

theorem blt_true {a b : Nat} (h : a < b) : a.blt b = true :=
  cast (Nat.blt_eq (x := a) (y := b)).symm h

theorem blt_false {a b : Nat} (h : ¬a < b) : a.blt b = false := by
  cases hblt : a.blt b
  · rfl
  · have heq := Nat.blt_eq (x := a) (y := b)
    simp [hblt] at heq
    exact absurd heq h

theorem prefer_total (l r : Ent) : prefer l r = true ∨ prefer r l = true := by
  by_cases hrev : l.revision < r.revision
  · right
    simp [prefer, blt_true hrev, blt_false (by omega : ¬r.revision < l.revision)]
  · by_cases hrev' : r.revision < l.revision
    · left
      simp [prefer, blt_false hrev, blt_true hrev']
    · have _ : l.revision = r.revision := by omega
      by_cases htime : l.updatedAt < r.updatedAt
      · right
        simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
          blt_false (by omega : ¬r.revision < l.revision), blt_true htime,
          blt_false (by omega : ¬r.updatedAt < l.updatedAt)]
      · by_cases htime' : r.updatedAt < l.updatedAt
        · left
          simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
            blt_false (by omega : ¬r.revision < l.revision), blt_false htime, blt_true htime']
        · have _ : l.updatedAt = r.updatedAt := by omega
          by_cases hpay : l.payload < r.payload
          · right
            simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
              blt_false (by omega : ¬r.revision < l.revision),
              blt_false (by omega : ¬l.updatedAt < r.updatedAt),
              blt_false (by omega : ¬r.updatedAt < l.updatedAt), hpay,
              show ¬r.payload < l.payload by omega]
          · by_cases hpay' : r.payload < l.payload
            · left
              simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
                blt_false (by omega : ¬r.revision < l.revision),
                blt_false (by omega : ¬l.updatedAt < r.updatedAt),
                blt_false (by omega : ¬r.updatedAt < l.updatedAt), hpay, hpay']
            · cases hl : l.deleted <;> cases hr : r.deleted
              · left
                simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
                  blt_false (by omega : ¬r.revision < l.revision),
                  blt_false (by omega : ¬l.updatedAt < r.updatedAt),
                  blt_false (by omega : ¬r.updatedAt < l.updatedAt), hpay,
                  show ¬r.payload < l.payload by omega, hl, hr]
              · right
                simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
                  blt_false (by omega : ¬r.revision < l.revision),
                  blt_false (by omega : ¬l.updatedAt < r.updatedAt),
                  blt_false (by omega : ¬r.updatedAt < l.updatedAt), hpay,
                  show ¬r.payload < l.payload by omega, hl, hr]
              · left
                simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
                  blt_false (by omega : ¬r.revision < l.revision),
                  blt_false (by omega : ¬l.updatedAt < r.updatedAt),
                  blt_false (by omega : ¬r.updatedAt < l.updatedAt), hpay,
                  show ¬r.payload < l.payload by omega, hl, hr]
              · left
                simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
                  blt_false (by omega : ¬r.revision < l.revision),
                  blt_false (by omega : ¬l.updatedAt < r.updatedAt),
                  blt_false (by omega : ¬r.updatedAt < l.updatedAt), hpay,
                  show ¬r.payload < l.payload by omega, hl, hr]

theorem prefer_wins_revision (l r : Ent) (h : r.revision < l.revision) : prefer l r = true := by
  simp [prefer, blt_false (by omega : ¬l.revision < r.revision), blt_true h]

theorem prefer_both_eq (l r : Ent) (hid : l.id = r.id) (hl : prefer l r = true)
    (hr : prefer r l = true) : l = r := by
  have hrev : l.revision = r.revision := by
    by_cases h : l.revision = r.revision
    · exact h
    · have : l.revision < r.revision ∨ r.revision < l.revision := by omega
      cases this with
      | inl hlt =>
        have : prefer l r = false := by
          simp [prefer, blt_true hlt, blt_false (by omega : ¬r.revision < l.revision)]
        simp [this] at hl
      | inr hlt =>
        have : prefer r l = false := by
          simp [prefer, blt_true hlt, blt_false (by omega : ¬l.revision < r.revision)]
        simp [this] at hr
  have htime : l.updatedAt = r.updatedAt := by
    by_cases h : l.updatedAt = r.updatedAt
    · exact h
    · have : l.updatedAt < r.updatedAt ∨ r.updatedAt < l.updatedAt := by omega
      cases this with
      | inl hlt =>
        have : prefer l r = false := by
          simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
            blt_false (by omega : ¬r.revision < l.revision), blt_true hlt,
            blt_false (by omega : ¬r.updatedAt < l.updatedAt)]
        simp [this] at hl
      | inr hlt =>
        have : prefer r l = false := by
          simp [prefer, blt_false (by omega : ¬r.revision < l.revision),
            blt_false (by omega : ¬l.revision < r.revision), blt_true hlt,
            blt_false (by omega : ¬l.updatedAt < r.updatedAt)]
        simp [this] at hr
  have hpay : l.payload = r.payload := by
    by_cases h : l.payload = r.payload
    · exact h
    · have : l.payload < r.payload ∨ r.payload < l.payload := by omega
      cases this with
      | inl hlt =>
        have : prefer l r = false := by
          simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
            blt_false (by omega : ¬r.revision < l.revision),
            blt_false (by omega : ¬l.updatedAt < r.updatedAt),
            blt_false (by omega : ¬r.updatedAt < l.updatedAt), hlt,
            show ¬r.payload < l.payload by omega]
        simp [this] at hl
      | inr hlt =>
        have : prefer r l = false := by
          simp [prefer, blt_false (by omega : ¬r.revision < l.revision),
            blt_false (by omega : ¬l.revision < r.revision),
            blt_false (by omega : ¬r.updatedAt < l.updatedAt),
            blt_false (by omega : ¬l.updatedAt < r.updatedAt), hlt,
            show ¬l.payload < r.payload by omega]
        simp [this] at hr
  have hdel : l.deleted = r.deleted := by
    cases hldel : l.deleted <;> cases hrdel : r.deleted
    · rfl
    · have : prefer l r = false := by
        simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
          blt_false (by omega : ¬r.revision < l.revision),
          blt_false (by omega : ¬l.updatedAt < r.updatedAt),
          blt_false (by omega : ¬r.updatedAt < l.updatedAt),
          show ¬l.payload < r.payload by omega, show ¬r.payload < l.payload by omega, hldel, hrdel]
      simp [this] at hl
    · have : prefer r l = false := by
        simp [prefer, blt_false (by omega : ¬r.revision < l.revision),
          blt_false (by omega : ¬l.revision < r.revision),
          blt_false (by omega : ¬r.updatedAt < l.updatedAt),
          blt_false (by omega : ¬l.updatedAt < r.updatedAt),
          show ¬r.payload < l.payload by omega, show ¬l.payload < r.payload by omega, hldel, hrdel]
      simp [this] at hr
    · rfl
  cases l
  cases r
  simp_all

theorem choose_commutative (l r : Ent) (hid : l.id = r.id) : choose l r = choose r l := by
  have htotal := prefer_total l r
  by_cases hl : prefer l r = true
  · by_cases hr : prefer r l = true
    · simp [choose, hl, hr, prefer_both_eq l r hid hl hr]
    · have hr' : prefer r l = false := by simpa using hr
      simp [choose, hl, hr']
  · have hl' : prefer l r = false := by simpa using hl
    cases htotal with
    | inl h => exact absurd h hl
    | inr hr => simp [choose, hl', hr]

/-- Every id that appears on any side is still present. -/
theorem mergeOne_no_loss (base ours remote : Option Ent)
    (h : base.isSome = true ∨ ours.isSome = true ∨ remote.isSome = true) :
    (mergeOne base ours remote).isSome = true := by
  cases base <;> cases ours <;> cases remote <;> grind [mergeOne]

theorem mergeOne_absence_keeps_ours (b l : Ent) : mergeOne (some b) (some l) none = some l :=
  rfl

theorem mergeOne_absence_keeps_remote (b r : Ent) : mergeOne (some b) none (some r) = some r :=
  rfl

/-- A row that exists only on the base is not deleted by two absences. -/
theorem mergeOne_base_survives (b : Ent) : mergeOne (some b) none none = some b :=
  rfl

theorem mergeOne_higher_revision {b l r : Ent} (hcl : changed (some b) (some l) = true)
    (hcr : changed (some b) (some r) = true) (hrev : l.revision > r.revision) :
    mergeOne (some b) (some l) (some r) = some l := by
  have hneq : (l == r) = false := by
    have : l ≠ r := by
      intro h
      rw [h] at hrev
      omega
    simpa [beq_eq_false_iff_ne] using this
  simp [mergeOne, choose, hneq, hcl, hcr, prefer_wins_revision l r hrev]

theorem mergeOne_later_updatedAt {b l r : Ent} (hcl : changed (some b) (some l) = true)
    (hcr : changed (some b) (some r) = true) (hrev : l.revision = r.revision)
    (htime : l.updatedAt > r.updatedAt) : mergeOne (some b) (some l) (some r) = some l := by
  have hneq : (l == r) = false := by
    have : l ≠ r := by
      intro h
      rw [h] at htime
      omega
    simpa [beq_eq_false_iff_ne] using this
  have hprefer : prefer l r = true := by
    simp [prefer, blt_false (by omega : ¬l.revision < r.revision),
      blt_false (by omega : ¬r.revision < l.revision),
      blt_false (by omega : ¬l.updatedAt < r.updatedAt), blt_true htime]
  simp [mergeOne, choose, hneq, hcl, hcr, hprefer]

/-- A winning tombstone stays in the collection, still marked deleted. -/
theorem mergeOne_tombstone_kept {b l r : Ent} (hcl : changed (some b) (some l) = true)
    (hcr : changed (some b) (some r) = true) (hrev : l.revision > r.revision)
    (hdel : l.deleted = true) :
    ∃ w, mergeOne (some b) (some l) (some r) = some w ∧ w.deleted = true := by
  exact ⟨l, mergeOne_higher_revision hcl hcr hrev, hdel⟩

theorem mergeOne_idempotent (x : Ent) : mergeOne (some x) (some x) (some x) = some x := by
  simp [mergeOne]

theorem mergeOne_commutative (base : Option Ent) (l r : Ent) (hid : l.id = r.id) :
    mergeOne base (some l) (some r) = mergeOne base (some r) (some l) := by
  by_cases heq : l = r
  · simp [mergeOne, heq]
  · have hneq : (l == r) = false := by simpa [beq_eq_false_iff_ne] using heq
    have hneq' : (r == l) = false := by simpa [beq_eq_false_iff_ne] using Ne.symm heq
    cases hcl : changed base (some l) <;> cases hcr : changed base (some r)
    · cases base with
      | none => simp [changed] at hcl
      | some b =>
        exact absurd ((not_changed_eq hcl).trans (not_changed_eq hcr).symm) heq
    · simp [mergeOne, hneq, hneq', hcl, hcr]
    · simp [mergeOne, hneq, hneq', hcl, hcr]
    · simp [mergeOne, hneq, hneq', hcl, hcr, choose_commutative l r hid]

theorem mergeOne_same_find (rows : List Ent) (id : Nat) :
    mergeOne (findEnt rows id) (findEnt rows id) (findEnt rows id) = findEnt rows id := by
  cases h : findEnt rows id
  · simp [mergeOne, h]
  · simp [mergeOne, h]

theorem filterMap_merge_self (rows : List Ent) (ids : List Nat) :
    ids.filterMap (fun id => mergeOne (findEnt rows id) (findEnt rows id) (findEnt rows id)) =
      ids.filterMap (fun id => findEnt rows id) := by
  induction ids with
  | nil => simp
  | cons id ids ih =>
    simp [List.filterMap, mergeOne_same_find, ih]

end Moneyhound.Merge
