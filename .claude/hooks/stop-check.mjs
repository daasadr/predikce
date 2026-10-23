// Stop hook: do not let the session finish while typecheck, lint or tests fail.
// Exit code 2 blocks stopping and feeds stderr back to Claude (see Claude Code hooks documentation).
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

// Canonical path: with a lower-case drive letter (d: vs D:) Vitest loads itself twice and every test fails.
const projectDir = realpathSync.native(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
if (!existsSync(join(projectDir, 'package.json')) || !existsSync(join(projectDir, 'node_modules'))) {
  process.exit(0);
}

const failures = [];
for (const script of ['typecheck', 'lint', 'test']) {
  const result = spawnSync('npm', ['run', script], {
    cwd: projectDir,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    failures.push(`npm run ${script} failed:\n${output.slice(-4000)}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Quality gate failed, fix before finishing.\n${failures.join('\n')}`);
  process.exit(2);
}
process.exit(0);
