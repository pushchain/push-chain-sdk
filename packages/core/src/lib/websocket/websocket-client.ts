import * as WebSocket from 'ws';

type WSMessage = {
    type: string;
    data?: any;
    timestamp?: number;
    filters?: SubscriptionFilter[];
};

type SubscriptionFilter = {
    type: 'CATEGORY' | 'FROM' | 'RECIPIENTS' | 'WILDCARD';
    value: string[];
};

export class WebSocketClient {
    private ws: WebSocket.WebSocket | null = null;
    private clientId: string | null = null;
    private blockHandlers: Map<string, (block: any) => void> = new Map();
    
    constructor(private url: string) {}

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);

            this.ws.on('message', (data: string) => {
                const message = JSON.parse(data);
                this.handleMessage(message);
            });

            this.ws.on('open', () => {
                this.setupMessageHandler(resolve, reject);
            });

            this.ws.on('error', (error: Error) => {
                reject(error);
            });
        });
    }

    private setupMessageHandler(resolve: () => void, reject: (error: Error) => void) {
        const messageHandler = (data: string) => {
            const message = JSON.parse(data);
            if (message.type === 'WELCOME') {
                this.clientId = message.data.clientId;
                this.sendHandshake();
            } else if (message.type === 'HANDSHAKE_ACK') {
                if (message.data.success) {
                    this.ws?.removeListener('message', messageHandler);
                    resolve();
                } else {
                    reject(new Error(message.data.error));
                }
            }
        };

        this.ws?.on('message', messageHandler);
    }

    private handleMessage(message: WSMessage) {
        if (message.type === 'BLOCK' && message.data?.block) {
            const handler = this.blockHandlers.get(message.data.subscriptionId);
            if (handler) {
                handler(message.data.block);
            }
        }
    }

    private sendHandshake() {
        this.send({
            type: 'HANDSHAKE',
            data: { clientId: this.clientId },
            timestamp: Date.now()
        });
    }

    /**
     * Subscribe to block updates with filters
     * @param callback Function to handle incoming block updates
     * @param filters Optional filters for the subscription
     * @returns Promise<string> Subscription ID
     */
    async subscribeToBlocks(
        callback: (data: any) => void, 
        filters: SubscriptionFilter[] = [{ type: 'WILDCARD', value: ['*'] }]
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const handleSubscribeResponse = (data: string) => {
                const message = JSON.parse(data);
                if (message.type === 'SUBSCRIBE_ACK') {
                    if (message.data.success) {
                        const subscriptionId = message.data.subscriptionId;
                        this.blockHandlers.set(subscriptionId, callback);
                        this.ws?.removeListener('message', handleSubscribeResponse);
                        resolve(subscriptionId);
                    } else {
                        reject(new Error(message.data.error));
                    }
                }
            };

            this.ws?.on('message', handleSubscribeResponse);

            this.send({
                type: 'SUBSCRIBE',
                filters,
                timestamp: Date.now()
            });
        });
    }

    private send(message: WSMessage): void {
        if (!this.isConnected()) {
            throw new Error('WebSocket is not connected');
        }
        this.ws?.send(JSON.stringify(message));
    }

    disconnect(): void {
        this.ws?.close();
        this.ws = null;
        this.clientId = null;
        this.blockHandlers.clear();
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * Unsubscribe from block updates
     * @param subscriptionId The ID of the subscription to cancel
     * @returns Promise<void>
     */
    async unsubscribe(subscriptionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const handleUnsubscribeResponse = (data: string) => {
                const message = JSON.parse(data);
                if (message.type === 'UNSUBSCRIBE_ACK') {
                    if (message.data.success) {
                        this.blockHandlers.delete(subscriptionId);
                        this.ws?.removeListener('message', handleUnsubscribeResponse);
                        resolve();
                    } else {
                        reject(new Error(message.data.error));
                    }
                }
            };

            this.ws?.on('message', handleUnsubscribeResponse);

            const unsubscribeMsg = {
                type: 'UNSUBSCRIBE',
                data: {
                    subscriptionId
                },
                timestamp: Date.now()
            };
            this.ws?.send(JSON.stringify(unsubscribeMsg));
        });
    }
}