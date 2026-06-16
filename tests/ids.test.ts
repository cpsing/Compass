import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newId, now } from '../src/shared/ids.ts';

describe('ids', () => {
  describe('newId', () => {
    it('should generate a ULID string', () => {
      const id = newId();
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(26);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(newId());
      }
      expect(ids.size).toBe(100);
    });

    it('should be lexicographically comparable', () => {
      const id1 = newId();
      const id2 = newId();
      expect(typeof (id1 < id2)).toBe('boolean');
    });
  });

  describe('now', () => {
    it('should return current timestamp in milliseconds', () => {
      const before = Date.now();
      const result = now();
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });
});
