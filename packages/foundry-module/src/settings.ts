import { MODULE_ID, DEFAULT_CONFIG } from './constants.js';
import type { BridgeConfig } from './socket-bridge.js';
import { melde } from './meldungen.js';

export class ModuleSettings {
  private moduleId: string = MODULE_ID;

  /**
   * Register all module settings with Foundry
   */
  registerSettings(): void {
    // ============================================================================
    // SETTINGS MENU - Detailed Configuration Dialog
    // ============================================================================

    // Enhanced Creature Index submenu
    (game.settings as any).registerMenu(this.moduleId, 'enhancedIndexMenu', {
      name: 'ninjos-foundry-mcp.menus.enhancedIndexMenu.name',
      label: 'ninjos-foundry-mcp.menus.enhancedIndexMenu.label',
      hint: 'ninjos-foundry-mcp.menus.enhancedIndexMenu.hint',
      icon: 'fas fa-search-plus',
      type: class extends FormApplication {
        static get defaultOptions() {
          return foundry.utils.mergeObject(super.defaultOptions, {
            // NINJO: Marke am Fensterrahmen - daran erkennt fensterpassen.js unsere Fenster.
            classes: [MODULE_ID],
            title: game.i18n.localize(`${MODULE_ID}.index.window`),
            template: `modules/${MODULE_ID}/templates/enhanced-index-menu.html`,
            width: 560,
            height: 'auto',
            resizable: true, // NINJO: used to be fixed, which cut the content off
            closeOnSubmit: false,
          } as any);
        }

        getData(): any {
          return {
            enableEnhancedCreatureIndex: game.settings.get(
              MODULE_ID,
              'enableEnhancedCreatureIndex'
            ),
            autoRebuildIndex: game.settings.get(MODULE_ID, 'autoRebuildIndex'),
          };
        }

        activateListeners(html: JQuery) {
          super.activateListeners(html);
          html.find('.rebuild-index-btn').click(() => {
            const bridge = (globalThis as any).foundryMCPBridge;
            if (bridge?.dataAccess?.rebuildEnhancedCreatureIndex) {
              melde.info('indexRebuilding', 'Rebuilding the creature index…');
              bridge.dataAccess.rebuildEnhancedCreatureIndex();
            }
          });
        }

        async _updateObject(_event: Event, formData: any) {
          await game.settings.set(
            MODULE_ID,
            'enableEnhancedCreatureIndex',
            formData.enableEnhancedCreatureIndex
          );
          await game.settings.set(MODULE_ID, 'autoRebuildIndex', formData.autoRebuildIndex);
        }
      },
      restricted: true,
    });

    // NINJO EXTENSION: release compendiums by ticking them
    (game.settings as any).registerMenu(this.moduleId, 'compendiumAccessMenu', {
      name: 'ninjos-foundry-mcp.compendiumAccess.name',
      label: 'ninjos-foundry-mcp.compendiumAccess.label',
      hint: 'ninjos-foundry-mcp.compendiumAccess.hint',
      icon: 'fas fa-book-open',
      type: class extends FormApplication {
        static get defaultOptions() {
          return foundry.utils.mergeObject(super.defaultOptions, {
            // NINJO: Marke am Fensterrahmen - daran erkennt fensterpassen.js unsere Fenster.
            classes: [MODULE_ID],
            title: game.i18n.localize(`${MODULE_ID}.compendiumAccess.window`),
            template: `modules/${MODULE_ID}/templates/compendium-access.html`,
            width: 620,
            height: 'auto',
            resizable: true,
            closeOnSubmit: true,
          } as any);
        }

        getData(): any {
          const raw = (game.settings.get(MODULE_ID, 'writableCompendiums') as string) || '';
          const released = raw
            .split(/[,\n;]/)
            .map((e: string) => e.trim())
            .filter(Boolean);

          const packs = Array.from((game.packs as any) ?? []) as any[];

          // NINJO: one block per origin, and for modules one per module.
          //
          // There used to be only three blocks — world, modules, system. All
          // module compendiums sat in one pot and were sorted by label there, so
          // that "BBMM Journal", "Bestiarium" from ninjo-kompendium and "Klassen"
          // from dnd-players-handbook stood mixed together. Anyone wanting to
          // release one particular module had to collect the entries. Now every
          // module carries its own block under its own title.
          const groups = new Map<string, any>();

          const groupFor = (key: string, label: string, order: number) => {
            if (!groups.has(key)) {
              groups.set(key, { label: label, order, packs: [] });
            }
            return groups.get(key);
          };

          for (const p of packs) {
            const packageKind = (p.metadata?.packageType as string) || 'module';
            const origin = (p.metadata?.packageName as string) || '';
            const id = p.collection as string;

            let target;
            if (packageKind === 'world') {
              target = groupFor(
                'world',
                game.i18n.localize(`${MODULE_ID}.compendiumAccess.groupWorld`),
                0
              );
            } else if (packageKind === 'system') {
              target = groupFor(
                'system',
                game.i18n.localize(`${MODULE_ID}.compendiumAccess.groupSystem`),
                2
              );
            } else {
              // The module's title rather than its id: "Ninjos Kompendium" reads
              // better than "ninjo-kompendium". If the module cannot be found, the
              // id stays as a fallback.
              const mod = (game.modules as any)?.get?.(origin);
              const title = mod?.title || origin || id;
              target = groupFor(`module:${origin}`, title, 1);
            }

            target.packs.push({
              id,
              label: p.metadata?.label ?? p.title ?? id,
              type: p.documentName,
              entries: p.index?.size ?? 0,
              locked: p.locked === true,
              selected: released.includes(id) || released.includes(origin),
            });
          }

          const sorted = Array.from(groups.values())
            .filter((g: any) => g.packs.length)
            // The world first, then the modules by title, the game system last.
            // What belongs to you stands at the top.
            .sort((a: any, b: any) =>
              a.order !== b.order
                ? a.order - b.order
                : String(a.label).localeCompare(String(b.label))
            );

          for (const g of sorted) {
            g.packs.sort((a: any, b: any) => String(a.label).localeCompare(String(b.label)));
          }

          return {
            allowAllUnlocked: released.length === 0,
            groups: sorted,
          };
        }

        // NINJO: the two entries exclude each other, but the form let both be
        // set at once. Anyone ticking compendiums below and leaving the tick at
        // the top lost their selection on save without a word — _updateObject
        // sees "allow everything" first and returns before it ever reads the
        // selection. On the next open nothing was ticked, and nowhere did it say
        // why.
        //
        // Hence this: both at once is no longer possible. Ticking a compendium
        // means a selection; ticking the top box means all of them.
        activateListeners(html: JQuery) {
          super.activateListeners(html);

          const allBox = html.find('input[name="__allowAllUnlocked"]');
          const packs = html.find('input[name^="pack."]');
          const list = html.find('.mcp-pack-list');

          const dim = () => list.toggleClass('mcp-dimmed', allBox.prop('checked') === true);

          allBox.on('change', () => {
            if (allBox.prop('checked')) packs.prop('checked', false);
            dim();
          });

          packs.on('change', function (this: HTMLInputElement) {
            if (this.checked) allBox.prop('checked', false);
            dim();
          });

          dim();
        }

        async _updateObject(_event: Event, formData: any): Promise<void> {
          // NINJO: in the template the checkboxes are named "pack.<id>", and a
          // pack id contains a dot itself ("ninjo-kompendium.presets"). Foundry
          // expands field names with dots into nested objects before this method
          // sees them — so what arrives here is
          //
          //   { pack: { 'ninjo-kompendium': { presets: true } } }
          //
          // and not the flat key. The search for keys starting with "pack."
          // that used to stand here therefore never found anything: an empty list
          // was stored every time, and on the next open every tick was gone
          // again. Worse still, an empty list means "every unlocked compendium is
          // released" — so the restriction silently turned into its opposite.
          //
          // flattenObject undoes that expansion. It is harmless should Foundry
          // one day hand the data over flat.
          const flat = (foundry as any).utils.flattenObject(formData) as Record<string, unknown>;

          const chosen = Object.entries(flat)
            .filter(([k, v]) => k.startsWith('pack.') && v === true)
            .map(([k]) => k.slice('pack.'.length));

          // A selection that was made beats "allow everything". The check on
          // __allowAllUnlocked used to stand right at the top and returned at
          // once — whoever ticked below and left the top tick standing lost the
          // selection without a word. The other way round is right: naming
          // individual compendiums is a deliberate act.
          if (!chosen.length && formData?.__allowAllUnlocked === true) {
            await game.settings.set(MODULE_ID, 'writableCompendiums', '');
            ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.compendiumAccess.savedAll`));
            return;
          }

          await game.settings.set(MODULE_ID, 'writableCompendiums', chosen.join(', '));
          ui.notifications?.info(
            game.i18n.format(`${MODULE_ID}.compendiumAccess.savedSome`, {
              count: chosen.length,
            })
          );
        }
      },
      restricted: true,
    });

    // Map Generation Service submenu
    (game.settings as any).registerMenu(this.moduleId, 'mapGenerationSettings', {
      name: 'ninjos-foundry-mcp.menus.mapGenerationSettings.name',
      label: 'ninjos-foundry-mcp.menus.mapGenerationSettings.label',
      hint: 'ninjos-foundry-mcp.menus.mapGenerationSettings.hint',
      icon: 'fas fa-cogs',
      type: class extends FormApplication {
        static get defaultOptions() {
          return foundry.utils.mergeObject(super.defaultOptions, {
            // NINJO: Marke am Fensterrahmen - daran erkennt fensterpassen.js unsere Fenster.
            classes: [MODULE_ID],
            title: game.i18n.localize(`${MODULE_ID}.mapgen.window`),
            template: `modules/${MODULE_ID}/templates/comfyui-settings.html`,
            width: 560,
            height: 'auto',
            resizable: true, // NINJO: used to be fixed, which cut the content off
            closeOnSubmit: false,
          } as any);
        }

        getData(): any {
          return {
            autoStartService: game.settings.get(MODULE_ID, 'mapGenAutoStart') ?? false,
            // NINJO: this used to be "|| true". In JavaScript false || true is
            // true, so a stored "off" turned back into "on" when displayed and was
            // written back on save. The tick could not be removed.
            mapGenQuality: game.settings.get(MODULE_ID, 'mapGenQuality') ?? 'low',
            connectionStatus: this.getConnectionStatus(),
            connectionStatusText: this.getConnectionStatusText(),
          };
        }

        getConnectionStatus(): string {
          const bridge = (globalThis as any).foundryMCPBridge;
          return bridge?.comfyuiManager ? 'unknown' : 'stopped';
        }

        getConnectionStatusText(): string {
          return 'Click "Check Status" to verify service';
        }

        activateListeners(html: JQuery) {
          super.activateListeners(html);

          // Service control buttons
          html.find('#check-status-btn').click(async () => {
            await this.checkServiceStatus();
          });

          html.find('#start-service-btn').click(async () => {
            await this.startService();
          });

          html.find('#stop-service-btn').click(async () => {
            await this.stopService();
          });
        }

        async checkServiceStatus() {
          const bridge = (globalThis as any).foundryMCPBridge;
          if (bridge?.comfyuiManager) {
            try {
              const status = await bridge.comfyuiManager.checkStatus();
              this.updateStatusDisplay(status);
            } catch (error) {
              console.error('Status check failed:', error);
              this.updateStatusDisplay({ status: 'error', message: 'Status check failed' });
            }
          }
        }

        async startService() {
          const bridge = (globalThis as any).foundryMCPBridge;
          if (bridge?.comfyuiManager) {
            try {
              const result = await bridge.comfyuiManager.startService();
              this.updateStatusDisplay(result);
            } catch (error) {
              console.error('Service start failed:', error);
              this.updateStatusDisplay({ status: 'error', message: 'Service start failed' });
            }
          }
        }

        async stopService() {
          const bridge = (globalThis as any).foundryMCPBridge;
          if (bridge?.comfyuiManager) {
            try {
              const result = await bridge.comfyuiManager.stopService();
              this.updateStatusDisplay(result);
            } catch (error) {
              console.error('Service stop failed:', error);
              this.updateStatusDisplay({ status: 'error', message: 'Service stop failed' });
            }
          }
        }

        updateStatusDisplay(status: any) {
          const statusElement = this.element.find('#connection-status');
          const statusText = this.element.find('#status-text');

          // Remove all status classes
          statusElement.removeClass('running stopped starting error unknown');

          // Add current status class
          statusElement.addClass(status.status);
          statusText.text(this.getStatusText(status.status));
        }

        getStatusText(status: string): string {
          const statusMap: { [key: string]: string } = {
            running: 'Service Running',
            stopped: 'Service Stopped',
            starting: 'Service Starting...',
            error: 'Service Error',
            unknown: 'Status Unknown',
          };
          return statusMap[status] || 'Unknown';
        }

        async _updateObject(_event: Event, formData: any) {
          await game.settings.set(MODULE_ID, 'mapGenAutoStart', formData.autoStartService);
          await game.settings.set(MODULE_ID, 'mapGenQuality', formData.mapGenQuality);
          melde.info('mapgenSaved', 'Map generation settings saved.');
        }
      },
      restricted: true,
    });

    // ============================================================================
    // SECTION 1: BASIC SETTINGS
    // ============================================================================

    game.settings.register(this.moduleId, 'enabled', {
      name: 'ninjos-foundry-mcp.settings.enabled.name',
      hint: 'ninjos-foundry-mcp.settings.enabled.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
      onChange: this.onEnabledChange.bind(this),
    });

    game.settings.register(this.moduleId, 'connectionType', {
      name: 'ninjos-foundry-mcp.settings.connectionType.name',
      hint: 'ninjos-foundry-mcp.settings.connectionType.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        auto: 'ninjos-foundry-mcp.settings.connectionType.choices.auto',
        webrtc: 'ninjos-foundry-mcp.settings.connectionType.choices.webrtc',
        websocket: 'ninjos-foundry-mcp.settings.connectionType.choices.websocket',
      },
      default: 'auto',
      onChange: this.onConnectionChange.bind(this),
    });

    game.settings.register(this.moduleId, 'serverHost', {
      name: 'ninjos-foundry-mcp.settings.serverHost.name',
      hint: 'ninjos-foundry-mcp.settings.serverHost.hint',
      scope: 'world',
      config: true,
      type: String,
      default: DEFAULT_CONFIG.MCP_HOST,
      onChange: this.onConnectionChange.bind(this),
    });

    game.settings.register(this.moduleId, 'serverPort', {
      name: 'ninjos-foundry-mcp.settings.serverPort.name',
      hint: 'ninjos-foundry-mcp.settings.serverPort.hint',
      scope: 'world',
      config: false,
      type: Number,
      default: DEFAULT_CONFIG.MCP_PORT,
      onChange: this.onConnectionChange.bind(this),
    });

    // ============================================================================
    // SECTION 2: WRITE PERMISSIONS
    // ============================================================================

    game.settings.register(this.moduleId, 'allowWriteOperations', {
      name: 'ninjos-foundry-mcp.settings.allowWriteOperations.name',
      hint: 'ninjos-foundry-mcp.settings.allowWriteOperations.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    // ============================================================================
    // NINJO EXTENSION: permissions per document kind
    //
    // Instead of one switch for everything, each document kind can be chosen
    // separately, in three levels. Deleting is off everywhere by default, because
    // it is the one action that cannot be undone. Anyone wanting to let the AI
    // tidy up releases exactly what it may touch.
    //
    // The overarching "Allow Write Operations" switch stays in front of all of
    // this: with it off the AI changes nothing at all, whatever these levels say.
    // ============================================================================

    game.settings.register(this.moduleId, 'permScenes', {
      name: 'ninjos-foundry-mcp.settings.permScenes.name',
      hint: 'ninjos-foundry-mcp.settings.permScenes.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permScenes.choices.read',
        write: 'ninjos-foundry-mcp.settings.permScenes.choices.write',
        full: 'ninjos-foundry-mcp.settings.permScenes.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permPlaylists', {
      name: 'ninjos-foundry-mcp.settings.permPlaylists.name',
      hint: 'ninjos-foundry-mcp.settings.permPlaylists.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permPlaylists.choices.read',
        write: 'ninjos-foundry-mcp.settings.permPlaylists.choices.write',
        full: 'ninjos-foundry-mcp.settings.permPlaylists.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permJournals', {
      name: 'ninjos-foundry-mcp.settings.permJournals.name',
      hint: 'ninjos-foundry-mcp.settings.permJournals.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permJournals.choices.read',
        write: 'ninjos-foundry-mcp.settings.permJournals.choices.write',
        full: 'ninjos-foundry-mcp.settings.permJournals.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permRollTables', {
      name: 'ninjos-foundry-mcp.settings.permRollTables.name',
      hint: 'ninjos-foundry-mcp.settings.permRollTables.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permRollTables.choices.read',
        write: 'ninjos-foundry-mcp.settings.permRollTables.choices.write',
        full: 'ninjos-foundry-mcp.settings.permRollTables.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permActors', {
      name: 'ninjos-foundry-mcp.settings.permActors.name',
      hint: 'ninjos-foundry-mcp.settings.permActors.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permActors.choices.read',
        write: 'ninjos-foundry-mcp.settings.permActors.choices.write',
        full: 'ninjos-foundry-mcp.settings.permActors.choices.full',
      },
      default: 'write',
    });

    // NINJO: Which other modules may register MCP tools of their own.
    //
    // Empty by default, and that is deliberate: a third-party handler works
    // around this module's permission matrix. Listing a module here grants it
    // the same reach the model has.
    //
    // Called werkzeugModule in 14.2609.2. The old key stays registered so a
    // world that filled it does not lose the list; extension-tools.ts reads it
    // as a fallback and carries it over on the next start.
    game.settings.register(this.moduleId, 'toolProviderModules', {
      name: `${MODULE_ID}.settings.toolProviderModules.name`,
      hint: `${MODULE_ID}.settings.toolProviderModules.hint`,
      scope: 'world',
      config: true,
      type: String,
      default: '',
    });

    // The old name from 14.2609.2, kept only so the migration path can read it.
    game.settings.register(this.moduleId, 'werkzeugModule', {
      name: 'werkzeugModule',
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    game.settings.register(this.moduleId, 'writableCompendiums', {
      name: 'ninjos-foundry-mcp.settings.writableCompendiums.name',
      hint: 'ninjos-foundry-mcp.settings.writableCompendiums.hint',
      scope: 'world',
      config: false, // NINJO: maintained through the "Release compendiums" menu
      type: String,
      default: '',
    });

    game.settings.register(this.moduleId, 'permCompendiums', {
      name: 'ninjos-foundry-mcp.settings.permCompendiums.name',
      hint: 'ninjos-foundry-mcp.settings.permCompendiums.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permCompendiums.choices.read',
        write: 'ninjos-foundry-mcp.settings.permCompendiums.choices.write',
        full: 'ninjos-foundry-mcp.settings.permCompendiums.choices.full',
      },
      default: 'write',
    });

    game.settings.register(this.moduleId, 'permFolders', {
      name: 'ninjos-foundry-mcp.settings.permFolders.name',
      hint: 'ninjos-foundry-mcp.settings.permFolders.hint',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        read: 'ninjos-foundry-mcp.settings.permFolders.choices.read',
        write: 'ninjos-foundry-mcp.settings.permFolders.choices.write',
        full: 'ninjos-foundry-mcp.settings.permFolders.choices.full',
      },
      default: 'write',
    });

    // ============================================================================
    // SECTION 3: SAFETY CONTROLS - Limits on AI model's Actions
    // ============================================================================

    game.settings.register(this.moduleId, 'maxActorsPerRequest', {
      name: 'ninjos-foundry-mcp.settings.maxActorsPerRequest.name',
      hint: 'ninjos-foundry-mcp.settings.maxActorsPerRequest.hint',
      scope: 'world',
      config: true,
      type: Number,
      default: 10,
      range: {
        min: 1,
        max: 50,
        step: 1,
      },
    });

    // Removed 'enableWriteAuditLog' setting as it provides no rollback functionality
    // and only creates log entries without user-actionable features

    // Enhanced Creature Index settings (configured via submenu only)
    game.settings.register(this.moduleId, 'enableEnhancedCreatureIndex', {
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'autoRebuildIndex', {
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: Boolean,
      default: true,
    });

    // Map Generation Service settings (configured via submenu only)
    // ComfyUI always runs on localhost:31411 (same machine as MCP server)
    game.settings.register(this.moduleId, 'mapGenAutoStart', {
      name: 'ninjos-foundry-mcp.settings.mapGenAutoStart.name',
      scope: 'world',
      config: true, // NINJO: visible in the main menu, not only in the submenu
      type: Boolean,
      default: false, // NINJO: map generation only starts on an explicit request
    });

    game.settings.register(this.moduleId, 'mapGenQuality', {
      name: 'ninjos-foundry-mcp.settings.mapGenQuality.name',
      hint: 'ninjos-foundry-mcp.settings.mapGenQuality.hint',
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: String,
      choices: {
        low: 'ninjos-foundry-mcp.settings.mapGenQuality.choices.low',
        medium: 'ninjos-foundry-mcp.settings.mapGenQuality.choices.medium',
        high: 'ninjos-foundry-mcp.settings.mapGenQuality.choices.high',
      },
      default: 'low',
    });

    // ============================================================================
    // SECTION 4: CONNECTION BEHAVIOR
    // ============================================================================

    game.settings.register(this.moduleId, 'enableNotifications', {
      name: 'ninjos-foundry-mcp.settings.enableNotifications.name',
      hint: 'ninjos-foundry-mcp.settings.enableNotifications.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'autoReconnectEnabled', {
      name: 'ninjos-foundry-mcp.settings.autoReconnectEnabled.name',
      hint: 'ninjos-foundry-mcp.settings.autoReconnectEnabled.hint',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'heartbeatInterval', {
      name: 'ninjos-foundry-mcp.settings.heartbeatInterval.name',
      hint: 'ninjos-foundry-mcp.settings.heartbeatInterval.hint',
      scope: 'world',
      config: true,
      type: Number,
      default: 30,
      range: {
        min: 10,
        max: 120,
        step: 5,
      },
    });

    // Non-configurable settings for internal state
    game.settings.register(this.moduleId, 'lastConnectionState', {
      scope: 'world',
      config: false,
      type: String,
      default: 'disconnected',
    });

    game.settings.register(this.moduleId, 'lastActivity', {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    // Track when we last showed the MCP server notification to avoid spam
    game.settings.register(this.moduleId, 'lastMCPServerNotification', {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    // Roll state storage for persistent roll button states
    game.settings.register(this.moduleId, 'rollStates', {
      scope: 'world',
      config: false,
      type: Object,
      default: {},
      onChange: this.onRollStatesChanged.bind(this),
    });

    // Button to message ID mapping for ChatMessage updates
    game.settings.register(this.moduleId, 'buttonMessageMap', {
      scope: 'world',
      config: false,
      type: Object,
      default: {},
    });
  }

  /**
   * Handle roll states setting changes - fires on all clients for world-scoped settings
   */
  private onRollStatesChanged(_newValue: any): void {
    // No action needed - ChatMessage.update() handles state synchronization automatically
  }

  /**
   * Update connection status display in settings
   */
  updateConnectionStatusDisplay(connected: boolean, _toolCount: number): void {
    try {
      const statusText = connected
        ? game.i18n.localize(`${this.moduleId}.status.connected`)
        : game.i18n.localize(`${this.moduleId}.status.disconnected`);

      /* NINJO: the setting's hint text used to serve as the base here. Since the
       * labels go through the language files, what stands there is the key and not
       * the translated text. Appending the status made it unresolvable, and the
       * menu showed "ninjos-foundry-mcp.settings.enabled.hint". So the base text is
       * now translated explicitly. */
      const base = game.i18n.localize(`${this.moduleId}.settings.enabled.hint`);
      const label = game.i18n.localize(`${this.moduleId}.status.label`);

      const enabledSetting = (game.settings as any).settings.get(`${this.moduleId}.enabled`);
      if (enabledSetting) {
        enabledSetting.hint = `${base} | ${label}: ${statusText}`;
      }
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to update status display:`, error);
    }
  }

  /**
   * Get current bridge configuration from settings
   */
  getBridgeConfig(): BridgeConfig {
    const connectionType = this.getSetting('connectionType');

    return {
      enabled: this.getSetting('enabled'),
      serverHost: this.getSetting('serverHost'),
      serverPort: this.getSetting('serverPort'),
      namespace: '/foundry-mcp', // Fixed namespace - no user configuration needed
      reconnectAttempts: DEFAULT_CONFIG.RECONNECT_ATTEMPTS, // Use sensible default
      reconnectDelay: DEFAULT_CONFIG.RECONNECT_DELAY, // Use sensible default
      connectionTimeout: DEFAULT_CONFIG.CONNECTION_TIMEOUT, // Use sensible default
      debugLogging: false, // Always false - use browser console for debugging
      connectionType: connectionType as 'auto' | 'webrtc' | 'websocket',
    };
  }

  /**
   * Get a specific setting value
   */
  getSetting(key: string): any {
    return game.settings.get(this.moduleId, key);
  }

  /**
   * Set a specific setting value
   */
  async setSetting(key: string, value: any): Promise<any> {
    return game.settings.set(this.moduleId, key, value);
  }

  /**
   * Get all settings as an object
   */
  getAllSettings(): Record<string, any> {
    const settingKeys = [
      // Basic Settings
      'enabled',
      'serverHost',
      'serverPort',
      'connectionType',
      // Permissions
      'allowWriteOperations',
      // Safety Controls
      'maxActorsPerRequest',
      // Enhanced Creature Index
      'enableEnhancedCreatureIndex',
      'autoRebuildIndex',
      // Connection Behavior
      'enableNotifications',
      'autoReconnectEnabled',
      'heartbeatInterval',
    ];

    const settings: Record<string, any> = {};
    for (const key of settingKeys) {
      settings[key] = this.getSetting(key);
    }

    return settings;
  }

  /**
   * Validate settings for consistency
   */
  validateSettings(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const host = this.getSetting('serverHost');
    if (!host || typeof host !== 'string' || host.trim().length === 0) {
      errors.push('Server host cannot be empty');
    }

    const port = this.getSetting('serverPort');
    if (!port || typeof port !== 'number' || port < 1024 || port > 65535) {
      errors.push('Server port must be between 1024 and 65535');
    }

    const maxActors = this.getSetting('maxActorsPerRequest');
    if (!maxActors || typeof maxActors !== 'number' || maxActors < 1 || maxActors > 10) {
      errors.push('Max actors per request must be between 1 and 10');
    }

    const heartbeat = this.getSetting('heartbeatInterval');
    if (!heartbeat || typeof heartbeat !== 'number' || heartbeat < 10 || heartbeat > 120) {
      errors.push('Heartbeat interval must be between 10 and 120 seconds');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Handle enabled setting change
   */
  private onEnabledChange(enabled: boolean): void {
    // Trigger bridge state change through global event
    if (window.foundryMCPBridge) {
      if (enabled) {
        window.foundryMCPBridge.start?.();
      } else {
        window.foundryMCPBridge.stop?.();
      }
    }
  }

  /**
   * Handle connection setting changes
   */
  private onConnectionChange(): void {
    // If bridge is running, restart it with new settings
    if (window.foundryMCPBridge && this.getSetting('enabled')) {
      window.foundryMCPBridge.restart?.();
    }
  }

  /**
   * Create settings migration for version updates
   */
  /**
   * Get write operation permissions
   */
  getWritePermissions(): {
    allowWriteOperations: boolean;
    maxActorsPerRequest: number;
  } {
    return {
      allowWriteOperations: this.getSetting('allowWriteOperations'),
      maxActorsPerRequest: this.getSetting('maxActorsPerRequest'),
    };
  }

  /**
   * Check if AI model is allowed to perform write operations
   */
  isWriteOperationAllowed(_operation?: string): boolean {
    // Simplified - single permission covers all write operations
    return this.getSetting('allowWriteOperations');
  }

  migrateSettings(_fromVersion: string, _toVersion: string): void {
    // Add migration logic here for future versions
    // For now, no migrations needed as this is initial version
  }

  /**
   * Reset all settings to defaults
   */
  async resetToDefaults(): Promise<void> {
    const settingKeys = [
      // Basic Settings
      'enabled',
      'serverHost',
      'serverPort',
      'connectionType',
      // Permissions
      'allowWriteOperations',
      // Safety Controls
      'maxActorsPerRequest',
      // Enhanced Creature Index
      'enableEnhancedCreatureIndex',
      'autoRebuildIndex',
      // Connection Behavior
      'enableNotifications',
      'autoReconnectEnabled',
      'heartbeatInterval',
    ];

    for (const key of settingKeys) {
      // Get the default value from the setting registration
      const setting = (game.settings as any).settings.get(`${this.moduleId}.${key}`);
      if (setting && 'default' in setting) {
        await this.setSetting(key, setting.default);
      }
    }

    melde.info('settingsReset', 'MCP bridge settings reset to their defaults.');
  }

  /**
   * Carries the settings over from the old module id `foundry-mcp-bridge`.
   *
   * Why this is needed: Foundry stores settings under the namespace of the module
   * id. With the rename to `ninjos-foundry-mcp` Foundry sees a new module, and
   * everything existing worlds had stored still hangs off the old name — server
   * address, permission matrix and the list of released compendiums would
   * otherwise be gone and would have to be set again by hand.
   *
   * The step is deliberately built so that it may run again on every world start:
   * it overwrites no value already stored under the new id, and it does not touch
   * the old namespace.
   */
  async carryOldSettingsOver(): Promise<number> {
    const OLD_MODULE_ID = 'foundry-mcp-bridge';

    // Only the GM may write world settings
    if (!game.user?.isGM) return 0;

    let carried = 0;

    for (const scope of ['world', 'client'] as const) {
      const storage = (game.settings as any).storage?.get(scope);
      if (!storage) continue;

      // The world storage is a collection of setting documents, the client
      // storage is localStorage. The two are read differently.
      let entries: Array<{ key: string; value: string }> = [];
      try {
        entries =
          scope === 'world'
            ? Array.from(storage as any).map((s: any) => ({ key: s.key, value: s.value }))
            : Object.keys(storage)
                .filter(k => k.startsWith(`${OLD_MODULE_ID}.`))
                .map(k => ({ key: k, value: storage.getItem(k) }));
      } catch (error) {
        console.warn(`[${MODULE_ID}] Storage "${scope}" not readable:`, error);
        continue;
      }

      for (const entry of entries) {
        if (!entry.key?.startsWith(`${OLD_MODULE_ID}.`)) continue;
        const key = entry.key.slice(OLD_MODULE_ID.length + 1);

        // Only carry over what really exists under the new id. Orphaned keys
        // from older versions drop out that way.
        if (!(game.settings as any).settings.has(`${this.moduleId}.${key}`)) continue;

        // Do not touch a value that is already set
        if (this.hasStoredValue(scope, key)) continue;

        try {
          // Foundry stores values as JSON. Older versions stored some strings
          // raw, hence the fallback to the unchanged value.
          let value: unknown;
          try {
            value = JSON.parse(entry.value);
          } catch {
            value = entry.value;
          }
          await game.settings.set(this.moduleId, key, value as any);
          carried++;
        } catch (error) {
          console.warn(`[${MODULE_ID}] Setting "${key}" not carried over:`, error);
        }
      }
    }

    if (carried > 0) {
      console.log(`[${MODULE_ID}] Carried ${carried} settings over from "${OLD_MODULE_ID}"`);
      ui.notifications?.info(
        game.i18n.format(`${MODULE_ID}.migration.carriedOver`, { count: carried })
      );
    }

    return carried;
  }

  /**
   * Is there already a stored value for this key under the new module id?
   * A registered default does not count — only what was really stored.
   */
  private hasStoredValue(scope: 'world' | 'client', key: string): boolean {
    const storage = (game.settings as any).storage?.get(scope);
    if (!storage) return false;

    const fullKey = `${this.moduleId}.${key}`;
    try {
      return scope === 'world'
        ? Array.from(storage as any).some((s: any) => s.key === fullKey)
        : storage.getItem(fullKey) !== null;
    } catch {
      return false;
    }
  }
}
