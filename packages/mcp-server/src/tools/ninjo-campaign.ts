/**
 * NINJO EXTENSION
 *
 * Tools for building a campaign that the upstream project does not have:
 * playlists, compendium import, roll tables, notes on scenes.
 *
 * Deliberately in a file of its own, so that comparing against upstream never
 * touches any of it.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface NinjoCampaignToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class NinjoCampaignTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: NinjoCampaignToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'NinjoCampaignTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'list-playlists',
        description:
          'List the playlists in the world with their sounds. Use this to find the exact playlist and sound name before linking one to a scene, or to check whether a playlist referenced by a journal actually exists in the world.',
        inputSchema: {
          type: 'object',
          properties: {
            includeSounds: {
              type: 'boolean',
              description: 'Include the individual sounds of each playlist (default true)',
            },
          },
        },
      },
      {
        name: 'import-from-compendium',
        description:
          'Copy a document out of a compendium into the world — playlists, scenes, journals, actors, roll tables, anything. Always assigns a FRESH id, so it can never overwrite an existing world document. That is the difference to dragging an entry out of a compendium by hand, which keeps the id and silently replaces whatever carries the same one.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: {
              type: 'string',
              description: 'Compendium id, e.g. "ninjo-kompendium.musik"',
            },
            entryName: {
              type: 'string',
              description: 'Name of the entry (exact match preferred, falls back to substring)',
            },
            entryId: { type: 'string', description: 'Id of the entry, alternative to entryName' },
            newName: { type: 'string', description: 'Rename on import' },
            folderPath: {
              type: 'string',
              description: 'Target folder, nested paths allowed',
            },
          },
          required: ['packId'],
        },
      },
      {
        name: 'set-scene-playlist',
        description:
          'Link a playlist, and optionally one specific sound, to a scene so it starts when the scene is activated. Pass an empty playlistName to remove the link. The playlist has to exist in the world; use import-from-compendium first if it only exists in a compendium.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneIdentifier: { type: 'string', description: 'Scene name or id' },
            playlistName: {
              type: 'string',
              description: 'Playlist name or id. Empty string removes the link.',
            },
            soundName: {
              type: 'string',
              description: 'Optional single track inside that playlist',
            },
          },
          required: ['sceneIdentifier'],
        },
      },
      {
        name: 'list-roll-tables',
        description: 'List the roll tables in the world with their formula and number of results.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create-roll-table',
        description:
          'Create a roll table from a list of text results. Ranges are assigned consecutively when omitted (first entry 1, second 2, and so on) and the dice formula is derived from the highest range, so a six-entry table becomes 1d6 by itself.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Table name' },
            description: { type: 'string', description: 'Optional description' },
            formula: {
              type: 'string',
              description: 'Dice formula, e.g. "1d6". Derived from the ranges if omitted.',
            },
            folderPath: { type: 'string', description: 'Target folder, nested paths allowed' },
            results: {
              type: 'array',
              description: 'The entries of the table, in order',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Result text' },
                  range: {
                    type: 'array',
                    description: 'Optional [min, max] for this entry',
                    items: { type: 'number' },
                  },
                  weight: { type: 'number', description: 'Optional weight, default 1' },
                },
                required: ['text'],
              },
            },
          },
          required: ['name', 'results'],
        },
      },
      {
        name: 'create-scene-note',
        description:
          'Pin a journal entry, optionally a specific page, onto a scene at the given pixel coordinates. Use this to make the locations on a town map clickable.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneIdentifier: { type: 'string', description: 'Scene name or id' },
            journalName: { type: 'string', description: 'Journal name or id' },
            pageName: { type: 'string', description: 'Optional page inside that journal' },
            x: { type: 'number', description: 'X coordinate in scene pixels' },
            y: { type: 'number', description: 'Y coordinate in scene pixels' },
            label: { type: 'string', description: 'Optional label shown next to the pin' },
            icon: {
              type: 'string',
              description: 'Optional icon path, default "icons/svg/book.svg"',
            },
            iconSize: { type: 'number', description: 'Icon size in pixels, default 40' },
          },
          required: ['sceneIdentifier', 'journalName', 'x', 'y'],
        },
      },
      {
        name: 'get-permissions',
        description:
          'Show what the AI is currently allowed to do per document kind: scenes, playlists, journals, roll tables, actors, folders. Each kind has three levels — read only, create and update, or additionally delete. Deleting is off by default everywhere. Call this when an action was refused, to see which switch has to be flipped in the module settings.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'delete-playlist',
        description:
          'Delete a playlist by its id. Refuses while the playlist is still linked to a scene, and names those scenes. Requires the playlist permission to be set to full.',
        inputSchema: {
          type: 'object',
          properties: {
            playlistId: { type: 'string', description: 'Id of the playlist' },
          },
          required: ['playlistId'],
        },
      },
      {
        name: 'delete-roll-table',
        description:
          'Delete a roll table by its id. Requires the roll table permission to be set to full.',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: { type: 'string', description: 'Id of the roll table' },
          },
          required: ['tableId'],
        },
      },
      {
        name: 'list-compendiums',
        description:
          'List every compendium with its type, entry count and lock state. An unlocked compendium can be written to, no matter who ships it: many people keep their own collections as a module rather than inside the world. Call this before exporting to find the right pack id.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create-compendium',
        description:
          'Create a new world compendium, for example to archive a finished chapter of a campaign. Choose the document type it will hold.',
        inputSchema: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Display name, e.g. "Secrets of the Abyss, Act 0"',
            },
            type: {
              type: 'string',
              description:
                'What it holds: Actor, Item, Scene, JournalEntry, RollTable, Playlist, Macro, Cards or Adventure',
            },
          },
          required: ['label', 'type'],
        },
      },
      {
        name: 'list-compendium-entries',
        description:
          'List what actually sits inside a compendium — ids, names, types and folders. list-compendiums only gives counts, so this is the way to check whether an archive holds what it should, to find duplicates, or to get the ids needed for any later work. Reads the index only, never the full documents, and pages through at most 1000 entries per call. Read-only: it changes nothing and works regardless of the permission level.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: {
              type: 'string',
              description:
                'Compendium id, e.g. world.archiv-salzmarsch or ninjo-kompendium.presets',
            },
            namePattern: {
              type: 'string',
              description: 'Only entries whose name contains this text (case-insensitive)',
            },
            folderName: {
              type: 'string',
              description: 'Only entries sitting in this folder inside the compendium',
            },
            limit: {
              type: 'number',
              description: 'How many entries to return, default 200, at most 1000',
            },
            offset: {
              type: 'number',
              description: 'Skip this many entries — use with hasMore to page through a large pack',
            },
          },
          required: ['packId'],
        },
      },
      {
        name: 'delete-compendium-entries',
        description:
          'Remove named entries from a compendium — by id, or by exact name. Only what is explicitly named is removed; there is deliberately no "empty this pack". Always run with dryRun first: it reports exactly what would go, what was not found, and which names are ambiguous, without touching anything. Names are matched exactly, never as a substring, and an ambiguous name is reported rather than guessed. If the selection happens to cover every entry in the pack, confirmLabel is required as well. Needs the compendium permission on "create, edit and delete".',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Compendium id' },
            ids: {
              type: 'array',
              description: 'Ids of the entries to remove — get them from list-compendium-entries',
              items: { type: 'string' },
            },
            names: {
              type: 'array',
              description: 'Exact names, as an alternative to ids. Ambiguous names are reported.',
              items: { type: 'string' },
            },
            unlockIfNeeded: {
              type: 'boolean',
              description: 'Lift the lock for this operation only and restore it afterwards',
            },
            dryRun: {
              type: 'boolean',
              description: 'Report what would happen and change nothing. Use this first.',
            },
            confirmLabel: {
              type: 'string',
              description:
                'Only needed when the selection covers every entry in the pack — then it must be the exact label',
            },
          },
          required: ['packId'],
        },
      },
      {
        name: 'delete-compendium',
        description:
          'Remove a world compendium and everything in it. This cannot be undone, so it is off by default: the module setting for compendiums has to stand on "create, edit and delete". The exact label must be passed as confirmLabel. Compendiums belonging to a module or to the game system cannot be removed this way.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Compendium id, e.g. world.archiv-salzmarsch' },
            confirmLabel: {
              type: 'string',
              description: 'The exact label of the compendium, guarding against a mistyped id',
            },
          },
          required: ['packId', 'confirmLabel'],
        },
      },
      {
        name: 'export-to-compendium',
        description:
          'Copy documents from the world into a compendium, to archive finished material. Select what to copy by name or by the folder they sit in; without either, everything of that type is copied. A locked compendium is refused unless unlockIfNeeded is set, in which case the lock is lifted for this operation only and restored afterwards.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Target compendium id' },
            documentType: {
              type: 'string',
              description: 'JournalEntry, Scene, Actor, RollTable, Playlist, Item or Macro',
            },
            names: {
              type: 'array',
              description: 'Names or ids to copy. Omit to take everything of that type.',
              items: { type: 'string' },
            },
            folderName: { type: 'string', description: 'Only documents sitting in this folder' },
            unlockIfNeeded: {
              type: 'boolean',
              description: 'Lift the lock for this operation and restore it afterwards',
            },
          },
          required: ['packId', 'documentType'],
        },
      },
      {
        name: 'set-compendium-lock',
        description:
          'Lock or unlock a compendium. Which ones may be touched follows the module settings: by default every unlocked compendium, or only the ones listed under writable compendiums if that field has been filled in.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Compendium id' },
            locked: { type: 'boolean', description: 'true locks, false unlocks' },
          },
          required: ['packId', 'locked'],
        },
      },
      {
        name: 'organize-compendium',
        description:
          'Sort entries of a compendium into a folder, creating the folder if needed. Use this to bring order into an archive that has grown. Same lock rules as export-to-compendium.',
        inputSchema: {
          type: 'object',
          properties: {
            packId: { type: 'string', description: 'Compendium id' },
            folderName: { type: 'string', description: 'Folder to move the entries into' },
            entryNames: {
              type: 'array',
              description: 'Names of the entries to move',
              items: { type: 'string' },
            },
            unlockIfNeeded: { type: 'boolean' },
          },
          required: ['packId', 'folderName', 'entryNames'],
        },
      },
      {
        name: 'refresh-scene-thumb',
        description:
          'Regenerate the thumbnail of a scene. After swapping a background the sidebar keeps showing the old picture until this runs.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneIdentifier: { type: 'string', description: 'Scene name or id' },
          },
          required: ['sceneIdentifier'],
        },
      },
    ];
  }

  async handleListPlaylists(args: any): Promise<any> {
    const schema = z.object({ includeSounds: z.boolean().optional() });
    const params = schema.parse(args ?? {});

    const result = await this.foundryClient.query('ninjos-foundry-mcp.listPlaylists', params);

    if (!result?.playlists?.length) {
      return { content: [{ type: 'text', text: 'No playlists in this world.' }] };
    }

    const text = result.playlists
      .map((p: any) => {
        const head = `${p.name}  (${p.soundCount} tracks, id ${p.id})`;
        if (!p.sounds?.length) return head;
        return head + '\n' + p.sounds.map((s: any) => `    ${s.name}  [${s.id}]`).join('\n');
      })
      .join('\n');

    return { content: [{ type: 'text', text }] };
  }

  async handleImportFromCompendium(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      entryName: z.string().optional(),
      entryId: z.string().optional(),
      newName: z.string().optional(),
      folderPath: z.string().optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Importing from compendium', params);

    const result = await this.foundryClient.query(
      'ninjos-foundry-mcp.importFromCompendium',
      params
    );

    return {
      content: [
        {
          type: 'text',
          text: `${result.type} "${result.name}" imported from ${result.pack}.\nNew id: ${result.id}`,
        },
      ],
    };
  }

  async handleSetScenePlaylist(args: any): Promise<any> {
    const schema = z.object({
      sceneIdentifier: z.string().min(1),
      playlistName: z.string().nullable().optional(),
      soundName: z.string().nullable().optional(),
    });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.setScenePlaylist', params);

    const text = result.playlist
      ? `Scene "${result.scene}": playlist "${result.playlist}"${
          result.sound ? `, track "${result.sound}"` : ''
        }`
      : `Scene "${result.scene}": link removed`;

    return { content: [{ type: 'text', text }] };
  }

  async handleListRollTables(): Promise<any> {
    const result = await this.foundryClient.query('ninjos-foundry-mcp.listRollTables');

    if (!result?.tables?.length) {
      return { content: [{ type: 'text', text: 'No roll tables in this world.' }] };
    }

    const text = result.tables
      .map((t: any) => `${t.name}  (${t.formula}, ${t.resultCount} entries, id ${t.id})`)
      .join('\n');

    return { content: [{ type: 'text', text }] };
  }

  async handleCreateRollTable(args: any): Promise<any> {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      formula: z.string().optional(),
      folderPath: z.string().optional(),
      results: z
        .array(
          z.object({
            text: z.string().min(1),
            range: z.array(z.number()).length(2).optional(),
            weight: z.number().optional(),
          })
        )
        .min(1),
    });
    const params = schema.parse(args);
    this.logger.info('Creating roll table', { name: params.name });

    const result = await this.foundryClient.query('ninjos-foundry-mcp.createRollTable', params);

    return {
      content: [
        {
          type: 'text',
          text: `Roll table "${result.name}" created (${result.formula}, ${result.resultCount} entries)\nId: ${result.id}`,
        },
      ],
    };
  }

  async handleCreateSceneNote(args: any): Promise<any> {
    const schema = z.object({
      sceneIdentifier: z.string().min(1),
      journalName: z.string().min(1),
      pageName: z.string().optional(),
      x: z.number(),
      y: z.number(),
      label: z.string().optional(),
      icon: z.string().optional(),
      iconSize: z.number().optional(),
    });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.createSceneNote', params);

    return {
      content: [
        {
          type: 'text',
          text: `Note placed on "${result.scene}": "${result.journal}" at ${result.x}/${result.y}`,
        },
      ],
    };
  }

  async handleGetPermissions(): Promise<any> {
    const result = await this.foundryClient.query('ninjos-foundry-mcp.getPermissions');

    const head = result.writeOperationsEnabled
      ? 'Writing is permitted in principle.'
      : 'CAUTION: "Allow Write Operations" is off, the AI changes nothing at all.';

    const rows = result.permissions
      .map((p: any) => {
        const level =
          p.level === 'full'
            ? 'create, change, delete'
            : p.level === 'write'
              ? 'create, change'
              : 'read only';
        return `${p.label.padEnd(18)} ${level}`;
      })
      .join('\n');

    return { content: [{ type: 'text', text: `${head}\n\n${rows}` }] };
  }

  async handleDeletePlaylist(args: any): Promise<any> {
    const schema = z.object({ playlistId: z.string().min(1) });
    const params = schema.parse(args);
    const result = await this.foundryClient.query('ninjos-foundry-mcp.deletePlaylist', params);
    return { content: [{ type: 'text', text: `Playlist "${result.name}" deleted.` }] };
  }

  async handleDeleteRollTable(args: any): Promise<any> {
    const schema = z.object({ tableId: z.string().min(1) });
    const params = schema.parse(args);
    const result = await this.foundryClient.query('ninjos-foundry-mcp.deleteRollTable', params);
    return { content: [{ type: 'text', text: `Roll table "${result.name}" deleted.` }] };
  }

  async handleListCompendiums(): Promise<any> {
    const result = await this.foundryClient.query('ninjos-foundry-mcp.listCompendiums');
    const packs = result?.compendiums ?? [];

    if (!packs.length) {
      return { content: [{ type: 'text', text: 'No compendiums present.' }] };
    }

    const open = packs.filter((p: any) => p.writable);
    const locked = packs.filter((p: any) => !p.writable);

    const line = (p: any) => `  ${p.label}  [${p.id}]  ${p.type}, ${p.entries} entries`;

    const parts: string[] = [];
    if (open.length) {
      parts.push(`Unlocked, so editable (${open.length}):`);
      parts.push(open.map(line).join('\n'));
    }
    if (locked.length) {
      parts.push('');
      parts.push(`Locked (${locked.length}), unlock before editing:`);
      parts.push(locked.map(line).join('\n'));
    }

    return { content: [{ type: 'text', text: parts.join('\n') }] };
  }

  async handleCreateCompendium(args: any): Promise<any> {
    const schema = z.object({ label: z.string().min(1), type: z.string().min(1) });
    const params = schema.parse(args);
    this.logger.info('Creating compendium', params);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.createCompendium', params);
    return {
      content: [
        {
          type: 'text',
          text: `Compendium "${result.label}" created (${result.type})\nId: ${result.id}`,
        },
      ],
    };
  }

  async handleDeleteCompendiumEntries(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      ids: z.array(z.string()).optional(),
      names: z.array(z.string()).optional(),
      unlockIfNeeded: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      confirmLabel: z.string().optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Deleting compendium entries', {
      pack: params.packId,
      dryRun: params.dryRun === true,
    });

    const result = await this.foundryClient.query(
      'ninjos-foundry-mcp.deleteCompendiumEntries',
      params
    );

    const parts: string[] = [];
    if (result.dryRun) {
      parts.push(
        `Dry run for "${result.label}": ${result.wouldDelete} of ${result.totalInPack} ` +
          `entries would be removed. Nothing was changed.`
      );
    } else {
      parts.push(
        `Removed from "${result.label}": ${result.deleted} entries. ` +
          `${result.totalInPack} remain in the compendium.`
      );
    }

    if (result.entries?.length) {
      const shown = result.entries.slice(0, 25);
      parts.push('\n' + shown.map((e: any) => `  ${e.name}  ${e.id}`).join('\n'));
      if (result.entries.length > shown.length) {
        parts.push(`  ... and ${result.entries.length - shown.length} more`);
      }
    }

    // What was not found and what was ambiguous belongs plainly in the answer.
    // Reported only in a field, the operation easily counts as fully done even
    // though half of it never matched anything.
    if (result.notFound?.length) {
      parts.push(`\nNot found (${result.notFound.length}): ${result.notFound.join(', ')}`);
    }
    if (result.ambiguous?.length) {
      parts.push(
        `\nAmbiguous, therefore skipped:\n` +
          result.ambiguous
            .map((m: any) => `  "${m.name}" occurs ${m.ids.length}x: ${m.ids.join(', ')}`)
            .join('\n') +
          `\nUse ids here instead of names.`
      );
    }

    return { content: [{ type: 'text', text: parts.join('\n') }] };
  }

  async handleListCompendiumEntries(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      namePattern: z.string().optional(),
      folderName: z.string().optional(),
      limit: z.number().int().positive().max(1000).optional(),
      offset: z.number().int().min(0).optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Listing compendium entries', { pack: params.packId });

    const result = await this.foundryClient.query(
      'ninjos-foundry-mcp.listCompendiumEntries',
      params
    );

    const head =
      `Compendium "${result.label}" (${result.documentType}, ${result.packageType}` +
      `${result.locked ? ', locked' : ''}): ${result.total} entries` +
      (result.total !== result.returned
        ? `, showing ${result.returned} from position ${result.offset}`
        : '');

    const lines = result.entries.map(
      (e: any) =>
        `  ${e.name ?? '(no name)'}${e.type ? ` [${e.type}]` : ''}` +
        `${e.folder ? ` — folder: ${e.folder}` : ''}  ${e.id}`
    );

    // The hasMore hint belongs in the text, not only in the field: otherwise a
    // first page gets taken for the whole stock — the same wrong conclusion that
    // once discarded a finished export.
    const foot = result.hasMore
      ? `\n\nThere are more entries. Next page with offset: ${result.offset + result.returned}`
      : '';

    return {
      content: [
        {
          type: 'text',
          text: `${head}\n\n${lines.join('\n')}${foot}`,
        },
      ],
    };
  }

  async handleDeleteCompendium(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      confirmLabel: z.string().min(1),
    });
    const params = schema.parse(args);
    this.logger.info('Deleting compendium', { pack: params.packId });

    const result = await this.foundryClient.query('ninjos-foundry-mcp.deleteCompendium', params);
    return {
      content: [
        {
          type: 'text',
          text: `Compendium "${result.label}" deleted, with ${result.entries} entries.`,
        },
      ],
    };
  }

  async handleExportToCompendium(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      documentType: z.string().min(1),
      names: z.array(z.string()).optional(),
      folderName: z.string().optional(),
      unlockIfNeeded: z.boolean().optional(),
    });
    const params = schema.parse(args);
    this.logger.info('Exporting to compendium', { pack: params.packId });

    const result = await this.foundryClient.query('ninjos-foundry-mcp.exportToCompendium', params);

    const created: string[] = result.exported ?? [];
    const replaced: string[] = result.replaced ?? [];

    const lines = [`Saved to "${result.pack}": ${created.length + replaced.length} entries`];
    if (created.length) {
      lines.push(`Newly created (${created.length}):`);
      lines.push(created.map((n: string) => `  ${n}`).join('\n'));
    }
    // Saving keeps the id, so an existing entry is overwritten rather than
    // duplicated. Without this note one wonders why the count in the compendium
    // stays the same.
    if (replaced.length) {
      lines.push(`Overwrote the existing version (${replaced.length}):`);
      lines.push(replaced.map((n: string) => `  ${n}`).join('\n'));
    }
    if (result.skipped?.length) {
      lines.push(`Skipped: ${result.skipped.join(', ')}`);
    }
    // The serious case: while replacing, the old entry was already removed and
    // writing the new one then failed. That belongs plainly in the answer and
    // not under "skipped", because here a version may be missing.
    if (result.lost?.length) {
      lines.push(
        `\nCAUTION - aborted while replacing (${result.lost.length}): ` +
          `${result.lost.join(', ')}\n` +
          `For these entries the previous version was removed but the new one was not ` +
          `written. Check with list-compendium-entries and save them again individually.`
      );
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  async handleSetCompendiumLock(args: any): Promise<any> {
    const schema = z.object({ packId: z.string().min(1), locked: z.boolean() });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.setCompendiumLock', params);
    return {
      content: [
        {
          type: 'text',
          text: `"${result.pack}" is now ${result.locked ? 'locked' : 'unlocked'}.`,
        },
      ],
    };
  }

  async handleOrganizeCompendium(args: any): Promise<any> {
    const schema = z.object({
      packId: z.string().min(1),
      folderName: z.string().min(1),
      entryNames: z.array(z.string()).min(1),
      unlockIfNeeded: z.boolean().optional(),
    });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.organizeCompendium', params);
    return {
      content: [
        {
          type: 'text',
          text:
            `Moved in "${result.pack}" to "${result.folder}": ` +
            `${result.moved.length} entries${result.moved.length ? '\n  ' + result.moved.join('\n  ') : ''}`,
        },
      ],
    };
  }

  async handleRefreshSceneThumb(args: any): Promise<any> {
    const schema = z.object({ sceneIdentifier: z.string().min(1) });
    const params = schema.parse(args);

    const result = await this.foundryClient.query('ninjos-foundry-mcp.refreshSceneThumb', params);

    return {
      content: [
        {
          type: 'text',
          text: result.updated
            ? `Thumbnail of "${result.scene}" renewed.`
            : `Thumbnail of "${result.scene}" could not be generated.`,
        },
      ],
    };
  }
}
