import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../');
const FORBIDDEN_TOKENS = ['OPENAI_API_KEY', 'OPENDART_API_KEY', 'DART_API_KEY', 'JWT_SECRET_KEY'];

const walk = (dir, out = []) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, out);
      return;
    }
    if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(absolute);
  });
  return out;
};

describe('frontend secret leak guard', () => {
  it('does not reference server-only secret env names in browser source', () => {
    const files = walk(ROOT).filter((filePath) => !filePath.includes(`${path.sep}__tests__${path.sep}`));
    const violations = [];

    files.forEach((filePath) => {
      const text = fs.readFileSync(filePath, 'utf8');
      FORBIDDEN_TOKENS.forEach((token) => {
        if (text.includes(token)) violations.push(`${token} -> ${filePath}`);
      });
    });

    expect(violations).toEqual([]);
  });
});
