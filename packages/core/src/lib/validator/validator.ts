import { getRandomElement } from '../utils';
import {
  ActiveValidator,
  JsonRpcRequest,
  JsonRpcResponse,
  ValidatorContract,
} from './validator.types';
import axios from 'axios';
import { createPublicClient, getContract, http } from 'viem';
import config from '../config';
import { ENV } from '../constants';

/**
 * @description Push validator class is used for the following:
 * - Interact with validator.sol ( Only Read calls )
 * - Get token to interact with a random validator node
 * - Ping a random validator node to check if it is alive
 */
export class Validator {
  private static instance: Validator;
  private static idCounter = 0;

  private constructor(
    /**
     * @dev - active validator URL ( Used for Get calls to a validator node )
     */
    private activeValidatorURL: string,
    private env: ENV,
    private validatorContractClient: ValidatorContract
  ) {}

  static initalize = async (options?: { env?: ENV }): Promise<Validator> => {
    const settings = {
      env: options?.env || ENV.STAGING,
    };

    /**
     * @dev - If instance is not created or env is different, create a new instance
     */
    if (!Validator.instance || Validator.instance.env !== settings.env) {
      const validatorContractClient = Validator.createValidatorContractClient(
        settings.env
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
   * @dev - Currently only supports public client
   * @returns Validator contract client
   */
  private static createValidatorContractClient = (
    env: ENV
  ): ValidatorContract => {
    const client = createPublicClient({
      chain: config.VALIDATOR[env].NETWORK,
      transport: http(),
    });
    return getContract({
      abi: config.ABIS.VALIDATOR,
      address: config.VALIDATOR[env].VALIDATOR_CONTRACT as `0x${string}`,
      client: {
        public: client,
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
    params?: any
  ): Promise<T> => {
    const requestBody: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: this.idCounter++,
    };

    // Local Docker URL Mapping Changes
    const vUrl = () => {
      if (url.includes('.local')) {
        return url.replace('.local', '.localh');
      }
      return url;
    };

    try {
      const response = await axios.post<JsonRpcResponse<T>>(
        `${vUrl()}/api/v1/rpc`,
        requestBody
      );

      if (response.data.error) {
        console.error('JSON-RPC Error:', response.data.error);
        throw Error(response.data.error.message);
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
  private static ping = async (validatorUrl: string): Promise<boolean> => {
    return await this.sendJsonRpcRequest<boolean>(
      validatorUrl,
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

    // TODO: REMOVE RETURN STATEMENT
    return validator;

    const isListening = await this.ping(validator.nodeApiBaseUrl);
    if (isListening) {
      return validator;
    } else {
      return await this.getActiveValidator(validatorContractClient);
    }
  };

  /**
   * @description Get calls to validator
   * @returns Reply of the call
   */
  public call = async <T>(
    fnName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any[] = [],
    url: string = this.activeValidatorURL
  ): Promise<T> => {
    return await Validator.sendJsonRpcRequest<T>(url, fnName, params);
  };
}
