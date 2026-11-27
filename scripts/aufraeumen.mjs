#!/usr/bin/env node
/**
 * Loescht die Bauausgaben, bevor gebaut wird.
 *
 * tsc schreibt nur, was es gerade uebersetzt, und loescht nichts. Eine entfernte
 * oder umbenannte Quelldatei bleibt deshalb als .js in dist/ liegen. Am 13.09.2026
 * lag im Modul noch eine laengst in extension-tools umbenannte fremdwerkzeuge.js,
 * und die Auslieferung per tar musste sie von Hand ausschliessen. Ein lokal
 * gebauter Installer haette solche Reste mitgenommen.
 *
 * Der Bau in den Workflows startet von einem frischen Checkout und war davon nie
 * betroffen; es geht um alles, was von einem Arbeitsrechner aus gebaut wird.
 *
 * Aufruf: node scripts/aufraeumen.mjs (laeuft ueber "npm run build" automatisch)
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const verzeichnisse = ['packages/mcp-server/dist', 'packages/foundry-module/dist', 'shared/dist'];

let entfernt = 0;
for (const v of verzeichnisse) {
  if (existsSync(v)) {
    rmSync(v, { recursive: true, force: true });
    entfernt++;
  }
}

// tsbuildinfo merkt sich den letzten Stand. Ohne dist/ muss auch das weg, sonst
// haelt tsc die Ausgabe fuer aktuell und schreibt nichts.
const suche = d => {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === '.git') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) suche(p);
    else if (n.endsWith('.tsbuildinfo')) {
      rmSync(p, { force: true });
      entfernt++;
    }
  }
};
suche('.');

console.log(`Aufgeraeumt: ${entfernt} Bauausgaben entfernt.`);
