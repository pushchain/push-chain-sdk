import { ClientOptions } from '../vm-client/vm-client.types';

export type PushClientOptions = ClientOptions & {
  tendermintRpcUrl: string;
};
