/**
 * Meldungen an den Menschen — an einer Stelle, mit Rueckfalltext.
 *
 * **Warum es das gibt.** Am 07.09.2026 hatte dieses Modul 72 Benachrichtigungen,
 * alle auf Englisch, mehrere mit Emoji — waehrend seine Einstellungen
 * vollstaendig uebersetzt waren. Die Sprachdateien lagen da; die Meldungen
 * gingen an ihnen vorbei. Regel 4 der Oberflaechen-Grundsaetze
 * (CLAUDE.md des Workspace) sagt: kein sichtbarer Text ohne Sprachschluessel.
 *
 * **Warum mit Rueckfalltext.** `game.i18n.localize` gibt bei einem fehlenden
 * Schluessel den Schluessel selbst zurueck — dann stuende
 * `ninjos-foundry-mcp.notify.connected` in der Ecke des Bildschirms. Der
 * zweite Parameter ist die Fassung, die dann erscheint. Das Muster stammt aus
 * `status-indicator.ts`, wo es sich bereits bewaehrt hat; hier ist es fuer das
 * ganze Modul verallgemeinert.
 *
 * **Keine Emoji.** Sie wurden auf jedem Betriebssystem anders gezeichnet und
 * passten in ein Pergament-Design so gut wie ein Aufkleber. Font Awesome ist
 * ohnehin geladen; wo ein Zeichen noetig ist, steht es dort.
 */

import { MODULE_ID } from './constants.js';

/**
 * Uebersetzt `notify.<schluessel>`, sonst der Rueckfalltext.
 *
 * `daten` fuellt Platzhalter der Form `{name}` — in beiden Faellen, damit der
 * Rueckfalltext dieselben Platzhalter tragen darf wie die Uebersetzung.
 */
export function text(
  schluessel: string,
  rueckfall: string,
  daten?: Record<string, string | number>
): string {
  const voll = `${MODULE_ID}.notify.${schluessel}`;
  const uebersetzt = game.i18n?.localize(voll);
  const roh = !uebersetzt || uebersetzt === voll ? rueckfall : uebersetzt;
  if (!daten) return roh;
  return roh.replace(/\{(\w+)\}/g, (treffer, name) =>
    Object.prototype.hasOwnProperty.call(daten, name) ? String(daten[name]) : treffer
  );
}

/**
 * Die drei Toast-Arten.
 *
 * `ui.notifications` kann waehrend des Hochfahrens noch fehlen — deshalb
 * ueberall der Fragezeichen-Zugriff, so wie im uebrigen Modul auch.
 */
export const melde = {
  info(schluessel: string, rueckfall: string, daten?: Record<string, string | number>): void {
    ui.notifications?.info(text(schluessel, rueckfall, daten));
  },
  warn(schluessel: string, rueckfall: string, daten?: Record<string, string | number>): void {
    ui.notifications?.warn(text(schluessel, rueckfall, daten));
  },
  error(schluessel: string, rueckfall: string, daten?: Record<string, string | number>): void {
    ui.notifications?.error(text(schluessel, rueckfall, daten));
  },
};
