import { SCHEMA_VERSION, SEED_TIME, type Account, type Category, type Ledger } from './types'

interface SeedCategory {
  id: string
  name: string
  kind: Category['kind']
}

const EXPENSE: SeedCategory[] = [
  { id: 'cat_food', name: '食費', kind: 'expense' },
  { id: 'cat_daily', name: '日用品', kind: 'expense' },
  { id: 'cat_transport', name: '交通費', kind: 'expense' },
  { id: 'cat_housing', name: '住居', kind: 'expense' },
  { id: 'cat_utilities', name: '水道・光熱費', kind: 'expense' },
  { id: 'cat_communication', name: '通信費', kind: 'expense' },
  { id: 'cat_leisure', name: '娯楽', kind: 'expense' },
  { id: 'cat_clothes', name: '衣服・美容', kind: 'expense' },
  { id: 'cat_health', name: '医療・健康', kind: 'expense' },
  { id: 'cat_education', name: '教育', kind: 'expense' },
  { id: 'cat_social', name: '交際費', kind: 'expense' },
  { id: 'cat_insurance', name: '保険', kind: 'expense' },
  { id: 'cat_tax', name: '税金', kind: 'expense' },
  { id: 'cat_other_expense', name: 'その他', kind: 'expense' },
]

const INCOME: SeedCategory[] = [
  { id: 'cat_salary', name: '給与', kind: 'income' },
  { id: 'cat_bonus', name: 'ボーナス', kind: 'income' },
  { id: 'cat_business', name: '事業収入', kind: 'income' },
  { id: 'cat_extra', name: '臨時収入', kind: 'income' },
  { id: 'cat_other_income', name: 'その他収入', kind: 'income' },
]

function seedCategory(item: SeedCategory, sortOrder: number): Category {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    parentId: null,
    sortOrder,
    archived: false,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    revision: 1,
    deletedAt: null,
  }
}

function seedAccount(id: string, name: string, kind: Account['kind']): Account {
  return {
    id,
    name,
    kind,
    currency: 'JPY',
    sourceId: null,
    externalAccountId: null,
    archived: false,
    openingBalanceYen: null,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    revision: 1,
    deletedAt: null,
  }
}

export function emptyLedger(): Ledger {
  return {
    schemaVersion: SCHEMA_VERSION,
    seeded: false,
    accounts: [],
    categories: [],
    transactions: [],
    importSources: [],
    categoryRules: [],
    budgets: [],
    assetSnapshots: [],
  }
}

export function seedLedger(): Ledger {
  const categories = [
    ...EXPENSE.map((item, index) => seedCategory(item, index)),
    ...INCOME.map((item, index) => seedCategory(item, index)),
  ]
  return {
    ...emptyLedger(),
    seeded: true,
    categories,
    accounts: [
      seedAccount('acct_cash', '現金', 'cash'),
      seedAccount('acct_bank', '銀行口座', 'bank'),
      seedAccount('acct_card', 'クレジットカード', 'card'),
    ],
  }
}
