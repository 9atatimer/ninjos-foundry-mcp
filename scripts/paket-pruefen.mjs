#!/usr/bin/env node
/**
 * Prueft das geschnuerte Modulpaket, bevor es ans Release angehaengt wird.
 *
 * Was schiefgehen kann (siehe task-013): "manifest" und "download" zeigen auf
 * releases/latest/download/... . Der "latest"-Alias von GitHub schliesst
 * Prereleases ausdruecklich aus -- ein Repo mit nur einem Beta-Tag hat also
 * kein "latest", auf das das aufloesen koennte. Foundry (und Forges Bazaar)
 * laden zuerst das Manifest, dann die darin genannte "download"-URL fuer das
 * Zip -- schlaegt Letzteres fehl, bricht die Installation ab.
 *
 * Aufruf: node scripts/paket-pruefen.mjs <pfad-zu-module.json> <tag>
 */
import { readFileSync } from 'node:fs';

const [pfad, tag] = process.argv.slice(2);
if (!pfad || !tag) {
  console.error('Aufruf: node scripts/paket-pruefen.mjs <pfad-zu-module.json> <tag>');
  process.exit(2);
}

const { manifest, download } = JSON.parse(readFileSync(pfad, 'utf8'));
const fehler = [];

for (const [feld, wert] of [['manifest', manifest], ['download', download]]) {
  if (!wert) continue;
  if (wert.includes('/releases/latest/download/')) {
    fehler.push(`"${feld}" zeigt auf releases/latest/download -- loest fuer ein Repo ohne Nicht-Prerelease nicht auf: ${wert}`);
  } else if (wert.includes('/releases/download/') && !wert.includes(`/releases/download/${tag}/`)) {
    fehler.push(`"${feld}" nennt nicht den aktuellen Tag "${tag}": ${wert}`);
  }
}

if (fehler.length) {
  console.error('FEHLER:');
  for (const f of fehler) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`Paket in Ordnung: manifest/download passen zu Tag ${tag}.`);
