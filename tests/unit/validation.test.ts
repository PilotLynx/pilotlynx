import { describe, it, expect } from 'vitest';
import { validateProjectName, validateWorkflowName, sanitizeForFilename } from '../../src/lib/validation.js';

describe('validation', () => {
  describe('validateProjectName', () => {
    it('accepts valid names', () => {
      expect(() => validateProjectName('my-project')).not.toThrow();
      expect(() => validateProjectName('project123')).not.toThrow();
      expect(() => validateProjectName('a')).not.toThrow();
      expect(() => validateProjectName('my.project')).not.toThrow();
      expect(() => validateProjectName('my_project')).not.toThrow();
    });

    it('rejects reserved names', () => {
      expect(() => validateProjectName('pilotlynx')).toThrow(/reserved/);
      expect(() => validateProjectName('.')).toThrow(/reserved/);
      expect(() => validateProjectName('..')).toThrow(/reserved/);
      expect(() => validateProjectName('')).toThrow(/reserved/);
    });

    it('rejects path traversal sequences', () => {
      expect(() => validateProjectName('../escape')).toThrow(/Invalid project name/);
      expect(() => validateProjectName('a/b/c')).toThrow(/Invalid project name/);
      expect(() => validateProjectName('a\\b')).toThrow(/Invalid project name/);
    });

    it('rejects names starting with non-alphanumeric', () => {
      expect(() => validateProjectName('-leading-dash')).toThrow(/Invalid project name/);
      expect(() => validateProjectName('.hidden')).toThrow(/Invalid project name/);
      expect(() => validateProjectName('_underscore')).toThrow(/Invalid project name/);
    });

    it('rejects shell metacharacters', () => {
      expect(() => validateProjectName('proj;rm -rf')).toThrow(/Invalid project name/);
      expect(() => validateProjectName('proj$(cmd)')).toThrow(/Invalid project name/);
      expect(() => validateProjectName('proj`cmd`')).toThrow(/Invalid project name/);
      expect(() => validateProjectName('proj name')).toThrow(/Invalid project name/);
    });

    it('rejects names exceeding 128 chars', () => {
      const longName = 'a' + 'b'.repeat(128);
      expect(() => validateProjectName(longName)).toThrow(/Invalid project name/);
    });

    it('accepts 128-char name', () => {
      const maxName = 'a' + 'b'.repeat(127);
      expect(() => validateProjectName(maxName)).not.toThrow();
    });
  });

  describe('validateWorkflowName', () => {
    it('accepts valid workflow names', () => {
      expect(() => validateWorkflowName('daily_feedback')).not.toThrow();
      expect(() => validateWorkflowName('task-execute')).not.toThrow();
      expect(() => validateWorkflowName('review.v2')).not.toThrow();
    });

    it('rejects path traversal', () => {
      expect(() => validateWorkflowName('../../etc/passwd')).toThrow(/Invalid workflow name/);
      expect(() => validateWorkflowName('a/b')).toThrow(/Invalid workflow name/);
    });

    it('rejects shell metacharacters', () => {
      expect(() => validateWorkflowName('workflow;rm -rf')).toThrow(/Invalid workflow name/);
      expect(() => validateWorkflowName('$(cmd)')).toThrow(/Invalid workflow name/);
    });

    it('rejects empty name', () => {
      expect(() => validateWorkflowName('')).toThrow(/Invalid workflow name/);
    });

    it('rejects names exceeding 128 chars', () => {
      const longName = 'a' + 'b'.repeat(128);
      expect(() => validateWorkflowName(longName)).toThrow(/too long/);
    });
  });

  describe('sanitizeForFilename', () => {
    it('strips path separators', () => {
      expect(sanitizeForFilename('a/b/c')).toBe('a_b_c');
      expect(sanitizeForFilename('a\\b')).toBe('a_b');
    });

    it('strips .. sequences', () => {
      expect(sanitizeForFilename('../../etc')).toBe('____etc');
    });

    it('passes through clean names', () => {
      expect(sanitizeForFilename('daily_feedback')).toBe('daily_feedback');
    });
  });
});
