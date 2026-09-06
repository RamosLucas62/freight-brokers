import { describe, it, expect } from 'vitest';
import { normalizeDate } from '../../src/normalization/index.js';
describe('calendar validation', () => {
  it.each(['2024-02-30', '2023-02-29', '2024-13-01', '01/02/2024', 'garbage'])('rejects %s', value => expect(normalizeDate(value)).toBeNull());
  it('accepts a leap day', () => expect(normalizeDate('2024-02-29')).toBe('2024-02-29'));
});
