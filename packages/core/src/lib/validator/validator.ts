import axios from 'axios';
import { URL } from 'url';
import { createPublicClient, getContract, http } from 'viem';
import config from '../config';
import { ENV } from '../constants';
import { getRandomElement } from '../utils';
import {
  ActiveValidator,
  JsonRpcRequest,
  JsonRpcResponse,
  ValidatorContract,
} from './validator.types';

/**
 * @description Push validator class is used for the following:
 * - Interact with validator.sol ( Only Read calls )
 * - Get token to interact with a random validator node
 * - Ping a random validator node to check if it is alive
 *
 *
 * todo rename to transport
 * we're talking to 3 very different entities
 * Validator.sol
 * anodes
 * vnodes
 * !
 * the 'validator' name does not represent the right thing here
 *
 */
export class Validator {
  private static instance: Validator;
  private static idCounter = 0;
  private static printTraces = false;

  private constructor(
    /**
     * @dev - active validator URL (Used for Get calls to a validator node)
     */
    public activeValidatorURL: string,
    private env: ENV,
    private validatorContractClient: ValidatorContract
  ) {}

  static initalize = async (options?: {
    env?: ENV;
    printTraces?: boolean;
    rpcUrl?: string;
  }): Promise<Validator> => {
    const settings = {
      env: options?.env || ENV.DEVNET,
      rpcUrl: options?.rpcUrl,
    };
    Validator.printTraces = options?.printTraces || false;

    /**
     * @dev - If instance is not created or env is different, create a new instance
     */
    if (!Validator.instance || Validator.instance.env !== settings.env) {
      const validatorContractClient = Validator.createValidatorContractClient(
        settings.env,
        settings.rpcUrl
      );
      const activeValidator = await Validator.getActiveValidator(
        validatorContractClient
      );
      Validator.instance = new Validator(
        activeValidator.nodeApiBaseUrl,
        settings.env,
        validatorContractClient
      );
    }
    return Validator.instance;
  };

  /**
   * @description Create validator contract client
   * @param env - Environment
   * @param rpcUrl
   * @dev - Currently only supports public client
   * @returns Validator contract client
   */
  private static createValidatorContractClient = (
    env: ENV,
    rpcUrl?: string
  ): ValidatorContract => {
    const client = createPublicClient({
      chain: config.VALIDATOR[env].NETWORK,
      transport: rpcUrl ? http(rpcUrl) : http(),
    });

    return getContract({
      abi: config.ABIS.VALIDATOR,
      address: config.VALIDATOR[env].VALIDATOR_CONTRACT as `0x${string}`,
      client: {
        // Viem type causes issue with some codebases
        public: client as never,
      },
    }) as unknown as ValidatorContract;
  };

  /**
   * @description - Send a JSON RPC Req
   */
  private static sendJsonRpcRequest = async <T>(
    url: string,
    method: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any = []
  ): Promise<T> => {
    const requestBody: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: this.idCounter++,
    };

    try {
      if (this.printTraces) {
        console.log(
          `>> Calling RPC POST ${url} (req${requestBody.id}) with body %o`,
          requestBody
        );
      }
      const response = await axios.post<JsonRpcResponse<T>>(url, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      if (response.data.error) {
        console.error('JSON-RPC Error:', response.data.error);
        throw Error(response.data.error.message);
      }
      if (this.printTraces) {
        console.log(
          `<< RPC Reply POST ${url} (req${requestBody.id}) code: ${response.status} with body: %o`,
          response?.data
        );
      }
      return response.data.result;
    } catch (error) {
      console.error('Error sending JSON-RPC request:', error);
      throw error;
    }
  };

  /**
   * @description Ping a validator
   * @param validatorUrl - Validator URL to ping
   */
  public static ping = async (validatorUrl: string): Promise<boolean> => {
    return await this.sendJsonRpcRequest<boolean>(
      Validator.vNodeUrlModifier(validatorUrl),
      'push_listening'
    );
  };

