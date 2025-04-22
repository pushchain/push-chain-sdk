import { ENV } from '../constants';
import { Validator } from '../validator/validator';

// Define interfaces for WebSocket implementations
interface BrowserWebSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(
    type: string,
    listener: (event: MessageEvent) => void
  ): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: (() => void) | null;
  onerror: ((error: Event) => void) | null;
  readyState: number;
}

interface NodeWebSocket {
  send(data: string): void;
  close(): void;
  on(type: 'message', listener: (data: string) => void): void;
  on(type: 'open', listener: () => void): void;
  on(type: 'error', listener: (error: Error) => void): void;
  removeListener(type: 'message', listener: (data: string) => void): void;
  removeListener(type: 'open', listener: () => void): void;
  removeListener(type: 'error', listener: (error: Error) => void): void;
  readyState: number;
}

// Define a union type for our WebSocket implementation
type WebSocketImpl = BrowserWebSocket | NodeWebSocket;

// Import the appropriate WebSocket implementation
let WebSocketConstructor: any;
if (typeof window !== 'undefined') {
  // Browser environment
  WebSocketConstructor = window.WebSocket;
} else {
  // Node.js environment
  WebSocketConstructor = require('ws');
}

type WSMessage = {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  timestamp?: number;
  filters?: SubscriptionFilter[];
};

export type SubscriptionFilter = {
  type: 'CATEGORY' | 'FROM' | 'RECIPIENTS' | 'WILDCARD';
  value: string[];
};

type RawBlock = {
  blockHash: string;
  txs: {
    blockHash: string;
    txHash: string;
    category: string;
    from: string;
    recipients: string[];
  }[];
};

export type WebSocketBlock = {
  blockHash: string;
  transactions: WebSocketTransaction[];
};

export type WebSocketTransaction = {
  hash: string;
  category: string;
  from: string;
  recipients: string[];
};

export class WebSocketClient {
  private ws: WebSocketImpl | null = null;
  private clientId: string | null = null;
  private blockHandlers: Map<string, (block: WebSocketBlock) => void> =
    new Map();

  private constructor(private url: string) {}

  static initialize = async (
    env: ENV,
    rpcUrl?: string
  ): Promise<WebSocketClient> => {
    const validator = await Validator.initalize({ env, rpcUrl });
    const wsUrl = WebSocketClient.fixVNodeUrl(validator.activeValidatorURL);
    return new WebSocketClient(wsUrl);
  };

