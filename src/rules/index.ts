import type { IRule } from '../types/rule.types.js';
import { lowConfidenceRule }       from './low-confidence.rule.js';
import { duplicateExactRule }      from './duplicate-exact.rule.js';
import { duplicateProbableRule }   from './duplicate-probable.rule.js';
import { bankingChangeRule }       from './banking-change.rule.js';
import { mcDivergenceRule }        from './mc-divergence.rule.js';
import { authorityInactiveRule }   from './authority-inactive.rule.js';

/**
 * Rules in order of increasing cost (I/O cost).
 * Rules 1-4: pure in-memory, no API calls
 * Rule 5: one getCarrier call per unique MC (may hit cache)
 * Rule 6: reuses cache populated by rule 5
 */
export const ALL_RULES: IRule[] = [
  lowConfidenceRule,       // 1. No I/O
  duplicateExactRule,      // 2. No I/O
  duplicateProbableRule,   // 3. No I/O
  bankingChangeRule,       // 4. No I/O
  mcDivergenceRule,        // 5. getCarrier per unique MC
  authorityInactiveRule,   // 6. getCarrier (cache hit from rule 5)
];

export {
  lowConfidenceRule,
  duplicateExactRule,
  duplicateProbableRule,
  bankingChangeRule,
  mcDivergenceRule,
  authorityInactiveRule,
};
