/**
 * The facts a diagnosis would like the user to add, asked one at a time and
 * never twice in a session: how long the money can stay invested moves the
 * growth cap more than anything else the profile holds.
 * @module @lyteboat/agent-finance/capabilities/follow-up-questions
 */

import type { InvestmentHorizon } from './allocation-targets.ts'

export type FollowUpField = 'investmentHorizon'

export interface FollowUpQuestion {
  field: FollowUpField
  /** The question as the model should ask it, verbatim. */
  question: string
}

const QUESTIONS: Readonly<Record<FollowUpField, string>> = {
  investmentHorizon: '这些钱里用于投资的部分，大概多久用不到？比如 1 年以内、1-3 年、3-5 年，还是 5 年以上？',
}

/**
 * The next question to ask, if any.
 * @param horizon - the horizon the session already knows.
 * @param asked - fields already asked in this session.
 */
export function nextFollowUp(horizon: InvestmentHorizon | undefined, asked: readonly string[]): FollowUpQuestion | undefined {
  if (horizon === undefined && !asked.includes('investmentHorizon')) return { field: 'investmentHorizon', question: QUESTIONS.investmentHorizon }
  return undefined
}
