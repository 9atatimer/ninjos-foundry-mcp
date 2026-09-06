/**
 * NINJO: Schnittstelle, über die andere Foundry-Module eigene MCP-Werkzeuge
 * anmelden können.
 *
 * Der Sinn: Ein Modul wie Ninjo's Shops kennt seine eigenen Regeln — Preise,
 * Bestandsverbrauch, Feilschen. Baute man dafür Werkzeuge fest in diesen Server
 * ein, liefe das Modell an diesen Regeln vorbei und der MCP-Server hinge an
 * einem Modul, das die meisten Nutzer gar nicht haben. Stattdessen meldet das
 * fremde Modul sein Werkzeug hier an und behält seinen Handler.
 *
 * Anmelden geschieht über einen Hook beim Hochfahren:
 *
 *   Hooks.on("ninjos-foundry-mcp.registerTools", (anmelden) => {
 *     anmelden({
 *       name: "laden-ware-einbuchen",
 *       description: "Legt eine Ware mit Preis in einen Laden.",
 *       inputSchema: { type: "object", properties: { ... }, required: [...] },
 *       handler: async (args) => ({ ok: true })
 *     });
 *   });
 *
 * Wahlweise auch über die API dieses Moduls:
 *
 *   game.modules.get("ninjos-foundry-mcp").api.werkzeugAnmelden(kennung, def);
 *
 * Drei Riegel, die nicht verhandelbar sind:
 *
 * 1. **Freigabe.** Nur Module, die in den Einstellungen angehakt sind, dürfen
 *    anmelden. Ab Werk keines. Ein fremder Handler läuft an der Rechtematrix
 *    dieses Moduls vorbei — wer ihn zulässt, soll das bewusst tun.
 * 2. **Keine Namenskollision.** Ein fremdes Werkzeug darf keines der eigenen
 *    überschreiben, sonst könnte ein Modul `list-scenes` kapern.
 * 3. **Nur der Spielleiter.** Gilt für die ganze Brücke und damit auch hier.
 */
import { MODULE_ID } from './constants.js';

export interface FremdwerkzeugDefinition {
  /** Werkzeugname, wie ihn das Modell sieht. */
  name: string;
  description: string;
  /** JSON-Schema der Parameter, wie es MCP erwartet. */
  inputSchema: Record<string, unknown>;
  /** Wird aufgerufen, wenn das Modell das Werkzeug benutzt. */
  handler: (args: any) => Promise<unknown> | unknown;
}

interface Eintrag extends FremdwerkzeugDefinition {
  /** Welches Modul es angemeldet hat — steht in Fehlermeldungen und im Protokoll. */
  modulKennung: string;
}

/** Der Name der Einstellung mit der Freigabeliste. */
export const FREMDMODULE_SETTING = 'werkzeugModule';

const angemeldet = new Map<string, Eintrag>();

/** Namen, die dieses Modul selbst vergibt und die niemand überschreiben darf. */
let eigeneNamen: Set<string> = new Set();

/**
 * Die eigenen Werkzeugnamen hinterlegen, damit Kollisionen auffallen.
 * Wird beim Hochfahren aus den registrierten Abfragen gefüllt.
 */
export function eigeneWerkzeugnamenSetzen(namen: Iterable<string>): void {
  eigeneNamen = new Set(namen);
}

function freigegebeneModule(): string[] {
  let roh = '';
  try {
    roh = (game.settings?.get(MODULE_ID, FREMDMODULE_SETTING) as string) || '';
  } catch {
    roh = '';
  }
  return roh
    .split(/[,\n;]/)
    .map(e => e.trim())
    .filter(Boolean);
}

/**
 * Ein Werkzeug anmelden. Gibt zurück, ob es angenommen wurde — und schreibt bei
 * Ablehnung den Grund ins Protokoll, damit der Modulautor ihn findet.
 */
