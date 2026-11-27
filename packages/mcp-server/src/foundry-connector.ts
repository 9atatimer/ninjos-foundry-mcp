import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import type { Duplex } from 'stream';
import { OriginGuard, defaultOriginStoreFile } from './connection-guards.js';
import { Logger } from './logger.js';
import { Config } from './config.js';
import { WebRTCPeer } from './webrtc-peer.js';

/**
 * NINJO: How long to wait for the module to answer.
 *
 * Most queries return in milliseconds. A few work through hundreds of documents
 * and take minutes, and for those the old ten-second limit was simply the wrong
 * number: it gave up long before the work was done while the module kept going.
 * They are listed by name so that a genuinely crashed module still fails fast
 * instead of hanging for minutes on every call.
 */
const LONG_QUERIES: Record<string, number> = {
  exportToCompendium: 600000, // measured with 902 scenes: about 135 s
  deleteCompendiumEntries: 300000,
  restoreScene: 300000,
  worldRewritePaths: 300000,
  rebuildEnhancedCreatureIndex: 600000,
  getEnhancedCreatureIndex: 120000,
  listCompendiumEntries: 60000, // a pack with 1857 entries takes noticeable time
  createActors: 120000,
  importFromCompendium: 120000,
};

const DEFAULT_TIMEOUT = Number(process.env.FOUNDRY_QUERY_TIMEOUT || 30000);

function timeoutFor(method: string): number {
  // The name arrives as "ninjos-foundry-mcp.exportToCompendium"
  const short = method.includes('.') ? method.slice(method.lastIndexOf('.') + 1) : method;
  return LONG_QUERIES[short] ?? DEFAULT_TIMEOUT;
}

export interface FoundryConnectorOptions {
  config: Config['foundry'];
  logger: Logger;
}

interface PendingQuery {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class FoundryConnector {
  private wss: WebSocketServer | null = null;
  private httpServers: Server[] = [];
  private signalingServers: Server[] = []; // Separate HTTP servers for WebRTC signaling
  /** NINJO: decides which pages may use the bridge. See connection-guards.ts. */
  private originGuard: OriginGuard;
  /** NINJO: false when port 31416 was taken. The bridge runs regardless. */
  private webrtcSignalingAvailable = true;
  private logger: Logger;
  private config: Config['foundry'];
  private isStarted = false;
  private foundrySocket: WebSocket | null = null;
  private webrtcPeer: WebRTCPeer | null = null;
  private activeConnectionType: 'websocket' | 'webrtc' | null = null;
  private pendingQueries = new Map<string, PendingQuery>();
  private queryIdCounter = 0;

  constructor({ config, logger }: FoundryConnectorOptions) {
    this.config = config;
    this.logger = logger.child({ component: 'FoundryConnector' });
    this.originGuard = new OriginGuard({
      configured: config.allowedOrigins ?? [],
      storeFile: defaultOriginStoreFile(),
      logger: this.logger,
    });
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.debug('Foundry connector already started');
      return;
    }

    // NINJO: loopback unless remote mode is asked for. Both listeners used to
    // bind every interface, so any machine on the same network could reach the
    // tools without authentication. In the normal setup the browser and this
    // server share a machine; a browser elsewhere needs FOUNDRY_REMOTE_MODE=true.
    // Both loopback addresses, because browsers resolve "localhost" to ::1
    // first, and a server on 127.0.0.1 alone would depend on their fallback.
    const bindHosts = this.config.remoteMode ? ['0.0.0.0'] : ['127.0.0.1', '::1'];

    this.logger.info('Starting Foundry connector WebSocket server', {
      port: this.config.port,
      protocol: this.config.protocol || 'ws',
      remoteMode: this.config.remoteMode || false,
      bindHosts,
      origins: this.originGuard.describe(),
    });

    if (this.config.remoteMode) {
      this.logger.warn(
        'Remote mode: the bridge listens on every interface. Only the origin check ' +
          'stands between the network and the tools, so set FOUNDRY_ALLOWED_ORIGINS.'
      );
    }