  /**
   * @description Get active validator
   * @returns Active validator object
   */
  private static getActiveValidator = async (
    validatorContractClient: ValidatorContract
  ): Promise<ActiveValidator> => {
    const activeValidators =
      await validatorContractClient.read.getActiveVNodes();
    const validator = getRandomElement(activeValidators);
    const isListening = await this.ping(validator.nodeApiBaseUrl);
    if (isListening) {
      return validator;
    } else {
      return await this.getActiveValidator(validatorContractClient);
    }
  };

  private static vNodeUrlModifier = (url: string) => {
    let fixedUrl = url;
    if (url.includes('.local')) {
      const urlObj = new URL(url);
      urlObj.hostname = 'localhost';
      urlObj.protocol = 'http:';
      fixedUrl = urlObj.toString();
    }
    if (fixedUrl.endsWith('/')) {
      fixedUrl = fixedUrl.slice(0, -1);
    }
    return `${fixedUrl}/api/v1/rpc`;
  };

  /**
   * @dev - This is a Temp Function which will be removed in the future
   */
  private ReqModifier = (url: string, fnName: string) => {
    let modifiedUrl = Validator.vNodeUrlModifier(url);
    let modifiedFnName = fnName;
    if (
      fnName === 'push_getBlocks' ||
      fnName === 'push_getBlockByHash' ||
      fnName === 'push_getTransactions' ||
      fnName === 'push_getTransactionByHash' ||
      fnName === 'push_getTransactionsByUser' ||
      fnName === 'push_getTransactionsBySender' ||
      fnName === 'push_getTransactionsByRecipient'
    ) {
      if (this.env === ENV.LOCAL) {
        modifiedUrl = 'http://localhost:5001/rpc';
      }
      if (this.env === ENV.DEVNET) {
        const anodes = ['aa1', 'aa2', 'aa3', 'aa4', 'aa5'];
        const randomAnode = getRandomElement(anodes);
        modifiedUrl = `https://${randomAnode}.dev.push.org/rpc`;
      }
      modifiedFnName = `RpcService.${fnName.replace('push_', '')}`;

      if (fnName === 'push_getTransactions') {
        modifiedFnName = 'RpcService.getTxs';
      }
      if (fnName === 'push_getTransactionsByUser') {
        modifiedFnName = 'RpcService.getTransactionsByUser';
      }
      if (fnName === 'push_getTransactionsBySender') {
        modifiedFnName = 'RpcService.getTxsBySender';
      }
      if (fnName === 'push_getTransactionsByRecipient') {
        modifiedFnName = 'RpcService.getTxsByRecipient';
      }
      if (fnName === 'push_getTransactionByHash') {
        modifiedFnName = 'RpcService.getTxByHash';
      }
    }
    return { url: modifiedUrl, fnName: modifiedFnName };
  };

  /**
   * @description Get calls to validator
   * @returns Reply of the call
   *
   * todo rename to callANode
   */
  public call = async <T>(
    fnName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any[] = [],
    url: string = this.activeValidatorURL
  ): Promise<T> => {
    return await Validator.sendJsonRpcRequest<T>(
      this.ReqModifier(url, fnName).url,
      this.ReqModifier(url, fnName).fnName,
      params
    );
  };

  /**
   * @description Get calls to validator without any modifications
   * @returns Reply of the call
   */
  public async callVNode<T>(
    fnName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any[] = [],
    vNodeUrl: string = this.activeValidatorURL
  ): Promise<T> {
    // url = "https://vv1.dev.push.org/api/v1/rpc/"
    const apiUrl = Validator.fixVNodeUrl(vNodeUrl);
    return await Validator.sendJsonRpcRequest<T>(apiUrl, fnName, params);
  }

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
      urlObj.protocol = 'http:';
    } else {
      urlObj.protocol = 'https:';
    }
    if (urlObj.pathname.trim().length == 0 || urlObj.pathname.trim() === '/') {
      urlObj.pathname = '/api/v1/rpc';
    }
    if (urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.toString();
  }
}