export function werkzeugAnmelden(
  modulKennung: string,
  def: FremdwerkzeugDefinition
): { angenommen: boolean; grund?: string } {
  const ablehnen = (grund: string) => {
    console.warn(
      `[${MODULE_ID}] Werkzeug "${def?.name}" von "${modulKennung}" abgelehnt: ${grund}`
    );
    return { angenommen: false, grund };
  };

  if (!modulKennung) return ablehnen('Es fehlt die Kennung des anmeldenden Moduls');
  if (!def?.name) return ablehnen('Es fehlt der Name');
  if (typeof def.handler !== 'function') return ablehnen('Es fehlt ein handler');
  if (!def.description)
    return ablehnen(
      'Es fehlt eine Beschreibung — ohne sie weiß das Modell nicht, wofür das Werkzeug gut ist'
    );

  if (!freigegebeneModule().includes(modulKennung)) {
    return ablehnen(
      `"${modulKennung}" ist nicht freigegeben. In den Moduleinstellungen unter ` +
        `"Module mit eigenen Werkzeugen" anhaken. Ab Werk ist keines freigegeben, ` +
        `weil ein fremder Handler an der Rechtematrix vorbeiarbeitet.`
    );
  }

  if (eigeneNamen.has(def.name)) {
    return ablehnen(
      `"${def.name}" ist ein Werkzeug dieses Moduls und darf nicht ueberschrieben werden`
    );
  }

  const vorhanden = angemeldet.get(def.name);
  if (vorhanden && vorhanden.modulKennung !== modulKennung) {
    return ablehnen(`"${def.name}" ist bereits von "${vorhanden.modulKennung}" angemeldet`);
  }

  angemeldet.set(def.name, { ...def, modulKennung });
  console.log(`[${MODULE_ID}] Werkzeug "${def.name}" von "${modulKennung}" angemeldet`);
  return { angenommen: true };
}

/**
 * Alle Module ihre Werkzeuge anmelden lassen. Wird einmal beim Hochfahren
 * gerufen, nachdem die Einstellungen stehen.
 */
export function fremdwerkzeugeSammeln(): void {
  angemeldet.clear();

  const freigegeben = freigegebeneModule();
  if (!freigegeben.length) {
    console.log(
      `[${MODULE_ID}] Kein Modul ist fuer eigene Werkzeuge freigegeben. ` +
        `Freigabe unter "Module mit eigenen Werkzeugen" in den Moduleinstellungen.`
    );
    return;
  }

  // Der Hook reicht eine Anmeldefunktion heraus. Welches Modul gerade anmeldet,
  // muss es selbst sagen - Foundry verraet es nicht.
  // Die mitgelieferten Foundry-Typen kennen callAll nicht, deshalb die Zusicherung.
  (Hooks as any).callAll(
    `${MODULE_ID}.registerTools`,
    (modulKennung: string, def: FremdwerkzeugDefinition) => werkzeugAnmelden(modulKennung, def)
  );

  console.log(`[${MODULE_ID}] ${angemeldet.size} fremde Werkzeug(e) angemeldet`);
}

/** Die Werkzeugbeschreibungen, wie der MCP-Server sie braucht - ohne die Handler. */
export function fremdwerkzeugeAuflisten(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  modulKennung: string;
}> {
  return [...angemeldet.values()].map(e => ({
    name: e.name,
    description: e.description,
    inputSchema: e.inputSchema ?? { type: 'object', properties: {} },
    modulKennung: e.modulKennung,
  }));
}

/** Einen Aufruf an den Handler des anmeldenden Moduls weiterreichen. */
export async function fremdwerkzeugAufrufen(name: string, args: any): Promise<unknown> {
  const eintrag = angemeldet.get(name);
  if (!eintrag) {
    throw new Error(
      `Kein fremdes Werkzeug "${name}" angemeldet. Entweder ist das Modul nicht aktiv, ` +
        `oder es steht nicht in der Freigabeliste.`
    );
  }

  // Die Freigabe wird bei jedem Aufruf erneut geprueft, nicht nur beim Anmelden:
  // Wer ein Modul aus der Liste nimmt, will nicht bis zum naechsten Weltstart warten.
  if (!freigegebeneModule().includes(eintrag.modulKennung)) {
    throw new Error(
      `"${eintrag.modulKennung}" ist nicht mehr freigegeben, das Werkzeug "${name}" ist gesperrt.`
    );
  }

  return await eintrag.handler(args);
}
