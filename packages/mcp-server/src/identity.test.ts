import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// This fork ships under its own identity. Nothing it ships may present it as
// Ninjo's module, carry Ninjo's logo (all rights reserved, see LICENSE history),
// or send users to Ninjo's repositories or site.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MODULE_ID = 'tedious-gm-mcp';
const MODULE_TITLE = 'Tedious GM MCP';

// Everything that ends up in a release: both halves, the shared package and the
// installers. Docs and history are not shipped and may name the upstream.
const SHIPPED = [
  'packages/mcp-server/src',
  'packages/foundry-module/src',
  'packages/foundry-module/templates',
  'packages/foundry-module/lang',
  'packages/foundry-module/styles',
  'packages/foundry-module/module.json',
  'shared/src',
  'installer',
];
// Every file under SHIPPED is read, whatever its extension: installers ship
// extensionless scripts, .tool, .ps1 and .bat files too. Only binaries (a NUL
// byte in the first 8 KB) are skipped.
function isText(path: string): boolean {
  return !readFileSync(path).subarray(0, 8192).includes(0);
}

function files(path: string): string[] {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap(e =>
    e.name === 'node_modules' || e.name === 'dist' ? [] : files(join(path, e.name))
  );
}

function offenders(pattern: RegExp): string[] {
  return SHIPPED.flatMap(files)
    .filter(f => !f.endsWith('identity.test.ts') && isText(f))
    .flatMap(f =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => (pattern.test(line) ? `${relative(ROOT, f)}:${i + 1}` : null))
        .filter((x): x is string => x !== null)
    );
}

describe('module identity', () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'packages/foundry-module/module.json'), 'utf8')
  );

  it('module.json carries the fork id, title and author', () => {
    expect(manifest.id).toBe(MODULE_ID);
    expect(manifest.title).toBe(MODULE_TITLE);
    expect(JSON.stringify(manifest.authors)).not.toMatch(/ninjo|niclas/i);
  });

  it('both constants files agree with module.json', () => {
    for (const path of ['shared/src/constants.ts', 'packages/foundry-module/src/constants.ts']) {
      const src = readFileSync(join(ROOT, path), 'utf8');
      expect(src, path).toContain(`MODULE_ID = '${MODULE_ID}'`);
    }
  });

  it('ships no Ninjo logo and references none', () => {
    expect(existsSync(join(ROOT, 'packages/foundry-module/assets/ninjo.png'))).toBe(false);
    expect(offenders(/ninjo\.png/)).toEqual([]);
  });

  it('uses the old module id and repository name nowhere it ships', () => {
    expect(offenders(/ninjos-foundry-mcp/)).toEqual([]);
  });

  // Source comments may still credit where code came from (MIT attribution);
  // what must go is anything presenting this module as Ninjo's, or sending a
  // user to Ninjo's site or repositories.
  it("names neither Ninjo's module, site nor repositories to users", () => {
    expect(offenders(/Ninjo's (Foundry|Forge)|Ninjo\)|ninjos-forge|Niclasp1501/)).toEqual([]);
  });

  // The install guides are not shipped, but users paste their URLs: a manifest
  // link to the upstream repository installs someone else's module.
  it('the install guides name this repository, never the old or upstream one', () => {
    const hits = ['README.md', 'INSTALLATION.md', 'docs/DEV-ENVIRONMENT.md'].flatMap(path =>
      readFileSync(join(ROOT, path), 'utf8')
        .split('\n')
        .map((line, i) => (/ninjos-foundry-mcp(?!-legacy)/.test(line) ? `${path}:${i + 1}` : null))
        .filter((x): x is string => x !== null)
    );
    expect(hits).toEqual([]);
  });

  it('no longer watches an upstream repository', () => {
    expect(existsSync(join(ROOT, '.github/workflows/ursprung-beobachten.yml'))).toBe(false);
  });
});
