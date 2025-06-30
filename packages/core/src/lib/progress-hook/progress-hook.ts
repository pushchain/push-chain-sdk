import { ProgressEvent, ProgressHookTypeFunction } from './progress-hook.types';

const withTimestamp = (
  fn: ProgressHookTypeFunction
): ProgressHookTypeFunction => {
  return (...args: any[]) => ({
    ...fn(...args),
    timestamp: new Date().toISOString(),
  });
};

const RAW_HOOKS: Record<string, ProgressEvent | ProgressHookTypeFunction> = {
  /**
   * 00. Non-specific error
   */
  'SEND-TRANSACTION-00': (fnName: string, err: string) => ({
    id: 'SEND-TRANSACTION-00',
    title: 'Transaction Error',
    info: `[Core SDK] - Error in ${fnName}(): ${err}`,
    level: 'ERROR',
  }),

  /**
   * 01. Detect origin chain (given as function param)
   */
  'SEND-TRANSACTION-01': (originChain: string) => ({
    id: 'SEND-TRANSACTION-01',
    title: 'Origin Chain Detected',
    info: `Origin chain: ${originChain}`,
    level: 'INFO',
  }),

  /**
   * 02. Start estimating gas limit
   */
  'SEND-TRANSACTION-02': {
    id: 'SEND-TRANSACTION-02',
    title: 'Estimating Gas Limit',
    info: 'Estimating gas limit for transaction…',
    level: 'INFO',
  },

  /**
   * 03. Gas limit estimation succeeded
   */
  'SEND-TRANSACTION-03': (gasLimit: bigint) => ({
    id: 'SEND-TRANSACTION-03',
    title: 'Gas Limit Estimated',
    info: `Estimated gas limit: ${gasLimit.toString()}`,
    level: 'SUCCESS',
  }),

  /**
   * 04. Start fetching gas price
   */
  'SEND-TRANSACTION-04': {
    id: 'SEND-TRANSACTION-04',
    title: 'Fetching Gas Price',
    info: 'Retrieving current gas price…',
    level: 'INFO',
  },

  /**
   * 05. Gas price fetch succeeded
   */
  'SEND-TRANSACTION-05': (gasPrice: bigint) => ({
    id: 'SEND-TRANSACTION-05',
    title: 'Gas Price Retrieved',
    info: `Current gas price: ${gasPrice.toString()}`,
    level: 'SUCCESS',
  }),

  /**
   * 06. Total Gas cost calculated (in UPC)
   */
  'SEND-TRANSACTION-06': (gasCost: bigint) => ({
    id: 'SEND-TRANSACTION-06',
    title: 'Total Gas Cost',
    info: `Total gas cost: ${gasCost.toString()} UPC`,
    level: 'INFO',
  }),

  'SEND-TRANSACTION-07': (execCost: bigint) => ({
    id: 'SEND-TRANSACTION-07',
    title: 'Total Execution Cost',
    info: `Total execution cost (Gas cost + value): ${execCost.toString()} UPC`,
    level: 'INFO',
  }),

  /**
   * 08. Start fetching UEA details
   */
  'SEND-TRANSACTION-08': {
    id: 'SEND-TRANSACTION-08',
    title: 'Fetching UEA Details',
    info: 'Computing UEA address and checking deployment status…',
    level: 'INFO',
  },

  /**
   * 09. UEA details fetched
   */
  'SEND-TRANSACTION-09': (ueaAddress: `0x${string}`, deployed: boolean) => ({
    id: 'SEND-TRANSACTION-09',
    title: 'UEA Details Retrieved',
    info: `UEA: ${ueaAddress}, Deployed: ${deployed}`,
    level: 'SUCCESS',
  }),

  /**
   * 10. Start fetching UEA balance
   */
  'SEND-TRANSACTION-10': {
    id: 'SEND-TRANSACTION-10',
    title: 'Fetching UEA Balance',
    info: 'Querying UEA account balance…',
    level: 'INFO',
  },

  /**
   * 11. UEA balance fetched
   */
  'SEND-TRANSACTION-11': (balance: bigint) => ({
    id: 'SEND-TRANSACTION-11',
    title: 'UEA Balance Retrieved',
    info: `UEA balance: ${balance.toString()} UPC`,
    level: 'SUCCESS',
  }),

  /**
   * 12. Start fetching UEA nonce
   */
  'SEND-TRANSACTION-12': {
    id: 'SEND-TRANSACTION-12',
    title: 'Fetching UEA Nonce',
    info: 'Retrieving UEA transaction nonce…',
    level: 'INFO',
  },

  /**
   * 13. UEA nonce fetched
   */
  'SEND-TRANSACTION-13': (nonce: bigint) => ({
    id: 'SEND-TRANSACTION-13',
    title: 'UEA Nonce Retrieved',
    info: `UEA nonce: ${nonce.toString()}`,
    level: 'SUCCESS',
  }),

  /**
   * 14. Execution hash generated
   */
  'SEND-TRANSACTION-14': (execHash: string) => ({
    id: 'SEND-TRANSACTION-14',
    title: 'Universal Payload Hash Generated',
    info: `Universal Payload Hash: ${execHash}`,
    level: 'INFO',
  }),

  /**
   * 15. Locking fee on origin chain
   */
  'SEND-TRANSACTION-15': (feeAmount: bigint) => ({
    id: 'SEND-TRANSACTION-15',
    title: 'Locking Origin Chain Fee',
    info: `Locking fee: ${feeAmount.toString()} UPC on origin chain`,
    level: 'INFO',
  }),

  /**
   * 16. Transaction sent on origin chain, awaiting confirmations
   */
  'SEND-TRANSACTION-16': (txHash: string, confirmations: number) => ({
    id: 'SEND-TRANSACTION-16',
    title: 'Awaiting Origin Chain Confirmations',
    info: `Transaction sent: ${txHash}, waiting for ${confirmations} confirmations.`,
    level: 'SUCCESS',
  }),

  /**
   * 17. Required confirmations received, awaiting signing
   */
  'SEND-TRANSACTION-17': {
    id: 'SEND-TRANSACTION-17',
    title: 'Confirmations Received',
    info: 'Required confirmations received.',
    level: 'SUCCESS',
  },

  /**
   * 18. Signature Request
   */
  'SEND-TRANSACTION-18': {
    id: 'SEND-TRANSACTION-19',
    title: 'Awaiting Signature',
    info: 'Waiting for signature…',
    level: 'INFO',
  },

  /**
   * 19. Signature completed
   */
  'SEND-TRANSACTION-19': (signature: string) => ({
    id: 'SEND-TRANSACTION-19',
    title: 'Signature Completed',
    info: `Signature: ${signature}`,
    level: 'SUCCESS',
  }),

  /**
   * 20. Sending transaction on Push Chain
   */
  'SEND-TRANSACTION-20': {
    id: 'SEND-TRANSACTION-20',
    title: 'Broadcasting to Push Chain',
    info: 'Sending transaction to Push Chain…',
    level: 'INFO',
  },

  /**
   * 21. Push Chain transaction result (parses string, logs full details, checks code)
   */
  'SEND-TRANSACTION-21': (txDetailsString: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let details: any;
    try {
      details = JSON.parse(txDetailsString);
    } catch (e) {
      console.error('Failed to parse txDetails:', e, txDetailsString);
      details = { raw: txDetailsString };
    }
    const success = details.code === 0;
    return {
      id: 'SEND-TRANSACTION-21',
      title: success ? 'Push Chain Tx Success' : 'Push Chain Tx Failure',
      info: `Tx: ${txDetailsString}`,
      level: success ? 'SUCCESS' : 'ERROR',
    };
  },
};

export default PROGRESS_HOOKS;
