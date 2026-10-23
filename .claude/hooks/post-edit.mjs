// PostToolUse hook (Edit|Write): typecheck the project and lint the edited file.
// Exit code 2 feeds stderr back to Claude (see Claude Code hooks documentation).
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Canonical path: with a lower-case drive letter (d: vs D:) Vitest loads itself twice and every test fails.
const projectDir = realpathSync.native(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

const filePath = input?.tool_input?.file_path;
if (typeof filePath !== 'string' || !/\.(ts|js|mjs)$/.test(filePath)) process.exit(0);

const rel = relative(projectDir, resolve(filePath));
if (rel.startsWith('..') || /^(node_modules|dist|\.claude|\.beads|openspec)[\\/]/.test(rel)) process.exit(0);
if (!existsSync(join(projectDir, 'node_modules'))) process.exit(0);

const run = (args) =>
  spawnSync(process.execPath, args, { cwd: projectDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

const failures = [];
const tsc = run([join(projectDir, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit']);
if (tsc.status !== 0) failures.push(`typecheck failed:\n${tsc.stdout}${tsc.stderr}`);

const eslint = run([join(projectDir, 'node_modules/eslint/bin/eslint.js'), rel]);
if (eslint.status !== 0) failures.push(`eslint failed for ${rel}:\n${eslint.stdout}${eslint.stderr}`);

if (failures.length > 0) {
  process.stderr.write(failures.join('\n').slice(0, 8000));
  process.exit(2);
}
process.exit(0);
