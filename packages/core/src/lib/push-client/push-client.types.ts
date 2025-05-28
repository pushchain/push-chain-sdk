import { NETWORK } from '../constants/enums';
import { ClientOptions } from '../vm-client/vm-client.types';

export type PushClientOptions = ClientOptions & {
  network: NETWORK;
};
