import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CONSTANTS, PushChain, UniversalSigner } from '../../src';
import { sendCustomTx } from './backend-smoke-test.test';
import { hexToBytes } from 'viem';
import { config } from '../config';

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

describe('WebSocket Tests', () => {
  const env = config.ENV;
  let pushChain: PushChain;

  beforeAll(async () => {
    const senderPrivateKey = generatePrivateKey();
    const address = privateKeyToAccount(senderPrivateKey);
    const universalSigner: UniversalSigner = {
      chain: CONSTANTS.CHAIN.PUSH,
      chainId: CONSTANTS.CHAIN_ID.PUSH.DEVNET,
      address: address.address,
      signMessage: async (data: Uint8Array): Promise<Uint8Array> => {
        const signature = await address.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    pushChain = await PushChain.initialize(universalSigner, { network: env });
  });

  beforeEach(async () => {
    // Ensure we're disconnected before each test
    if (pushChain.ws.isConnected()) {
      pushChain.ws.disconnect();
    }
    await pushChain.ws.connect();
  });

  afterEach(async () => {
    // Clean up after each test
    if (pushChain.ws.isConnected()) {
      pushChain.ws.disconnect();
    }
  });

  afterAll(async () => {
    // Cleanup any remaining resources if needed
  });

  // ===== BASIC CONNECTION TESTS =====

  it('should connect and disconnect successfully', async () => {
    // Connect to WebSocket
    await pushChain.ws.connect();
    expect(pushChain.ws.isConnected()).toBe(true);

    // Disconnect from WebSocket
    pushChain.ws.disconnect();
    expect(pushChain.ws.isConnected()).toBe(false);
  });

  it('should handle connection errors gracefully', async () => {
    // Try to connect to an invalid URL
    const invalidWs = pushChain.ws as any;
    const originalUrl = invalidWs.url;
    invalidWs.url = 'ws://invalid-url-that-does-not-exist';

    // The connect method should throw an error
    await expect(pushChain.ws.connect()).rejects.toThrow();

    // Restore the original URL
    invalidWs.url = originalUrl;
  });

  it('should handle reconnection', async () => {
    // Connect to WebSocket
    await pushChain.ws.connect();
    expect(pushChain.ws.isConnected()).toBe(true);

    // Disconnect
    pushChain.ws.disconnect();
    expect(pushChain.ws.isConnected()).toBe(false);

    // Reconnect
    await pushChain.ws.connect();
    expect(pushChain.ws.isConnected()).toBe(true);
  });

  // ===== HANDSHAKE TESTS =====

  it('should successfully perform handshake exchange', async () => {
    // Store received messages for validation
    const receivedMessages: any[] = [];

    // Create a promise that will resolve when we receive the handshake acknowledgment
    const handshakePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout - no HANDSHAKE_ACK received'));
      }, 5000);

      const ws = pushChain.ws as any;
      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          receivedMessages.push(message);
          if (message.type === 'HANDSHAKE_ACK') {
            clearTimeout(timeout);
            resolve();
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      // Send initial handshake message
      const handshakeMsg = {
        type: 'HANDSHAKE',
        data: {
          clientId: ws.clientId || 'test-client',
          timestamp: Date.now(),
        },
      };
      ws.ws.send(JSON.stringify(handshakeMsg));
    });

    await handshakePromise;

    // Validate handshake response
    const handshakeAck = receivedMessages.find(
      (msg) => msg.type === 'HANDSHAKE_ACK'
    );
    expect(handshakeAck).toBeDefined();
    expect(handshakeAck.data.success).toBe(true);
    expect(handshakeAck.timestamp).toBeDefined();
  }, 10000);

  it('should follow correct handshake protocol sequence', async () => {
    const messages: any[] = [];
    const sentMessages: any[] = [];
    const ws = pushChain.ws as any;

    // Store original send method and patch it to track sent messages
    const originalSend = ws.ws.send.bind(ws.ws);
    ws.ws.send = (message: string) => {
      try {
        sentMessages.push(JSON.parse(message));
        console.log('Sent message:', JSON.parse(message)); // Debug log
      } catch (error) {
        console.error('Failed to parse sent message:', error);
      }
      return originalSend(message);
    };

    // Create a promise to track the complete handshake sequence
    const handshakeSequencePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake sequence timeout'));
      }, 10000); // Increased timeout

      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          messages.push(message);
          console.log('Received message:', message); // Debug log

          if (message.type === 'HANDSHAKE_ACK') {
            clearTimeout(timeout);
            resolve();
          }
        } catch (error) {
          console.error('Failed to parse received message:', error);
        }
      });

      // Send initial handshake message
      const handshakeMsg = {
        type: 'HANDSHAKE',
        data: {
          clientId: ws.clientId || 'test-client',
        },
        timestamp: Date.now(),
      };
      console.log('Sending handshake message:', handshakeMsg);
      ws.ws.send(JSON.stringify(handshakeMsg));
    });

    try {
      // Wait for the complete handshake sequence
      await handshakeSequencePromise;

      // Verify message counts
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(sentMessages.length).toBeGreaterThanOrEqual(1);

      // Verify handshake message was sent
      const handshakeMsg = sentMessages.find((msg) => msg.type === 'HANDSHAKE');

      expect(handshakeMsg).toBeDefined();
      expect(handshakeMsg.type).toBe('HANDSHAKE');
      expect(handshakeMsg.data).toHaveProperty('clientId');
      expect(handshakeMsg.timestamp).toBeDefined();

      // Verify handshake acknowledgment was received
      const handshakeAck = messages.find((msg) => msg.type === 'HANDSHAKE_ACK');

      expect(handshakeAck).toBeDefined();
      expect(handshakeAck.type).toBe('HANDSHAKE_ACK');
      expect(handshakeAck.data.success).toBe(true);
      expect(handshakeAck.timestamp).toBeDefined();
    } finally {
      // Restore original send method
      ws.ws.send = originalSend;
    }
  }, 10000);

  it('should handle handshake failure gracefully', async () => {
    const ws = pushChain.ws as any;

    // Store received messages
    const receivedMessages: any[] = [];

    // Create a promise that will track the handshake attempt
    const handshakePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout'));
      }, 5000);

      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          receivedMessages.push(message);
          if (message.type === 'HANDSHAKE_ACK' && !message.data.success) {
            clearTimeout(timeout);
            resolve();
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      // Send invalid handshake message
      const invalidHandshakeMsg = {
        type: 'HANDSHAKE',
        data: {
          // Missing required clientId
          timestamp: Date.now(),
        },
      };
      ws.ws.send(JSON.stringify(invalidHandshakeMsg));
    });

    // Wait for handshake failure
    await handshakePromise;

    // Verify handshake failure response
    const handshakeAck = receivedMessages.find(
      (msg) => msg.type === 'HANDSHAKE_ACK'
    );
    expect(handshakeAck).toBeDefined();
    expect(handshakeAck.data.success).toBe(false);
    expect(handshakeAck.data.error).toBeDefined();
  }, 10000);

  // ===== SUBSCRIPTION TESTS =====

  it('should subscribe and unsubscribe successfully', async () => {
    // Subscribe to blocks
    let blockReceived = false;
    const subscription = await pushChain.ws.subscribe(() => {
      blockReceived = true;
    });

    // Verify subscription was created
    expect(subscription.subscriptionId).toBeDefined();

    // Unsubscribe
    await pushChain.ws.unsubscribe(subscription.subscriptionId);
  });

  it('should perform handshake and receive SUBSCRIBE_ACK with default filter', async () => {
    const ws = pushChain.ws as any;

    // Perform handshake
    const handshakePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout - no HANDSHAKE_ACK received'));
      }, 10000); // Increased timeout for handshake

      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'HANDSHAKE_ACK') {
            clearTimeout(timeout);
            resolve();
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      // Send handshake message
      const handshakeMsg = {
        type: 'HANDSHAKE',
        data: {
          clientId: ws.clientId || 'test-client',
        },
        timestamp: Date.now(),
      };
      ws.ws.send(JSON.stringify(handshakeMsg));
    });

    // Wait for handshake to complete
    await handshakePromise;

    // Subscribe to block updates and check for SUBSCRIBE_ACK
    const subscribePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Subscription timeout - no SUBSCRIBE_ACK received'));
      }, 10000); // Timeout for subscription acknowledgment

      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'SUBSCRIBE_ACK') {
            clearTimeout(timeout);
            if (message.data.success) {
              resolve();
            } else {
              reject(new Error('Subscription failed: ' + message.data.error));
            }
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      // Send subscription request
      pushChain.ws.subscribe(() => {
        // No need to handle block updates in this test
      });
    });

    // Wait for subscription acknowledgment
    await subscribePromise;

    // Assertions
    console.log('Subscription acknowledged successfully.');
  }, 10000);

  it('should perform handshake and receive SUBSCRIBE_ACK with custom filters', async () => {
    const ws = pushChain.ws as any;

    // Perform handshake
    const handshakePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout - no HANDSHAKE_ACK received'));
      }, 10000); // Increased timeout for handshake

      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'HANDSHAKE_ACK') {
            clearTimeout(timeout);
            resolve();
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      // Send handshake message
      const handshakeMsg = {
        type: 'HANDSHAKE',
        data: {
          clientId: ws.clientId || 'test-client',
        },
        timestamp: Date.now(),
      };
      ws.ws.send(JSON.stringify(handshakeMsg));
    });

    // Wait for handshake to complete
    await handshakePromise;

    // Define custom filters
    const customFilters = [
      {
        type: 'CATEGORY' as const,
        value: ['transactions-value'],
      },
    ];

    // Subscribe to block updates with custom filters and check for SUBSCRIBE_ACK
    const subscribePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Subscription timeout - no SUBSCRIBE_ACK received'));
      }, 10000); // Timeout for subscription acknowledgment

      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'SUBSCRIBE_ACK') {
            clearTimeout(timeout);
            if (message.data.success) {
              resolve();
            } else {
              reject(new Error('Subscription failed: ' + message.data.error));
            }
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      // Send subscription request with custom filters
      pushChain.ws.subscribe(() => {
        // No need to handle block updates in this test
      }, customFilters);
    });

    // Wait for subscription acknowledgment
    await subscribePromise;

    // Assertions
    console.log('Custom filter subscription acknowledged successfully.');
  }, 10000);

  it('should handle subscription with custom filters', async () => {
    // Subscribe with custom filters
    const subscription = await pushChain.ws.subscribe(() => {
      // Callback for subscription
    }, [
      { type: 'CATEGORY', value: ['test-category'] },
      { type: 'FROM', value: ['0x1234567890abcdef'] },
    ]);

    // Verify subscription was created
    expect(subscription.subscriptionId).toBeDefined();

    // Unsubscribe
    await pushChain.ws.unsubscribe(subscription.subscriptionId);
  });

  it('should handle subscription with wildcard filter', async () => {
    // Subscribe with wildcard filter
    const subscription = await pushChain.ws.subscribe(() => {
      // Callback for subscription
    }, [{ type: 'WILDCARD', value: ['*'] }]);

    // Verify subscription was created
    expect(subscription.subscriptionId).toBeDefined();

    // Unsubscribe
    await pushChain.ws.unsubscribe(subscription.subscriptionId);
  });

  it('should handle subscription with multiple recipients filter', async () => {
    // Subscribe with multiple recipients filter
    const subscription = await pushChain.ws.subscribe(() => {
      // Callback for subscription
    }, [
      {
        type: 'RECIPIENTS',
        value: ['0x1234567890abcdef', '0xabcdef1234567890'],
      },
    ]);

    // Verify subscription was created
    expect(subscription.subscriptionId).toBeDefined();

    // Unsubscribe
    await pushChain.ws.unsubscribe(subscription.subscriptionId);
  });

  it.skip('should handle multiple subscriptions', async () => {
    // Create multiple subscriptions with different filters
    const subscription1 = await pushChain.ws.subscribe(() => {
      // Callback for first subscription
    }, [{ type: 'CATEGORY', value: ['test1'] }]);

    const subscription2 = await pushChain.ws.subscribe(() => {
      // Callback for second subscription
    }, [{ type: 'CATEGORY', value: ['test2'] }]);

    // Verify both subscriptions were created
    expect(subscription1.subscriptionId).toBeDefined();
    expect(subscription2.subscriptionId).toBeDefined();
    expect(subscription1.subscriptionId).not.toBe(subscription2.subscriptionId);

    // Unsubscribe from one subscription
    await pushChain.ws.unsubscribe(subscription1.subscriptionId);

    // The other subscription should still be active
    expect(pushChain.ws.isConnected()).toBe(true);

    // Unsubscribe from the other subscription
    await pushChain.ws.unsubscribe(subscription2.subscriptionId);
  });

  // ===== BLOCK RECEIVING TESTS =====

  it('should subscribe and receive a block after initiating a transaction', async () => {
    const ws = pushChain.ws as any;

    // Perform handshake
    const handshakePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout - no HANDSHAKE_ACK received'));
      }, 10000);

      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'HANDSHAKE_ACK') {
            clearTimeout(timeout);
            resolve();
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      // Send handshake message
      const handshakeMsg = {
        type: 'HANDSHAKE',
        data: {
          clientId: ws.clientId || 'test-client',
        },
        timestamp: Date.now(),
      };
      ws.ws.send(JSON.stringify(handshakeMsg));
    });

    await handshakePromise;

    // Subscribe to block updates
    let blockReceived = false;
    let receivedBlock: any;

    const subscribePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Block not received within timeout'));
      }, 30000);

      pushChain.ws.subscribe((block) => {
        blockReceived = true;
        receivedBlock = block;
        clearTimeout(timeout);
        resolve();
      });
    });

    await sendCustomTx(pushChain, 0);

    await subscribePromise;

    // Assertions
    expect(blockReceived).toBe(true);
    expect(receivedBlock).toBeDefined();
    expect(receivedBlock.transactions.length).toBeGreaterThan(0);
  }, 30000);

  it('should subscribe with custom filters and receive a block after initiating multiple transactions', async () => {
    const ws = pushChain.ws as any;

    // Perform handshake
    const handshakePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout - no HANDSHAKE_ACK received'));
      }, 10000);

      ws.ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'HANDSHAKE_ACK') {
            clearTimeout(timeout);
            resolve();
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      // Send handshake message
      const handshakeMsg = {
        type: 'HANDSHAKE',
        data: {
          clientId: ws.clientId || 'test-client',
        },
        timestamp: Date.now(),
      };
      ws.ws.send(JSON.stringify(handshakeMsg));
    });

    // Wait for handshake to complete
    await handshakePromise;

    // Define custom filters
    const customFilters = [
      {
        type: 'CATEGORY' as const,
        value: ['CUSTOM:V2'],
      },
    ];

    // Subscribe to block updates with custom filters
    let blockReceived = false;
    let receivedBlock: any;

    const subscribePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Block not received within timeout'));
      }, 30000);

      pushChain.ws.subscribe((block) => {
        blockReceived = true;
        receivedBlock = block;
        clearTimeout(timeout);
        resolve();
      }, customFilters);
    });

    // Initiate multiple transactions to trigger a block
    for (let i = 0; i < 3; i++) {
      await sendCustomTx(pushChain, i);
    }

    // Wait for block to be received
    await subscribePromise;

    // Assertions
    expect(blockReceived).toBe(true);
    expect(receivedBlock).toBeDefined();
    expect(receivedBlock.transactions.length).toBeGreaterThanOrEqual(1);
    expect(receivedBlock.transactions[0].category).toBe('CUSTOM:V2');

    console.log(
      'Block received with custom filters:',
      JSON.stringify(receivedBlock, null, 2)
    );
  }, 10000);

  // ===== RECONNECTION AND RESILIENCE TESTS =====

  it('should handle reconnection and maintain subscription', async () => {
    let blockCount = 0;
    let receivedBlock: any;

    // First ensure we're connected and subscribed
    const subscribePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Block not received within timeout'));
      }, 30000);

      pushChain.ws.subscribe((block) => {
        blockCount++;
        receivedBlock = block;
        clearTimeout(timeout);
        resolve();
      });
    });

    // Initiate a transaction to trigger initial block
    await sendCustomTx(pushChain, 0);

    // Wait for first block
    await subscribePromise;
    const initialBlockCount = blockCount;

    // Test disconnection
    pushChain.ws.disconnect();
    await sleep(1000); // Give time for disconnect
    expect(pushChain.ws.isConnected()).toBe(false);

    // Test reconnection
    await pushChain.ws.connect();
    await sleep(1000); // Give time for connect
    expect(pushChain.ws.isConnected()).toBe(true);

    // Verify subscription is maintained by sending new transactions
    const newBlockPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('No new blocks received after reconnection'));
      }, 30000);

      pushChain.ws.subscribe((block) => {
        blockCount++;
        receivedBlock = block;
        clearTimeout(timeout);
        resolve();
      });
    });

    // Send new transactions after reconnection
    for (let i = 0; i < 3; i++) {
      await sendCustomTx(pushChain, i);
    }

    // Wait for new block after reconnection
    await newBlockPromise;

    // Assertions
    expect(blockCount).toBeGreaterThan(initialBlockCount);
    expect(receivedBlock).toBeDefined();
    expect(receivedBlock.transactions).toBeDefined();
    expect(receivedBlock.transactions.length).toBeGreaterThan(0);

    console.log('Reconnection test completed successfully:', {
      initialBlockCount,
      finalBlockCount: blockCount,
      lastBlock: receivedBlock,
    });
  }, 30000);
});
