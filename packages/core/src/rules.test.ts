import { describe, expect, it } from 'bun:test'
import { addCategoryRule, seedLedger } from './ledger'
import { categoryFromRules } from './rules'
import type { CategoryRule } from './types'

function rule(
  patch: Partial<CategoryRule> & Pick<CategoryRule, 'id' | 'pattern' | 'categoryId'>,
): CategoryRule {
  return {
    enabled: true,
    priority: 0,
    operator: 'contains',
    sourceId: null,
    accountId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
    deletedAt: null,
    ...patch,
  }
}

describe('category rules', () => {
  it('matches contains before a later rule and can filter by source or account', () => {
    const rules = [
      rule({
        id: 'late',
        pattern: 'スタバ',
        categoryId: 'cat_food',
        priority: 2,
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
      rule({ id: 'early', pattern: 'スターバックス', categoryId: 'cat_leisure', priority: 1 }),
      rule({
        id: 'bank-only',
        pattern: '振込',
        categoryId: 'cat_salary',
        priority: 0,
        accountId: 'acct_bank',
      }),
      rule({
        id: 'mf-only',
        pattern: '電車',
        categoryId: 'cat_transport',
        priority: 0,
        sourceId: 'mf-csv',
      }),
    ]
    expect(
      categoryFromRules(rules, {
        description: 'スターバックス コーヒー',
        sourceId: 'mf-csv',
        accountId: 'acct_card',
      }),
    ).toBe('cat_leisure')
    expect(
      categoryFromRules(rules, { description: '振込', sourceId: 'manual', accountId: 'acct_cash' }),
    ).toBeNull()
    expect(
      categoryFromRules(rules, { description: '電車', sourceId: 'manual', accountId: 'acct_cash' }),
    ).toBeNull()
    expect(
      categoryFromRules(rules, { description: '電車', sourceId: 'mf-csv', accountId: 'acct_cash' }),
    ).toBe('cat_transport')
  })

  it('supports regex and ignores a broken pattern', () => {
    const rules = [
      rule({ id: 'bad', pattern: '(', categoryId: 'cat_food', operator: 'regex', priority: 0 }),
      rule({
        id: 'ok',
        pattern: '^JR',
        categoryId: 'cat_transport',
        operator: 'regex',
        priority: 1,
      }),
    ]
    expect(
      categoryFromRules(rules, {
        description: 'JR東日本',
        sourceId: 'mf-csv',
        accountId: 'acct_card',
      }),
    ).toBe('cat_transport')
  })

  it('rejects an empty pattern when adding a rule', () => {
    expect(() =>
      addCategoryRule(
        seedLedger(),
        { pattern: '   ', categoryId: 'cat_food' },
        {
          now: '2026-01-01T00:00:00.000Z',
          id: () => 'rule',
        },
      ),
    ).toThrow(/invalid_pattern/)
  })
})