    // Create WebSocket server in noServer mode to avoid request consumption
    this.wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket connections (both signaling and direct WebSocket)
    this.wss.on('connection', ws => {
      this.logger.info('Client connected via WebSocket');

      // Register the connection immediately on connect, not on first message
      // This fixes Issue #19: WebSocket handshake deadlock where both sides
      // waited for the other to send a message first
      if (!this.foundrySocket) {
        this.foundrySocket = ws;
        this.activeConnectionType = 'websocket';
        this.logger.info('Foundry module registered via WebSocket');
      }

      ws.on('close', () => {
        this.logger.info('Client disconnected');
        if (this.activeConnectionType === 'websocket' && this.foundrySocket === ws) {
          this.foundrySocket = null;
          this.activeConnectionType = null;
          // Reject all pending queries
          this.pendingQueries.forEach(({ reject, timeout }) => {
            clearTimeout(timeout);
            reject(new Error('Connection closed'));
          });
          this.pendingQueries.clear();
        }
      });

      ws.on('message', async data => {
        try {
          const message = JSON.parse(data.toString());

          // Check if this is WebRTC signaling
          if (message.type === 'webrtc-offer') {
            await this.handleWebRTCOffer(message.offer, ws);
          } else {
            // Regular WebSocket message - process it directly
            await this.handleMessage(message);
          }
        } catch (error) {
          this.logger.error('Failed to parse message', error);
        }
      });

      ws.on('error', error => {
        this.logger.error('WebSocket error', error);
      });
    });

    // NINJO: the signaling server must never be able to stop the bridge.
    //
    // A failure here used to reject, and start() gave up before it reached the
    // listener for the actual bridge port. That happened on 2026-09-06: a
    // previous backend still held 31416 for a moment, the new one hit
    // EADDRINUSE, and from then on a backend ran that offered all its tools and
    // answered every one of them with "module not connected".
    //
    // WebRTC is only the detour for a browser that refuses ws://. Losing the
    // detour costs that one case; losing the bridge costs everything.
    const WEBRTC_PORT = 31416;
    this.signalingServers = await this.listenOn(
      bindHosts,
      WEBRTC_PORT,
      'WebRTC signaling server',
      () => createServer((req, res) => void this.handleSignalingRequest(req, res)),
      false
    );
    this.webrtcSignalingAvailable = this.signalingServers.length > 0;
    if (!this.webrtcSignalingAvailable) {
      this.logger.warn(
        `The WebRTC detour on ${WEBRTC_PORT} is unavailable. The bridge itself runs on ` +
          `${this.config.port}; only a browser that refuses ws:// would have needed the detour.`
      );
    }

    this.httpServers = await this.listenOn(
      bindHosts,
      this.config.port,
      'Foundry connector',
      () => {
        const server = createServer((_req, res) => {
          res.writeHead(404);
          res.end();
        });
        server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
        return server;
      },
      true
    );

    this.isStarted = true;
    this.logger.info('Foundry connector listening', {
      port: this.config.port,
      bindHosts,
      // NINJO: stated on every start, so the log says plainly whether the
      // detour is there. Its absence is not a fault of the bridge.
      webrtcFallback: this.webrtcSignalingAvailable,
    });
  }

  /**
   * NINJO: accept a WebSocket only from the Foundry this server belongs to.
   *
   * A refused page still completes the handshake and is closed at once with
   * 4403. A refusal at the HTTP level would reach the page as a bare failure,
   * indistinguishable from a server that is not running; a close code is the
   * one thing a browser hands to the page, so the module can say what is wrong.
   * The socket is never registered, so it cannot send or receive anything.
   */
  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = req.url || '/';

    // Only upgrade if path matches WebSocket namespace
    if (pathname !== (this.config.namespace || '/') || !this.wss) {
      socket.destroy();
      return;
    }

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const decision = this.originGuard.check(origin);

