import type { CategoryRule } from './types'
import { fold } from './text'

export interface RuleTarget {
  description: string
  sourceId: string
  accountId: string
}

export function ruleMatches(rule: CategoryRule, target: RuleTarget): boolean {
  if (!rule.enabled || rule.deletedAt) return false
  if (rule.sourceId && rule.sourceId !== target.sourceId) return false
  if (rule.accountId && rule.accountId !== target.accountId) return false
  const pattern = rule.pattern.trim()
  if (!pattern) return false
  if (rule.operator === 'contains') {
    return fold(target.description).includes(fold(pattern))
  }
  try {
    return new RegExp(pattern).test(target.description)
  } catch {
    return false
  }
}

/** First matching enabled rule wins. Lower priority runs first. */
export function categoryFromRules(
  rules: readonly CategoryRule[],
  target: RuleTarget,
): string | null {
  const ordered = rules
    .filter((rule) => !rule.deletedAt)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
  for (const rule of ordered) {
    if (ruleMatches(rule, target)) return rule.categoryId
  }
  return null
}
