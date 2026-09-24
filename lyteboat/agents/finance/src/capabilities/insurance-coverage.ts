/**
 * Basic cover before investment: one line that says which of the three basic
 * covers the customer holds, lacks, or has not told us about.
 * @module @lyteboat/agent-finance/capabilities/insurance-coverage
 */

import { INSURANCE_KINDS, INSURANCE_LABEL, type CoverageStatus, type FinanceCustomer } from '../data/finance-customer.ts'

/** `医疗险已配置；重疾险、意外险暂未配置` */
export function coverageLine(coverage: FinanceCustomer['coverage']): string {
  const kindsWith = (status: CoverageStatus): string => INSURANCE_KINDS.filter(kind => coverage[kind] === status).map(kind => INSURANCE_LABEL[kind]).join('、')
  const parts = [
    kindsWith('covered') === '' ? undefined : `${kindsWith('covered')}已配置`,
    kindsWith('gap') === '' ? undefined : `${kindsWith('gap')}暂未配置`,
    kindsWith('unknown') === '' ? undefined : `${kindsWith('unknown')}情况未知`,
  ].filter((part): part is string => part !== undefined)
  return parts.join('；')
}

/** Whether any basic cover is missing: the diagnosis then suggests cover before growth. */
export function hasCoverageGap(coverage: FinanceCustomer['coverage']): boolean {
  return INSURANCE_KINDS.some(kind => coverage[kind] === 'gap')
}
