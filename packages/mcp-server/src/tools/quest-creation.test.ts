/**
 * The quest journal tools must never write back a partial page.
 *
 * The module hands page content out in chunks (50,000 characters unless more is
 * asked for, 200,000 at most). Until 14.2609.4 link-quest-to-npc and
 * update-quest-journal read only the first chunk and wrote it back, deleting the
 * rest of any longer page. These tests simulate a module with pages far larger
 * than one chunk.
 */

import { describe, it, expect, vi } from 'vitest';
import { QuestCreationTools } from './quest-creation.js';

const GRID_START =
  '<section class="mcp-journal"><div class="wrap"><div class="grid-2">' +
  '<div><h3>Rewards &amp; Status</h3><ul><li><strong>Status:</strong> Active</li></ul></div></div>';
const LONG_FIRST_PAGE = GRID_START + 'x'.repeat(450000) + '</div></section>';

function fakeModule(
  state: { first?: string; pages: Record<string, string> },
  failLaterChunks = false
) {
  const query = vi.fn(async (method: string, data: any) => {
    const name = method.split('.').pop();

    if (name === 'getJournalContent' || name === 'getJournalPageContent') {
      const text = name === 'getJournalContent' ? state.first : state.pages[data.pageId];
      if (text === undefined) return null;
      const offset = data.offset ?? 0;
      if (failLaterChunks && offset > 0) return null;
      const max = Math.min(data.maxChars ?? 50000, 200000);
      const slice = text.slice(offset, offset + max);
      const end = offset + slice.length;
      const hasMore = end < text.length;
      return {
        content: slice,
        contentLength: text.length,
        offset,
        returned: slice.length,
        hasMore,
        ...(hasMore ? { nextOffset: end } : {}),
        name: 'Quest Details',
      };
    }

    if (name === 'updateJournalContent') {
      state.first = data.content;
      return { success: true, pageId: 'first', pageName: 'Quest Details' };
    }

    if (name === 'appendJournalPageContent') {
      state.pages[data.pageId] = (state.pages[data.pageId] ?? '') + data.html;
      return { success: true, pageId: data.pageId, newLength: state.pages[data.pageId].length };
    }

    throw new Error(`unexpected query ${method}`);
  });

  const logger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  const tools = new QuestCreationTools({ foundryClient: { query } as any, logger });
  const called = (queryName: string) =>
    query.mock.calls.some(([method]) => String(method).endsWith(`.${queryName}`));
  return { tools, query, called };
}

describe('quest journal tools keep long pages whole', () => {
  it('link-quest-to-npc writes back the entire first page', async () => {
    const state = { first: LONG_FIRST_PAGE, pages: {} };
    const { tools } = fakeModule(state);

    await tools.handleLinkQuestToNPC({ journalId: 'j1', npcName: 'Mara', relationship: 'ally' });

    expect(state.first.length).toBeGreaterThan(LONG_FIRST_PAGE.length);
    expect(state.first).toContain('x'.repeat(450000));
    expect(state.first.endsWith('</div></section>')).toBe(true);
    expect(state.first).toContain('Mara');
  });

  it('update-quest-journal on the first page keeps everything past the first chunk', async () => {
    const state = { first: LONG_FIRST_PAGE, pages: {} };
    const { tools } = fakeModule(state);

    const result = await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      newContent: 'The party found the key.',
      updateType: 'progress',
    });

    expect(state.first).toContain('x'.repeat(450000));
    expect(state.first).toContain('Progress Update');
    expect(state.first).toContain('The party found the key.');
    expect(result.verified).toBe(true);
  });

  it('update-quest-journal with a pageId appends in the module and never rewrites the page', async () => {
    const original = 'y'.repeat(300000);
    const state = { first: undefined, pages: { p2: original } };
    const { tools, called } = fakeModule(state);

    const result = await tools.handleUpdateQuestJournal({
      journalId: 'j1',
      pageId: 'p2',
      newContent: 'Second clue found.',
      updateType: 'progress',
    });

    expect(state.pages.p2.startsWith(original)).toBe(true);
    expect(state.pages.p2).toContain('Second clue found.');
    expect(called('updateJournalContent')).toBe(false);
    expect(result.verified).toBe(true);
  });

  it('writes nothing when a later chunk cannot be read', async () => {
    const state = { first: LONG_FIRST_PAGE, pages: {} };
    const { tools, called } = fakeModule(state, true);

    await expect(
      tools.handleLinkQuestToNPC({ journalId: 'j1', npcName: 'Mara', relationship: 'ally' })
    ).rejects.toThrow();

    expect(called('updateJournalContent')).toBe(false);
    expect(state.first).toBe(LONG_FIRST_PAGE);
  });
});
