import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every entry must be justified in docs/DECISIONS.md.
const ALLOWED_DEPENDENCIES = new Set(['fastify', 'zod']);
const ALLOWED_DEV_DEPENDENCIES = new Set([
  'typescript',
  'tsx',
  'vitest',
  'eslint',
  'prettier',
  '@types/node',
  // ESLint support for TypeScript, see DECISIONS.md.
  'typescript-eslint',
  '@eslint/js',
]);
// Version pins of transitive packages only, see DECISIONS.md.
const ALLOWED_OVERRIDES = new Set(['vite']);

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
  string,
  Record<string, string> | undefined
>;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('dependency guard', () => {
  it('production dependencies are on the allowlist', () => {
    const extra = Object.keys(pkg.dependencies ?? {}).filter((d) => !ALLOWED_DEPENDENCIES.has(d));
    expect(extra).toEqual([]);
  });

  it('dev dependencies are on the allowlist', () => {
    const extra = Object.keys(pkg.devDependencies ?? {}).filter((d) => !ALLOWED_DEV_DEPENDENCIES.has(d));
    expect(extra).toEqual([]);
  });

  it('has no peer, optional or bundled dependencies and only allowed overrides', () => {
    expect(pkg.peerDependencies ?? {}).toEqual({});
    expect(pkg.optionalDependencies ?? {}).toEqual({});
    expect(pkg.bundleDependencies ?? pkg.bundledDependencies ?? {}).toEqual({});
    const extra = Object.keys(pkg.overrides ?? {}).filter((d) => !ALLOWED_OVERRIDES.has(d));
    expect(extra).toEqual([]);
  });
});

describe('source guard', () => {
  const files = listSourceFiles(join(root, 'src'));

  it('imports only node built-ins, relative modules and allowed packages', () => {
    const offending: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const target = match[1] ?? '';
        const ok = target.startsWith('.') || target.startsWith('node:') || ALLOWED_DEPENDENCIES.has(target);
        if (!ok) offending.push(`${relative(root, file)}: ${target}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('never calls an LLM', () => {
    const pattern = /anthropic|openai|claude|langchain|completions|generativelanguage/i;
    const offending = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(offending.map((f) => relative(root, f))).toEqual([]);
  });

  it('contains no year literals outside the calendar rules', () => {
    const offending: string[] = [];
    for (const file of files) {
      if (file.endsWith('calendar.ts')) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\b(19|20)\d{2}\b/g))
        offending.push(`${relative(root, file)}: ${match[0]}`);
    }
    expect(offending).toEqual([]);
  });
});
