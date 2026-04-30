import { spawnSync } from 'node:child_process';

const candidates = process.platform === 'win32'
  ? [['py', ['-3']], ['python', []]]
  : [['python3', []], ['python', []]];

let lastResult = null;
for (const [bin, prefixArgs] of candidates) {
  const result = spawnSync(
    bin,
    [...prefixArgs, '-m', 'unittest', 'discover', '-s', 'backend/tests', '-v'],
    { stdio: 'inherit' }
  );
  if (!result.error) {
    process.exit(result.status ?? 1);
  }
  lastResult = result;
}

if (lastResult?.error) {
  console.error(`Failed to run backend tests: ${lastResult.error.message}`);
}
process.exit(1);