    this.wss.handleUpgrade(req, socket, head, ws => {
      if (!decision.allowed) {
        this.refused('bridge', origin, decision.reason);
        ws.close(4403, 'origin not allowed');
        return;
      }
      this.wss?.emit('connection', ws, req);
    });
  }

  /**
   * NINJO: the signaling endpoint, with the origin checked.
   *
   * This used to send `Access-Control-Allow-Origin: *` to everyone. The allowed
   * origin is now echoed back, and the offer itself is refused unless the guard
   * accepts the origin. The preflight is answered for any origin: it grants
   * nothing by itself, and failing it would leave the module with a bare network
   * error instead of the 403 that explains the refusal.
   */
  private async handleSignalingRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      // Chrome asks before a public page may reach a private address.
      if (req.headers['access-control-request-private-network']) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/webrtc-offer') {
      const decision = this.originGuard.check(origin);
      if (!decision.allowed) {
        this.refused('WebRTC signaling', origin, decision.reason);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'origin not allowed' }));
        return;
      }

      try {
        await this.handleWebRTCOfferHTTP(req, res);
      } catch (error) {
        this.logger.error('WebRTC offer handling failed', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private refused(channel: string, origin: string | undefined, reason: string): void {
    this.logger.warn(`Refused a ${channel} connection`, { origin, reason });
  }

  /**
   * NINJO: open one listener per address.
   *
   * The first address is the one that matters. A missing second loopback (IPv6
   * switched off) is not a fault. A required listener that cannot open on its
   * first address fails the start, as before.
   */
  private async listenOn(
    hosts: string[],
    port: number,
    label: string,
    make: () => Server,
    required: boolean
  ): Promise<Server[]> {
    const up: Server[] = [];

    for (const [index, host] of hosts.entries()) {
      try {
        up.push(await this.listenWithRetry(make(), port, host));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;

        if (index > 0 && ['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL'].includes(code ?? '')) {
          this.logger.debug(`${label}: ${host} is not available on this machine`, { code });
          continue;
        }

        if (required && index === 0) {
          this.logger.error(`Failed to start ${label}`, error);
          await Promise.all(up.map(server => new Promise(resolve => server.close(resolve))));
          throw error;
        }

        this.logger.warn(`${label} is not listening on ${host}:${port}`, {
          code,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return up;
  }

  /**
   * NINJO: EADDRINUSE is retried for a few seconds. When a session restarts, the
   * previous backend can still hold the port for a moment while the next one
   * starts; that race is what took the bridge down on 2026-09-06.
   */
  private listenWithRetry(
    server: Server,
    port: number,
    host: string,
    attempts = 10
  ): Promise<Server> {
    return new Promise((resolve, reject) => {
      let left = attempts;

      const attempt = () => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off('listening', onListening);
          if (error.code === 'EADDRINUSE' && --left > 0) {
            setTimeout(attempt, 500);
            return;
          }
          reject(error);
        };

        const onListening = () => {
          server.off('error', onError);
          // An 'error' event without a listener would end the whole process.
          server.on('error', error =>
            this.logger.warn('Listener error', { host, port, message: error.message })
          );
          resolve(server);
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      };

      attempt();
    });
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger.info('Stopping Foundry connector...');

    // Reject all pending queries
    this.pendingQueries.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Server shutting down'));
    });
    this.pendingQueries.clear();

    if (this.foundrySocket) {
      this.foundrySocket.close();
      this.foundrySocket = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // NINJO: the signaling listeners were never closed here before.
    const servers = [...this.httpServers, ...this.signalingServers];
    await Promise.all(
      servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))
    );
    this.httpServers = [];
    this.signalingServers = [];

    this.isStarted = false;
    this.logger.info('Foundry connector stopped');
  }

  private async handleMessage(message: any): Promise<void> {
    if (message.type === 'mcp-response' && message.id) {
      const pending = this.pendingQueries.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingQueries.delete(message.id);

        if (message.data.success) {
          this.logger.debug('Query response received', {
            id: message.id,
            hasData: !!message.data.data,
          });
          pending.resolve(message.data.data);
        } else {
          this.logger.error('Query failed', { id: message.id, error: message.data.error });
          pending.reject(new Error(message.data.error || 'Query failed'));
        }
      }
      return;
    }

    if (message.type === 'pong') {
      const pending = this.pendingQueries.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingQueries.delete(message.id);
        pending.resolve(message.data);
      }
      return;
    }

    const comfyHandlers = (globalThis as any).backendComfyUIHandlers;
    if (comfyHandlers?.handleMessage) {
      this.logger.debug('Routing message to backend ComfyUI handlers', { type: message.type });
      try {
        await comfyHandlers.handleMessage(message);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error('Failed to forward message to backendComfyUIHandlers', {
          type: message.type,
          error: errorMessage,
        });
      }
      return;
    }

    this.logger.debug('Received unknown message type', { type: message.type });
  }

  private async handleWebRTCOffer(offer: any, signalingWs: WebSocket): Promise<void> {
    try {
      this.logger.info('Handling WebRTC offer for signaling');

      // Create WebRTC peer
      this.webrtcPeer = new WebRTCPeer({
        config: this.config.webrtc,
        logger: this.logger,
        onMessage: this.handleMessage.bind(this),
      });

      // Handle offer and get answer
      const answer = await this.webrtcPeer.handleOffer(offer);

      // Send answer back via signaling WebSocket
      signalingWs.send(
        JSON.stringify({
          type: 'webrtc-answer',
          answer: answer,
        })
      );

      this.activeConnectionType = 'webrtc';
      this.logger.info('WebRTC connection established');

      // Close signaling WebSocket after handshake
      setTimeout(() => {
        signalingWs.close();
      }, 1000);
    } catch (error) {
      this.logger.error('Failed to handle WebRTC offer', error);
      signalingWs.send(
        JSON.stringify({
          type: 'webrtc-error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    }
  }

  private async handleWebRTCOfferHTTP(req: any, res: any): Promise<void> {
    // CRITICAL: Call resume() to enable stream data flow
    req.resume();

    try {
      // Read body using promise wrapper around classic events
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];

        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        req.on('end', () => {
          resolve(Buffer.concat(chunks).toString());
        });

        req.on('error', reject);
      });

      const { offer } = JSON.parse(body);

      if (!offer) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing offer in request body' }));
        return;
      }

      // Create WebRTC peer
      this.webrtcPeer = new WebRTCPeer({
        config: this.config.webrtc,
        logger: this.logger,
        onMessage: this.handleMessage.bind(this),
      });

      // Handle offer and get answer
      const answer = await this.webrtcPeer.handleOffer(offer);

      this.activeConnectionType = 'webrtc';
      this.logger.info('WebRTC connection established via HTTP signaling');

      // Send answer back via HTTP response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answer }));
    } catch (error) {
      this.logger.error('Failed to handle WebRTC offer via HTTP', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    }
  }

  async query(method: string, data?: any): Promise<any> {
    // Check connection based on active connection type
    const isConnected =
      this.activeConnectionType === 'webrtc'
        ? this.webrtcPeer && this.webrtcPeer.getIsConnected()
        : this.foundrySocket && this.foundrySocket.readyState === WebSocket.OPEN;

    if (!isConnected) {
      throw new Error('Not connected to Foundry VTT module');
    }

    const queryId = `query-${++this.queryIdCounter}`;
    this.logger.debug('Sending query to Foundry', {
      method,
      data,
      queryId,
      connectionType: this.activeConnectionType,
    });

    // NINJO: This was hardwired to 10 seconds. Exporting 902 scenes takes about
    // 135, so the call gave up long before the module in the browser had
    // finished. The work completed and nobody knew — which is how a finished
    // export came to be thrown away on 2026-08-30.
    const timeoutMs = timeoutFor(method);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingQueries.delete(queryId);
        reject(
          new Error(
            `Query timeout: ${method} (after ${Math.round(timeoutMs / 1000)}s). ` +
              `The work continues in the module and may well finish, so count the result ` +
              `rather than concluding anything from this message.`
          )
        );
      }, timeoutMs);

      this.pendingQueries.set(queryId, { resolve, reject, timeout });

      const message = {
        type: 'mcp-query',
        id: queryId,
        data: { method, data },
      };

      // Use sendToFoundry to support both WebSocket and WebRTC
      this.sendToFoundry(message);
    });
  }

  sendToFoundry(message: any): void {
    if (this.activeConnectionType === 'webrtc' && this.webrtcPeer) {
      this.webrtcPeer.sendMessage(message);
    } else if (
      this.activeConnectionType === 'websocket' &&
      this.foundrySocket &&
      this.foundrySocket.readyState === WebSocket.OPEN
    ) {
      this.foundrySocket.send(JSON.stringify(message));
    } else {
      throw new Error('Not connected to Foundry VTT module');
    }
  }

  isConnected(): boolean {
    if (!this.isStarted) return false;

    if (this.activeConnectionType === 'webrtc') {
      return this.webrtcPeer !== null && this.webrtcPeer.getIsConnected();
    } else if (this.activeConnectionType === 'websocket') {
      return this.foundrySocket !== null && this.foundrySocket.readyState === WebSocket.OPEN;
    }

    return false;
  }

  getConnectionInfo(): any {
    return {
      started: this.isStarted,
      connected: this.isConnected(),
      connectionType: this.activeConnectionType,
      readyState: this.foundrySocket?.readyState || 'CLOSED',
      config: {
        port: this.config.port,
        namespace: this.config.namespace,
      },
    };
  }

  getConnectionType(): 'websocket' | 'webrtc' | null {
    return this.activeConnectionType;
  }

  /**
   * Send a message to the connected Foundry module
   */
  sendMessage(message: any): void {
    if (!this.isConnected()) {
      throw new Error('Not connected to Foundry VTT module');
    }

    try {
      this.sendToFoundry(message);
      this.logger.debug('Sent message to Foundry module', {
        type: message.type,
        connectionType: this.activeConnectionType,
      });
    } catch (error) {
      this.logger.error('Failed to send message to Foundry module', error);
      throw error;
    }
  }

  /**
   * Broadcast a message to all connected Foundry clients (alias for sendMessage for single connection)
   */
  broadcastMessage(message: any): void {
    this.sendMessage(message);
  }
}
