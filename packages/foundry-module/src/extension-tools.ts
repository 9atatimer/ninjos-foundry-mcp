/**
 * Lets other Foundry modules register MCP tools of their own.
 *
 * The point: a module like Ninjo's Shops knows its own rules — prices, stock,
 * haggling. Building tools for it into this server would have the model work
 * around those rules, and would tie a server most people install for other
 * reasons to a module they do not have. So the other module registers its tool
 * here and keeps its handler.
 *
 * Registration happens through a hook during startup:
 *
 *   Hooks.on("ninjos-foundry-mcp.registerTools", (register) => {
 *     register("my-module", {
 *       name: "shop-stock-item",
 *       description: "Puts an item into a shop at a given price.",
 *       inputSchema: { type: "object", properties: { ... }, required: [...] },
 *       handler: async (args) => ({ ok: true })
 *     });
 *   });
 *
 * Or through this module's API:
 *
 *   game.modules.get("ninjos-foundry-mcp").api.registerTool(moduleId, definition);
 *
 * Three guards that are not negotiable:
 *
 * 1. **Release per module.** Only modules listed in the settings may register,
 *    and none is listed by default. A third-party handler works around this
 *    module's permission matrix — allowing one should be a decision.
 * 2. **No name collisions.** A third-party tool must not shadow one of ours, or
 *    a module could hijack `list-scenes`.
 * 3. **GM only**, as everywhere on this bridge.
 */
import { MODULE_ID } from './constants.js';

export interface ExtensionToolDefinition {
  /** Tool name as the model sees it. */
  name: string;
  description: string;
  /** JSON schema of the parameters, in the shape MCP expects. */
  inputSchema: Record<string, unknown>;
  /** Runs when the model calls the tool. */
  handler: (args: any) => Promise<unknown> | unknown;
}

interface Entry extends ExtensionToolDefinition {
  /** Which module registered it — shown in errors and in the log. */
  moduleId: string;
}

/** Setting holding the ids of modules allowed to register tools. */
export const TOOL_PROVIDERS_SETTING = 'toolProviderModules';

/**
 * The name this setting had in 14.2609.2, the only release that shipped it.
 * Read as a fallback so a world that already filled the list keeps it; see
 * migrateToolProvidersSetting().
 */
const LEGACY_PROVIDERS_SETTING = 'werkzeugModule';

const registered = new Map<string, Entry>();

/** Names this module hands out itself, which nobody may override. */
let ownToolNames: Set<string> = new Set();

/**
 * Record our own tool names so collisions are caught. Filled during startup
 * from the registered queries.
 */
export function setOwnToolNames(names: Iterable<string>): void {
  ownToolNames = new Set(names);
}

function readSetting(key: string): string {
  try {
    return (game.settings?.get(MODULE_ID, key) as string) || '';
  } catch {
    return '';
  }
}

function releasedModules(): string[] {
  // The old key is read as a fallback rather than migrated on the fly, so a GM
  // who never opens the settings does not silently lose the list.
  const raw = readSetting(TOOL_PROVIDERS_SETTING) || readSetting(LEGACY_PROVIDERS_SETTING);
  return raw
    .split(/[,\n;]/)
    .map(e => e.trim())
    .filter(Boolean);
}

/**
 * Carry the list over from the name it had in 14.2609.2. Never overwrites a
 * value already set under the new key, so it is safe to run on every start.
 */
export async function migrateToolProvidersSetting(): Promise<void> {
  if (!game.user?.isGM) return;
  const current = readSetting(TOOL_PROVIDERS_SETTING);
  const legacy = readSetting(LEGACY_PROVIDERS_SETTING);
  if (current || !legacy) return;

  try {
    await game.settings.set(MODULE_ID, TOOL_PROVIDERS_SETTING, legacy);
    console.log(
      `[${MODULE_ID}] Carried the tool provider list over from "${LEGACY_PROVIDERS_SETTING}"`
    );
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not carry the tool provider list over:`, error);
  }
}

/**
 * Register a tool. Returns whether it was accepted, and logs the reason when it
 * was not, so the module author can find it.
 */
export function registerTool(
  moduleId: string,
  def: ExtensionToolDefinition
): { accepted: boolean; reason?: string } {
  const refuse = (reason: string) => {
    console.warn(`[${MODULE_ID}] Tool "${def?.name}" from "${moduleId}" refused: ${reason}`);
    return { accepted: false, reason };
  };

  if (!moduleId) return refuse('the id of the registering module is missing');
  if (!def?.name) return refuse('the name is missing');
  if (typeof def.handler !== 'function') return refuse('a handler is missing');
  if (!def.description)
    return refuse(
      'a description is missing — without one the model cannot tell what the tool is for'
    );

  if (!releasedModules().includes(moduleId)) {
    return refuse(
      `"${moduleId}" is not released. Add it under "Modules with their own tools" in the ` +
        `module settings. None is released by default, because a third-party handler works ` +
        `around the permission matrix.`
    );
  }

  if (ownToolNames.has(def.name)) {
    return refuse(`"${def.name}" is a tool of this module and must not be overridden`);
  }

  const existing = registered.get(def.name);
  if (existing && existing.moduleId !== moduleId) {
    return refuse(`"${def.name}" is already registered by "${existing.moduleId}"`);
  }

  registered.set(def.name, { ...def, moduleId });
  console.log(`[${MODULE_ID}] Tool "${def.name}" from "${moduleId}" registered`);
  return { accepted: true };
}

/**
 * Let every module register its tools. Called once during startup, after the
 * settings are in place.
 */
export function collectExtensionTools(): void {
  registered.clear();

  if (!releasedModules().length) {
    console.log(
      `[${MODULE_ID}] No module is released for tools of its own. ` +
        `Release them under "Modules with their own tools" in the module settings.`
    );
    return;
  }

  // The hook hands out a registration function. Which module is registering has
  // to be stated by that module — Foundry does not reveal it.
  // The bundled Foundry types do not know callAll, hence the assertion.
  (Hooks as any).callAll(
    `${MODULE_ID}.registerTools`,
    (moduleId: string, def: ExtensionToolDefinition) => registerTool(moduleId, def)
  );

  console.log(`[${MODULE_ID}] ${registered.size} extension tool(s) registered`);
}

/** The tool descriptions as the MCP server needs them — without the handlers. */
export function listExtensionTools(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  moduleId: string;
}> {
  return [...registered.values()].map(e => ({
    name: e.name,
    description: e.description,
    inputSchema: e.inputSchema ?? { type: 'object', properties: {} },
    moduleId: e.moduleId,
  }));
}

/** Hand a call on to the registering module's handler. */
export async function callExtensionTool(name: string, args: any): Promise<unknown> {
  const entry = registered.get(name);
  if (!entry) {
    throw new Error(
      `No extension tool "${name}" is registered. Either the module is not active, ` +
        `or it is not on the release list.`
    );
  }

  // The release is re-checked on every call, not only at registration: taking a
  // module off the list should not have to wait for the next world start.
  if (!releasedModules().includes(entry.moduleId)) {
    throw new Error(`"${entry.moduleId}" is no longer released, the tool "${name}" is blocked.`);
  }

  return await entry.handler(args);
}
