/**
 * A small always-visible readout of the bridge state, for the GM.
 *
 * Why this exists: on 2026-09-06 the bridge was down for eleven hours without
 * anyone noticing. The backend on the PC had failed to open its listening port,
 * yet it still started, still offered all its tools, and answered every single
 * call with "module not connected". Nothing in Foundry showed the state — the
 * only place it was written down was a settings hint nobody opens, and the log
 * line that explained it sat eleven hours up in a 19 MB file.
 *
 * A tool that answers an error is indistinguishable from a tool that is having
 * a bad day. A dot in the corner is not.
 *
 * Three rules it follows:
 *
 * 1. **GM only.** Players cannot act on it and cannot change the settings.
 * 2. **Quiet when things work, loud when they do not.** Connected is a small
 *    green dot; disconnected is red and stays red. An indicator that alarms
 *    while everything is fine gets ignored, and then it is worth nothing on the
 *    day it is right.
 * 3. **Switched off is not broken.** With the bridge disabled in the settings
 *    the dot goes grey, not red — otherwise a deliberate "off" looks like a
 *    fault every session.
 */
import { MODULE_ID } from './constants.js';

const ELEMENT_ID = 'mcp-bridge-status';

/** How often the readout re-reads the state, in ms. */
const POLL_MS = 5000;

let pollTimer: number | null = null;

type Kind = 'connected' | 'connecting' | 'disconnected' | 'disabled';

interface Readout {
  kind: Kind;
  text: string;
  detail: string;
}

function bridge(): any {
  return (window as any).foundryMCPBridge;
}

function t(key: string, fallback: string): string {
  const full = `${MODULE_ID}.indicator.${key}`;
  const out = game.i18n?.localize(full);
  // localize hands the key straight back when it is missing, which would put a
  // raw dotted string in the corner of the screen.
  return !out || out === full ? fallback : out;
}

/** Read the current state. Never throws — a readout that can crash is worse than none. */
function read(): Readout {
  let status: any;
  try {
    status = bridge()?.getStatus?.();
  } catch {
    status = null;
  }

  if (!status) {
    return {
      kind: 'disconnected',
      text: t('unknown', 'MCP: no answer'),
      detail: t('unknownDetail', 'The module is loaded but reports no state.'),
    };
  }

  if (!status.enabled) {
    return {
      kind: 'disabled',
      text: t('off', 'MCP: off'),
      detail: t('offDetail', 'The bridge is switched off in the module settings.'),
    };
  }

  const where = status.connectionInfo?.config
    ? `${status.connectionInfo.config.host}:${status.connectionInfo.config.port}`
    : '';

  if (status.connected) {
    const via = status.connectionInfo?.type ? ` (${status.connectionInfo.type})` : '';
    return {
      kind: 'connected',
      text: t('on', 'MCP: connected'),
      detail: `${t('onDetail', 'Bridge to')} ${where}${via}`,
    };
  }

  const state = status.connectionState;
  if (state === 'connecting' || state === 'reconnecting') {
    const tries = status.connectionInfo?.reconnectAttempts;
    return {
      kind: 'connecting',
      text: t('connecting', 'MCP: connecting'),
      detail: tries ? `${t('attempt', 'Attempt')} ${tries}` : where,
    };
  }

  return {
    kind: 'disconnected',
    text: t('down', 'MCP: disconnected'),
    detail: `${t('downDetail', 'No bridge to')} ${where}. ${t(
      'downHint',
      'Is the MCP server running on the PC? Click to try again.'
    )}`,
  };
}

/** Find a home for the readout. Falls back to the body so it is never invisible. */
function anchor(): HTMLElement | null {
  return (document.getElementById('players') ??
    document.getElementById('ui-left') ??
    document.body) as HTMLElement | null;
}

function build(): HTMLElement {
  const el = document.createElement('div');
  el.id = ELEMENT_ID;
  el.addEventListener('click', () => void onClick());
  return el;
}

/** Clicking a dead bridge tries to bring it back; clicking a live one says so. */
async function onClick(): Promise<void> {
  const { kind } = read();

  if (kind === 'connected') {
    ui.notifications?.info(read().detail);
    return;
  }

  if (kind === 'disabled') {
    ui.notifications?.warn(t('offDetail', 'The bridge is switched off in the module settings.'));
    return;
  }

  ui.notifications?.info(t('retrying', 'Reconnecting the MCP bridge…'));
  try {
    await bridge()?.start?.();
  } catch (error) {
    ui.notifications?.error(
      `${t('retryFailed', 'Reconnecting failed')}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  refreshStatusIndicator();
}

/** Write the current state into the element. Cheap enough to run on a timer. */
export function refreshStatusIndicator(): void {
  const el = document.getElementById(ELEMENT_ID);
  if (!el) return;

  const { kind, text, detail } = read();
  el.className = `mcp-status mcp-status--${kind}`;
  el.title = detail;
  el.innerHTML = `<span class="mcp-status__dot"></span><span class="mcp-status__text"></span>`;
  const label = el.querySelector('.mcp-status__text');
  // textContent, not innerHTML: the detail carries a host name from the
  // settings, and that is user input.
  if (label) label.textContent = text;
}

/**
 * Put the readout on screen and keep it there.
 *
 * Foundry re-renders the player list on its own (a player connects, a name
 * changes), which throws our element away with it. So renderPlayers puts it
 * back rather than the indicator being placed once and hoped for.
 */
export function installStatusIndicator(): void {
  if (!game.user?.isGM) return;

  const place = () => {
    const host = anchor();
    if (!host) return;
    if (host.querySelector(`#${ELEMENT_ID}`)) {
      refreshStatusIndicator();
      return;
    }
    document.getElementById(ELEMENT_ID)?.remove();
    host.prepend(build());
    refreshStatusIndicator();
  };

  place();
  Hooks.on('renderPlayers', place);

  if (pollTimer === null) {
    // A timer rather than events alone: the interesting failure is the one
    // where no event arrives because nothing was ever established.
    pollTimer = window.setInterval(refreshStatusIndicator, POLL_MS);
  }
}

export function removeStatusIndicator(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  document.getElementById(ELEMENT_ID)?.remove();
}
