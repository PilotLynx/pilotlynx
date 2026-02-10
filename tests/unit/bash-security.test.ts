import { describe, it, expect } from 'vitest';
import { bashCommandEscapesDir } from '../../src/lib/bash-security.js';

describe('bashCommandEscapesDir', () => {
  const projectDir = '/home/user/projects/myproject';

  describe('existing checks still work', () => {
    it('denies command substitution $()', () => {
      expect(bashCommandEscapesDir('cat $(echo /etc/passwd)', projectDir)).toBe(true);
    });

    it('denies backtick substitution', () => {
      expect(bashCommandEscapesDir('cat `echo /etc/passwd`', projectDir)).toBe(true);
    });

    it('denies variable expansion', () => {
      expect(bashCommandEscapesDir('cat $HOME/.ssh/id_rsa', projectDir)).toBe(true);
      expect(bashCommandEscapesDir('cat ${HOME}/.ssh/id_rsa', projectDir)).toBe(true);
    });

    it('denies relative path traversal', () => {
      expect(bashCommandEscapesDir('cat ../../.env', projectDir)).toBe(true);
    });

    it('denies absolute paths outside project', () => {
      expect(bashCommandEscapesDir('cat /etc/passwd', projectDir)).toBe(true);
    });

    it('allows safe relative commands', () => {
      expect(bashCommandEscapesDir('ls workflows/', projectDir)).toBe(false);
    });

    it('allows absolute paths inside project', () => {
      expect(bashCommandEscapesDir(`cat ${projectDir}/file.txt`, projectDir)).toBe(false);
    });
  });

  describe('hex-encoded path bypass', () => {
    it('denies hex escape sequences', () => {
      expect(bashCommandEscapesDir('printf "\\x2f\\x65\\x74\\x63"', projectDir)).toBe(true);
    });

    it('denies mixed hex escapes', () => {
      expect(bashCommandEscapesDir('echo "\\x41\\x42"', projectDir)).toBe(true);
    });
  });

  describe('octal escape bypass', () => {
    it('denies octal escape sequences', () => {
      expect(bashCommandEscapesDir('printf "\\057\\145\\164\\143"', projectDir)).toBe(true);
    });
  });

  describe('unicode escape bypass', () => {
    it('denies unicode escape sequences', () => {
      expect(bashCommandEscapesDir('printf "\\u002F\\u0065"', projectDir)).toBe(true);
    });
  });

  describe('tilde expansion bypass', () => {
    it('denies tilde at start of path', () => {
      expect(bashCommandEscapesDir('cat ~/secret', projectDir)).toBe(true);
    });

    it('denies tilde after semicolon', () => {
      expect(bashCommandEscapesDir('echo hi; cat ~/', projectDir)).toBe(true);
    });

    it('denies tilde after pipe', () => {
      expect(bashCommandEscapesDir('echo hi | cat ~/', projectDir)).toBe(true);
    });

    it('denies tilde with traversal', () => {
      expect(bashCommandEscapesDir('cat ~/../../../etc/passwd', projectDir)).toBe(true);
    });
  });

  describe('brace expansion bypass', () => {
    it('denies brace expansion with multiple paths', () => {
      expect(bashCommandEscapesDir('cat /etc/{passwd,shadow}', projectDir)).toBe(true);
    });

    it('denies brace expansion in commands', () => {
      expect(bashCommandEscapesDir('echo {a,b,c}', projectDir)).toBe(true);
    });
  });

  describe('input redirect bypass', () => {
    it('denies input redirect with external path', () => {
      expect(bashCommandEscapesDir('command < /etc/passwd', projectDir)).toBe(true);
    });

    it('denies input redirect with space', () => {
      expect(bashCommandEscapesDir('wc -l < file.txt', projectDir)).toBe(true);
    });
  });

  describe('heredoc bypass', () => {
    it('denies heredoc syntax', () => {
      expect(bashCommandEscapesDir('cat <<EOF', projectDir)).toBe(true);
    });

    it('denies heredoc with dash (tab stripping)', () => {
      expect(bashCommandEscapesDir('cat <<-EOF', projectDir)).toBe(true);
    });
  });

  describe('combined attacks', () => {
    it('denies hex-encoded path with cat', () => {
      expect(bashCommandEscapesDir('echo -e "\\x63\\x61\\x74" /etc/passwd', projectDir)).toBe(true);
    });

    it('denies tilde with brace expansion', () => {
      expect(bashCommandEscapesDir('ls ~/{.ssh,.gnupg}', projectDir)).toBe(true);
    });
  });

  describe('safe commands that should NOT be blocked', () => {
    it('allows echo with newline escape (not hex path)', () => {
      expect(bashCommandEscapesDir('echo "hello world"', projectDir)).toBe(false);
    });

    it('allows simple ls', () => {
      expect(bashCommandEscapesDir('ls -la', projectDir)).toBe(false);
    });

    it('allows npm commands', () => {
      expect(bashCommandEscapesDir('npm test', projectDir)).toBe(false);
    });

    it('allows git commands', () => {
      expect(bashCommandEscapesDir('git status', projectDir)).toBe(false);
    });

    it('allows single brace without comma (not expansion)', () => {
      expect(bashCommandEscapesDir('echo {single}', projectDir)).toBe(false);
    });

    it('allows mkdir -p', () => {
      expect(bashCommandEscapesDir('mkdir -p src/components', projectDir)).toBe(false);
    });

    it('allows cat with relative path', () => {
      expect(bashCommandEscapesDir('cat README.md', projectDir)).toBe(false);
    });
  });
});
