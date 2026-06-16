import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dataDir, dbPath, homeDir } from '../src/shared/paths.ts';

describe('paths', () => {
  const originalEnv = process.env.COMPASS_DATA_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.COMPASS_DATA_DIR;
    } else {
      process.env.COMPASS_DATA_DIR = originalEnv;
    }
  });

  describe('dataDir', () => {
    it('should return COMPASS_DATA_DIR when set', () => {
      process.env.COMPASS_DATA_DIR = '/custom/path';
      expect(dataDir()).toBe('/custom/path');
    });

    it('should return default ~/.compass when env not set', () => {
      delete process.env.COMPASS_DATA_DIR;
      const result = dataDir();
      expect(result).toContain('.compass');
      expect(result).toBe(`${homeDir()}/.compass`);
    });
  });

  describe('dbPath', () => {
    it('should return path to db.sqlite within dataDir', () => {
      process.env.COMPASS_DATA_DIR = '/test/dir';
      expect(dbPath()).toBe('/test/dir/db.sqlite');
    });

    it('should use default dataDir when env not set', () => {
      delete process.env.COMPASS_DATA_DIR;
      const result = dbPath();
      expect(result).toContain('.compass');
      expect(result).toMatch(/db\.sqlite$/);
    });
  });

  describe('homeDir', () => {
    it('should return a non-empty string', () => {
      const result = homeDir();
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
