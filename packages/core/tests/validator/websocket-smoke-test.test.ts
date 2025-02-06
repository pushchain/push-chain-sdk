import { PushNetwork } from '../../src';
import { CONSTANTS } from '../../src';
import { Tx } from '../../src';
import {
    generatePrivateKey
} from 'viem/accounts';
import { sendCustomTx } from './backend-smoke-test.test';

const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

describe('WebSocket Smoke Test', () => {
    const env = CONSTANTS.ENV.LOCAL;

    let network: PushNetwork;

    beforeAll(async () => {
        network = await PushNetwork.initialize(env);
    });

    beforeEach(async () => {
        await network.ws.connect();
    });

    afterEach(async () => {
        network.ws.disconnect();
    });

    afterAll(async () => {
        // Cleanup any remaining resources if needed
    });

    it('should successfully connect to WebSocket server', async () => {
        expect(network.ws.isConnected()).toBe(true);
    });

    it('should successfully perform handshake exchange', async () => {
        // Store received messages for validation
        const receivedMessages: any[] = [];

        // Create a promise that will resolve when we receive the handshake acknowledgment
        const handshakePromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Handshake timeout - no HANDSHAKE_ACK received'));
            }, 5000);

            const ws = network.ws as any;
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
                    timestamp: Date.now()
                }
            };
            ws.ws.send(JSON.stringify(handshakeMsg));
        });

        // Wait for handshake to complete
        await handshakePromise;

        // Validate handshake response
        const handshakeAck = receivedMessages.find(msg => msg.type === 'HANDSHAKE_ACK');
        expect(handshakeAck).toBeDefined();
        expect(handshakeAck.data.success).toBe(true);
        expect(handshakeAck.timestamp).toBeDefined();
    }, 10000);

    it('should follow correct handshake protocol se-quence', async () => {
        const messages: any[] = [];
        const sentMessages: any[] = [];
        const ws = network.ws as any;

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
                    clientId: ws.clientId || 'test-client' 
                },
                timestamp: Date.now()
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
            const handshakeMsg = sentMessages.find(msg => msg.type === 'HANDSHAKE');

            expect(handshakeMsg).toBeDefined();
            expect(handshakeMsg.type).toBe('HANDSHAKE');
            expect(handshakeMsg.data).toHaveProperty('clientId');
            expect(handshakeMsg.timestamp).toBeDefined();

            // Verify handshake acknowledgment was received
            const handshakeAck = messages.find(msg => msg.type === 'HANDSHAKE_ACK');

            expect(handshakeAck).toBeDefined();
            expect(handshakeAck.type).toBe('HANDSHAKE_ACK');
            expect(handshakeAck.data.success).toBe(true);
            expect(handshakeAck.timestamp).toBeDefined();
        } finally {
            // Restore original send method
            ws.ws.send = originalSend;
        }
    }, 10000);

    it('should perform handshake and receive SUBSCRIBE_ACK with default filter', async () => {
        const ws = network.ws as any;

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
                    clientId: ws.clientId || 'test-client'
                },
                timestamp: Date.now()
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
            network.ws.subscribeToBlocks(() => {
                // No need to handle block updates in this test
            });
        });

        // Wait for subscription acknowledgment
        await subscribePromise;

        // Assertions
        console.log('Subscription acknowledged successfully.');
    }, 10000);

    it('should perform handshake and receive SUBSCRIBE_ACK with custom filters', async () => {
        const ws = network.ws as any;

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
                    clientId: ws.clientId || 'test-client'
                },
                timestamp: Date.now()
            };
            ws.ws.send(JSON.stringify(handshakeMsg));
        });

        // Wait for handshake to complete
        await handshakePromise;

        // Define custom filters
        const customFilters = [{
            type: 'CATEGORY' as const,
            value: ['transactions-value']
        }];

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
            network.ws.subscribeToBlocks(() => {
                // No need to handle block updates in this test
            }, customFilters);
        });

        // Wait for subscription acknowledgment
        await subscribePromise;

        // Assertions
        console.log('Custom filter subscription acknowledged successfully.');
    }, 10000);

    it('should subscribe and receive a block after initiating a transaction', async () => {
        const ws = network.ws as any;

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
                    clientId: ws.clientId || 'test-client'
                },
                timestamp: Date.now()
            };
            ws.ws.send(JSON.stringify(handshakeMsg));
        });

        // Wait for handshake to complete
        await handshakePromise;

        // Subscribe to block updates
        let blockReceived = false;
        let receivedBlock: any;

        const subscribePromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Block not received within timeout'));
            }, 30000); // Timeout for receiving a block

            network.ws.subscribeToBlocks((block) => {
                blockReceived = true;
                receivedBlock = block;
                clearTimeout(timeout);
                resolve();
            });
        });

        const txInstance = await Tx.initialize(env);
        await sendCustomTx(txInstance, generatePrivateKey(), 0);

        // Wait for block to be received
        await subscribePromise;

        // Assertions
        expect(blockReceived).toBe(true);
        expect(receivedBlock).toBeDefined();
        expect(receivedBlock.txs.length).toBeGreaterThan(0);

        console.log('Block received:', JSON.stringify(receivedBlock, null, 2));
    }, 10000);

    it('should subscribe with custom filters and receive a block after initiating multiple transactions', async () => {
        const ws = network.ws as any;

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
                    clientId: ws.clientId || 'test-client'
                },
                timestamp: Date.now()
            };
            ws.ws.send(JSON.stringify(handshakeMsg));
        });

        // Wait for handshake to complete
        await handshakePromise;

        // Define custom filters
        const customFilters = [{
            type: 'CATEGORY' as const,
            value: ['CUSTOM:V2']
        }];

        // Subscribe to block updates with custom filters
        let blockReceived = false;
        let receivedBlock: any;

        const subscribePromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Block not received within timeout'));
            }, 30000); // Timeout for receiving a block

            network.ws.subscribeToBlocks((block) => {
                blockReceived = true;
                receivedBlock = block;
                clearTimeout(timeout);
                resolve();
            }, customFilters);
        });

        // Initiate multiple transactions to trigger a block
        const txInstance = await Tx.initialize(env);
        for (let i = 0; i < 3; i++) {
            await sendCustomTx(txInstance, generatePrivateKey(), i);
        }

        // Wait for block to be received
        await subscribePromise;

        // Assertions
        expect(blockReceived).toBe(true);
        expect(receivedBlock).toBeDefined();
        expect(receivedBlock.txs.length).toBeGreaterThanOrEqual(1);
        expect(receivedBlock.txs[0].category).toBe('CUSTOM:V2');

        console.log('Block received with custom filters:', JSON.stringify(receivedBlock, null, 2));
    }, 10000);

    // it('should subscribe with multiple filters and receive a block after initiating transactions', async () => {
    //     const ws = network.ws as any;

    //     // Perform handshake
    //     const handshakePromise = new Promise<void>((resolve, reject) => {
    //         const timeout = setTimeout(() => {
    //             reject(new Error('Handshake timeout - no HANDSHAKE_ACK received'));
    //         }, 10000);

    //         ws.ws.on('message', (data: string) => {
    //             try {
    //                 const message = JSON.parse(data);
    //                 if (message.type === 'HANDSHAKE_ACK') {
    //                     clearTimeout(timeout);
    //                     resolve();
    //                 }
    //             } catch (error) {
    //                 console.error('Failed to parse message:', error);
    //             }
    //         });

    //         // Send handshake message
    //         const handshakeMsg = {
    //             type: 'HANDSHAKE',
    //             data: {
    //                 clientId: ws.clientId || 'test-client'
    //             },
    //             timestamp: Date.now()
    //         };
    //         ws.ws.send(JSON.stringify(handshakeMsg));
    //     });

    //     // Wait for handshake to complete
    //     await handshakePromise;

    //     // Define multiple filters
    //     const multipleFilters = [
    //         { type: 'CATEGORY' as const, value: ['CUSTOM:V2'] },
    //         { type: 'WILDCARD' as const, value: ['*'] }
    //     ];

    //     // Subscribe to block updates with multiple filters
    //     let blockReceived = false;
    //     let receivedBlock: any;

    //     const subscribePromise = new Promise<void>((resolve, reject) => {
    //         const timeout = setTimeout(() => {
    //             reject(new Error('Block not received within timeout'));
    //         }, 30000); // Timeout for receiving a block

    //         network.ws.subscribeToBlocks((block) => {
    //             blockReceived = true;
    //             receivedBlock = block;
    //             clearTimeout(timeout);
    //             resolve();
    //         }, multipleFilters);
    //     });

    //     // Initiate multiple transactions to trigger a block
    //     const txInstance = await Tx.initialize(env);
    //     for (let i = 0; i < 3; i++) {
    //         await sendCustomTx(txInstance, generatePrivateKey(), i);
    //     }

    //     // Wait for block to be received
    //     await subscribePromise;

    //     // Assertions
    //     expect(blockReceived).toBe(true);
    //     expect(receivedBlock).toBeDefined();
    //     expect(receivedBlock.txs.length).toBeGreaterThanOrEqual(1);
    //     expect(receivedBlock.txs[0].category).toBe('CUSTOM:V2');

    //     console.log('Block received with multiple filters:', JSON.stringify(receivedBlock, null, 2));
    // }, 30000);

    it('should handle reconnection and maintain subscription', async () => {
        const ws = network.ws as any;
        let blockCount = 0;
        let receivedBlock: any;

        // First ensure we're connected and subscribed
        const subscribePromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Block not received within timeout'));
            }, 30000);

            network.ws.subscribeToBlocks((block) => {
                blockCount++;
                receivedBlock = block;
                clearTimeout(timeout);
                resolve();
            });
        });

        // Initiate a transaction to trigger initial block
        const txInstance = await Tx.initialize(env);
        await sendCustomTx(txInstance, generatePrivateKey(), 0);

        // Wait for first block
        await subscribePromise;
        const initialBlockCount = blockCount;

        // Test disconnection
        network.ws.disconnect();
        await sleep(1000); // Give time for disconnect
        expect(network.ws.isConnected()).toBe(false);
        
        // Test reconnection
        await network.ws.connect();
        await sleep(1000); // Give time for connect
        expect(network.ws.isConnected()).toBe(true);

        // Verify subscription is maintained by sending new transactions
        const newBlockPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('No new blocks received after reconnection'));
            }, 30000);

            network.ws.subscribeToBlocks((block) => {
                blockCount++;
                receivedBlock = block;
                clearTimeout(timeout);
                resolve();
            });
        });

        // Send new transactions after reconnection
        for (let i = 0; i < 3; i++) {
            await sendCustomTx(txInstance, generatePrivateKey(), i);
        }

        // Wait for new block after reconnection
        await newBlockPromise;

        // Assertions
        expect(blockCount).toBeGreaterThan(initialBlockCount);
        expect(receivedBlock).toBeDefined();
        expect(receivedBlock.txs).toBeDefined();
        expect(receivedBlock.txs.length).toBeGreaterThan(0);
        
        console.log('Reconnection test completed successfully:', {
            initialBlockCount,
            finalBlockCount: blockCount,
            lastBlock: receivedBlock
        });
    }, 30000);

    // it('should handle connection interruption', async () => {
    //     const ws = network.ws as any;
        
    //     // First ensure we're connected
    //     if (!network.ws.isConnected()) {
    //         await network.ws.connect();
    //     }

    //     let blockCount = 0;
    //     let lastBlockHash: string | null = null;
    //     const receivedBlocks: any[] = [];
        
    //     // Subscribe to blocks and track metrics
    //     await network.ws.subscribeToBlocks((block) => {
    //         blockCount++;
    //         lastBlockHash = block.blockHash;
    //         receivedBlocks.push(block);
    //         console.log('Received block:', {
    //             blockHash: block.blockHash,
    //             blockCount,
    //             txCount: block.txs?.length || 0
    //         });
    //     });

    //     // Initiate a transaction to trigger initial block
    //     const txInstance = await Tx.initialize(env);
    //     await sendCustomTx(txInstance, generatePrivateKey(), 0);

    //     // Wait for initial block
    //     const initialBlockPromise = new Promise<void>((resolve, reject) => {
    //         const timeout = setTimeout(() => {
    //             reject(new Error('Block not received within timeout'));
    //         }, 30000);

    //         network.ws.subscribeToBlocks((block) => {
    //             blockCount++;
    //             clearTimeout(timeout);
    //             resolve();
    //         });
    //     });

    //     await initialBlockPromise;
    //     const initialBlockCount = blockCount;
    //     const initialBlockHash = lastBlockHash;
        
    //     console.log('Initial state:', {
    //         blockCount: initialBlockCount,
    //         lastBlockHash: initialBlockHash
    //     });

    //     // Test disconnection
    //     console.log('Disconnecting...');
    //     network.ws.disconnect();
    //     await sleep(1000); // Give time for disconnect
    //     expect(network.ws.isConnected()).toBe(false);
        
    //     // Test reconnection
    //     console.log('Reconnecting...');
    //     await network.ws.connect();
    //     await sleep(1000); // Give time for connect
    //     expect(network.ws.isConnected()).toBe(true);
    //     console.log('Reconnected successfully');

    //     // Verify subscription is maintained by sending new transactions
    //     const newBlockPromise = new Promise<void>((resolve, reject) => {
    //         const timeout = setTimeout(() => {
    //             reject(new Error('No new blocks received after reconnection'));
    //         }, 30000);

    //         network.ws.subscribeToBlocks((block) => {
    //             blockCount++;
    //             clearTimeout(timeout);
    //             resolve();
    //         });
    //     });

    //     // Send new transactions after reconnection
    //     for (let i = 0; i < 3; i++) {
    //         await sendCustomTx(txInstance, generatePrivateKey(), i);
    //     }

    //     // Wait for new block after reconnection
    //     await newBlockPromise;

    //     // Add delay to ensure new blocks are produced
    //     await new Promise(resolve => setTimeout(resolve, 30000)); // 5 second delay

    //     // Assertions
    //     expect(blockCount).toBeGreaterThan(initialBlockCount);
    //     expect(lastBlockHash).not.toBe(initialBlockHash);
    //     expect(network.ws.isConnected()).toBe(true);
    //     expect(receivedBlocks[receivedBlocks.length - 1].txs).toBeDefined();
    //     expect(receivedBlocks[receivedBlocks.length - 1].txs.length).toBeGreaterThan(0);

    //     console.log('Final state:', {
    //         initialBlockCount,
    //         finalBlockCount: blockCount,
    //         initialBlockHash,
    //         finalBlockHash: lastBlockHash,
    //         totalBlocksReceived: receivedBlocks.length,
    //         lastBlockTxCount: receivedBlocks[receivedBlocks.length - 1].txs.length
    //     });
    // }, 30000);

    it('should handle handshake failure gracefully', async () => {
        const ws = network.ws as any;
        
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
                    timestamp: Date.now()
                }
            };
            ws.ws.send(JSON.stringify(invalidHandshakeMsg));
        });

        // Wait for handshake failure
        await handshakePromise;

        // Verify handshake failure response
        const handshakeAck = receivedMessages.find(msg => msg.type === 'HANDSHAKE_ACK');
        expect(handshakeAck).toBeDefined();
        expect(handshakeAck.data.success).toBe(false);
        expect(handshakeAck.data.error).toBeDefined();
    }, 10000);

    // it('should successfully subscribe and unsubscribe', async () => {
    //     const ws = network.ws as any;
        
    //     // Perform handshake
    //     const handshakeMsg = {
    //         type: 'HANDSHAKE',
    //         data: {
    //             clientId: ws.clientId || 'test-client'
    //         },
    //         timestamp: Date.now()
    //     };
    //     ws.ws.send(JSON.stringify(handshakeMsg));

    //     // Wait for handshake acknowledgment
    //     await new Promise<void>((resolve, reject) => {
    //         const timeout = setTimeout(() => reject(new Error('Handshake timeout')), 5000);
            
    //         ws.ws.on('message', (data: string) => {
    //             const message = JSON.parse(data);
    //             if (message.type === 'HANDSHAKE_ACK') {
    //                 clearTimeout(timeout);
    //                 resolve();
    //             }
    //         });
    //     });

    //     // Subscribe to blocks
    //     const subscriptionId = await network.ws.subscribeToBlocks(() => {
    //         // Callback intentionally empty for this test
    //     });
    //     expect(subscriptionId).toBeDefined();
    //     expect(typeof subscriptionId).toBe('string');

    //     // Unsubscribe from blocks and wait for acknowledgment
    //     const unsubscribePromise = new Promise<void>((resolve, reject) => {
    //         const timeout = setTimeout(() => reject(new Error('Unsubscribe timeout')), 5000);
            
    //         ws.ws.on('message', (data: string) => {
    //             const message = JSON.parse(data);
    //             if (message.type === 'UNSUBSCRIBE_ACK' && message.data.success) {
    //                 clearTimeout(timeout);
    //                 resolve();
    //             }
    //         });

    //         network.ws.unsubscribe(subscriptionId);
    //     });

    //     await unsubscribePromise;
    // }, 10000);
});