/**
 * The finance agent's capability layer: pure business rules over the customer
 * data contract, no model and no harness. Tools compose these; tests import them
 * through `@lyteboat/agent-finance/capabilities`.
 * @module @lyteboat/agent-finance/capabilities
 */

export { FINANCE_BUCKETS, FINANCE_BUCKET_LABEL, FixtureCustomerSource, INSURANCE_KINDS, INSURANCE_LABEL, RISK_TIERS } from '../data/finance-customer.ts'
export type { CoverageStatus, CustomerProfile, FinanceAccount, FinanceBucket, FinanceCustomer, FinanceCustomerSource, FinanceInstitution, InsuranceKind, RiskTier } from '../data/finance-customer.ts'
export { amountOf, centsOf, centsOfSpoken, moneyForModel, pctText, shareOf, yuanPlain } from './money-text.ts'
export { bucketOfExternalSource, mergeExternalAssets } from './external-assets.ts'
export type { ExternalAsset, ExternalAssetReport } from './external-assets.ts'
export { summarizeHoldings } from './finance-holdings.ts'
export type { BucketHolding, FinanceAuthState, FinanceHoldings, HoldingAccount } from './finance-holdings.ts'
export { DAILY_SHARE_RANGE, GROWTH_CAP_BY_HORIZON, GROWTH_CAP_BY_TIER, INVESTMENT_HORIZONS, TARGET_BAND, allocationTargets, emergencyMonths } from './allocation-targets.ts'
export type { AllocationTarget, InvestmentHorizon } from './allocation-targets.ts'
export { BUCKET_JUDGE_TEXT, diagnoseAllocation } from './allocation-diagnosis.ts'
export type { AllocationDiagnosis, AllocationProblem, BucketDiagnosis, BucketJudge, DiagnosisCardState } from './allocation-diagnosis.ts'
export { nextFollowUp } from './follow-up-questions.ts'
export type { FollowUpField, FollowUpQuestion } from './follow-up-questions.ts'
export { coverageLine, hasCoverageGap } from './insurance-coverage.ts'
export { loadKnowledge, lookupKnowledge } from './investor-knowledge.ts'
export type { KnowledgeEntry, KnowledgeLookup } from './investor-knowledge.ts'
