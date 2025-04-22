// Conditional import for WebSocket based on environment
let WebSocketImpl: any;
if (typeof window !== 'undefined') {
  // Browser environment
  WebSocketImpl = window.WebSocket;
} else {
  // Node.js environment
  WebSocketImpl = require('ws');
}

import { ENV } from '../constants';
import { Validator } from '../validator/validator';

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
  private ws: any = null;
  private clientId: string | null = null;
  private blockHandlers: Map<string, (block: WebSocketBlock) => void> =
    new Map();
  private isBrowser: boolean;

  private constructor(private url: string) {
    this.isBrowser = typeof window !== 'undefined';
  }

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
      this.ws = new WebSocketImpl(this.url);

      // Set up message handler
      this.setupMessageListener((data) => {
        const message = JSON.parse(data);
        this.handleMessage(message);
      });

      // Set up open handler
      this.setupOpenListener(() => {
        this.setupMessageHandler(resolve, reject);
      });

      // Set up error handler
      this.setupErrorListener((error) => {
        reject(error);
      });
    });
  }

  /**
   * Set up message listener based on environment
   */
  private setupMessageListener(callback: (data: any) => void): void {
    if (this.isBrowser) {
      this.ws.onmessage = (event: MessageEvent) => callback(event.data);
    } else {
      this.ws.on('message', (data: string) => callback(data));
    }
  }

  /**
   * Set up open listener based on environment
   */
  private setupOpenListener(callback: () => void): void {
    if (this.isBrowser) {
      this.ws.onopen = callback;
    } else {
      this.ws.on('open', callback);
    }
  }

  /**
   * Set up error listener based on environment
   */
  private setupErrorListener(callback: (error: any) => void): void {
    if (this.isBrowser) {
      this.ws.onerror = callback;
    } else {
      this.ws.on('error', callback);
    }
  }

  /**
   * Add a one-time message listener based on environment
   */
  private addOneTimeMessageListener(callback: (data: any) => void): void {
    if (this.isBrowser) {
      const handler = (event: MessageEvent) => {
        callback(event.data);
        this.ws?.removeEventListener('message', handler);
      };
      this.ws?.addEventListener('message', handler);
    } else {
      const handler = (data: string) => {
        callback(data);
        this.ws?.removeListener('message', handler);
      };
      this.ws?.on('message', handler);
    }
  }

  private setupMessageHandler(
    resolve: () => void,
    reject: (error: Error) => void
  ) {
    this.addOneTimeMessageListener((data) => {
      const message = JSON.parse(data);
      if (message.type === 'WELCOME') {
        this.clientId = message.data.clientId;
        this.sendHandshake();
      } else if (message.type === 'HANDSHAKE_ACK') {
        if (message.data.success) {
          resolve();
        } else {
          reject(new Error(message.data.error));
        }
      }
    });
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
      this.addOneTimeMessageListener((data) => {
        const message = JSON.parse(data);
        if (message.type === 'SUBSCRIBE_ACK') {
          if (message.data.success) {
            const subscriptionId: string = message.data.subscriptionId;
            this.blockHandlers.set(subscriptionId, callback);
            resolve({ subscriptionId });
          } else {
            reject(new Error(message.data.error));
          }
        }
      });

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
    return this.ws?.readyState === WebSocketImpl.OPEN;
  }

  /**
   * Unsubscribe from block updates
   * @param subscriptionId The ID of the subscription to cancel
   * @returns Promise<void>
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.addOneTimeMessageListener((data) => {
        const message = JSON.parse(data);
        if (message.type === 'UNSUBSCRIBE_ACK') {
          if (message.data.success) {
            this.blockHandlers.delete(subscriptionId);
            resolve();
          } else {
            reject(new Error(message.data.error));
          }
        }
      });

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
