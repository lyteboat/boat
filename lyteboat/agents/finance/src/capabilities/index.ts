/**
 * The finance agent's capability layer: pure business rules over the customer
 * data contract, no model and no harness. Tools compose these; tests import them
 * through `@lyteboat/agent-finance/capabilities`.
 * @module @lyteboat/agent-finance/capabilities
 */

export { FixtureCustomerSource } from '../data/finance-customer.ts'
export type { FinanceCustomer, FinanceCustomerSource, FinanceHolding } from '../data/finance-customer.ts'
export { centsOf, moneyForModel, pctText, shareOf, yuanPlain } from './money-text.ts'
export { summarizeHoldings } from './finance-holdings.ts'
export type { FinanceHoldings } from './finance-holdings.ts'
export { TARGET_BAND, VERDICT_TEXT, diagnoseAllocation } from './allocation-diagnosis.ts'
export type { AllocationDiagnosis, AllocationVerdict } from './allocation-diagnosis.ts'
export { loadKnowledge, lookupKnowledge } from './investor-knowledge.ts'
export type { KnowledgeEntry, KnowledgeLookup } from './investor-knowledge.ts'