  /**
   * Applies 4 rules to url
   * 1) .local -> replace everything with localhost
   * 2) http -> replace with https
   * 3) domain.com -> appends /api/v1/rpc path
   * 4) domain.com/api/ -> replace with domain.com/api
   *
   * @param url - url to fix
   */
  private static fixVNodeUrl(url: string) {
    if (url == null || url.length == 0) {
      return url;
    }
    const urlObj = new URL(url);
    const isLocal = urlObj.hostname.endsWith('.local');
    if (isLocal) {
      urlObj.hostname = 'localhost';
      urlObj.protocol = 'ws:';
    } else {
      urlObj.protocol = 'wss:';
    }
    if (urlObj.pathname.trim().length == 0 || urlObj.pathname.trim() === '/') {
      urlObj.pathname = '/ws';
    }
    if (urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    return urlObj.toString();
  }

  /**
   * Connects to the WebSocket server
   * @returns Promise<void>
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocketConstructor(this.url) as WebSocketImpl;

      if (typeof window !== 'undefined') {
        // Browser environment
        const browserWs = this.ws as BrowserWebSocket;
        browserWs.onmessage = (event: MessageEvent) => {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        };

        browserWs.onopen = () => {
          this.setupMessageHandler(resolve, reject);
        };

        browserWs.onerror = (error: Event) => {
          reject(error);
        };
      } else {
        // Node.js environment
        const nodeWs = this.ws as NodeWebSocket;
        nodeWs.on('message', (data: string) => {
          const message = JSON.parse(data);
          this.handleMessage(message);
        });

        nodeWs.on('open', () => {
          this.setupMessageHandler(resolve, reject);
        });

        nodeWs.on('error', (error: Error) => {
          reject(error);
        });
      }
    });
  }

  private setupMessageHandler(
    resolve: () => void,
    reject: (error: Error) => void
  ) {
    if (typeof window !== 'undefined') {
      // Browser environment
      const browserWs = this.ws as BrowserWebSocket;
      const messageHandler = (event: MessageEvent) => {
        const message = JSON.parse(event.data);
        if (message.type === 'WELCOME') {
          this.clientId = message.data.clientId;
          this.sendHandshake();
        } else if (message.type === 'HANDSHAKE_ACK') {
          if (message.data.success) {
            browserWs.removeEventListener('message', messageHandler);
            resolve();
          } else {
            reject(new Error(message.data.error));
          }
        }
      };

      browserWs.addEventListener('message', messageHandler);
    } else {
      // Node.js environment
      const nodeWs = this.ws as NodeWebSocket;
      const messageHandler = (data: string) => {
        const message = JSON.parse(data);
        if (message.type === 'WELCOME') {
          this.clientId = message.data.clientId;
          this.sendHandshake();
        } else if (message.type === 'HANDSHAKE_ACK') {
          if (message.data.success) {
            nodeWs.removeListener('message', messageHandler);
            resolve();
          } else {
            reject(new Error(message.data.error));
          }
        }
      };

      nodeWs.on('message', messageHandler);
    }
  }

  private handleMessage(message: WSMessage) {
    if (message.type === 'BLOCK' && message.data?.block) {
      const handler = this.blockHandlers.get(message.data.subscriptionId);
      if (handler) {
        const rawBlock = message.data.block as RawBlock;
        const block: WebSocketBlock = {
          blockHash: rawBlock.blockHash,
          transactions: rawBlock.txs.map((tx) => ({
            hash: tx.txHash,
            category: tx.category,
            from: tx.from,
            recipients: tx.recipients,
          })),
        };
        handler(block);
      }
    }
  }

  private sendHandshake() {
    this.send({
      type: 'HANDSHAKE',
      data: { clientId: this.clientId },
      timestamp: Date.now(),
    });
  }

  /**
   * Subscribe to block updates with filters
   * @param callback Function to handle incoming block updates
   * @param filters Optional filters for the subscription
   * @returns Promise<{ subscriptionId: string }> Subscription ID
   */
  async subscribe(
    callback: (data: WebSocketBlock) => void,
    filters: SubscriptionFilter[] = [{ type: 'WILDCARD', value: ['*'] }]
  ): Promise<{ subscriptionId: string }> {
    return new Promise((resolve, reject) => {
      if (typeof window !== 'undefined') {
        // Browser environment
        const browserWs = this.ws as BrowserWebSocket;
        const handleSubscribeResponse = (event: MessageEvent) => {
          const message = JSON.parse(event.data);
          if (message.type === 'SUBSCRIBE_ACK') {
            if (message.data.success) {
              const subscriptionId: string = message.data.subscriptionId;
              this.blockHandlers.set(subscriptionId, callback);
              browserWs.removeEventListener('message', handleSubscribeResponse);
              resolve({ subscriptionId });
            } else {
              reject(new Error(message.data.error));
            }
          }
        };

        browserWs.addEventListener('message', handleSubscribeResponse);
      } else {
        // Node.js environment
        const nodeWs = this.ws as NodeWebSocket;
        const handleSubscribeResponse = (data: string) => {
          const message = JSON.parse(data);
          if (message.type === 'SUBSCRIBE_ACK') {
            if (message.data.success) {
              const subscriptionId: string = message.data.subscriptionId;
              this.blockHandlers.set(subscriptionId, callback);
              nodeWs.removeListener('message', handleSubscribeResponse);
              resolve({ subscriptionId });
            } else {
              reject(new Error(message.data.error));
            }
          }
        };

        nodeWs.on('message', handleSubscribeResponse);
      }

      this.send({
        type: 'SUBSCRIBE',
        filters,
        timestamp: Date.now(),
      });
    });
  }

  private send(message: WSMessage): void {
    if (!this.isConnected()) {
      throw new Error('WebSocket is not connected');
    }
    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Disconnects from the WebSocket server
   * @returns void
   */
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.clientId = null;
    this.blockHandlers.clear();
  }

  /**
   * Checks if the WebSocket is connected
   * @returns boolean
   */
  isConnected(): boolean {
    if (!this.ws) return false;

    if (typeof window !== 'undefined') {
      // Browser environment
      const browserWs = this.ws as BrowserWebSocket;
      return browserWs.readyState === WebSocketConstructor.OPEN;
    } else {
      // Node.js environment
      const nodeWs = this.ws as NodeWebSocket;
      return nodeWs.readyState === WebSocketConstructor.OPEN;
    }
  }

  /**
   * Unsubscribe from block updates
   * @param subscriptionId The ID of the subscription to cancel
   * @returns Promise<void>
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window !== 'undefined') {
        // Browser environment
        const browserWs = this.ws as BrowserWebSocket;
        const handleUnsubscribeResponse = (event: MessageEvent) => {
          const message = JSON.parse(event.data);
          if (message.type === 'UNSUBSCRIBE_ACK') {
            if (message.data.success) {
              this.blockHandlers.delete(subscriptionId);
              browserWs.removeEventListener(
                'message',
                handleUnsubscribeResponse
              );
              resolve();
            } else {
              reject(new Error(message.data.error));
            }
          }
        };

        browserWs.addEventListener('message', handleUnsubscribeResponse);
      } else {
        // Node.js environment
        const nodeWs = this.ws as NodeWebSocket;
        const handleUnsubscribeResponse = (data: string) => {
          const message = JSON.parse(data);
          if (message.type === 'UNSUBSCRIBE_ACK') {
            if (message.data.success) {
              this.blockHandlers.delete(subscriptionId);
              nodeWs.removeListener('message', handleUnsubscribeResponse);
              resolve();
            } else {
              reject(new Error(message.data.error));
            }
          }
        };

        nodeWs.on('message', handleUnsubscribeResponse);
      }

      const unsubscribeMsg = {
        type: 'UNSUBSCRIBE',
        data: {
          subscriptionId,
        },
        timestamp: Date.now(),
      };
      this.ws?.send(JSON.stringify(unsubscribeMsg));
    });
  }
}
