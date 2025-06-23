export type TokenReply = { apiToken: string; apiUrl: string };

export type PingReply = {
  nodeId: string;
  tsMillis: number;
  status: string;
};

export type ActiveValidator = {
  nodeWallet: string;
  nodeApiBaseUrl: string;
};

/**
 * @description Validator contract interface ( VIEM CLIENT )
 */
export type ValidatorContract = {
  read: {
    getActiveVNodes(): Promise<ActiveValidator[]>;
    nodeMap(address: string): Promise<NodeInfo>;
  };
};

export type JsonRpcRequest = {
  jsonrpc: string;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
  id: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonRpcResponse<T = any> = {
  jsonrpc: string;
  result: T;
  id: number;
  error?: {
    code: number;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
  };
};

type NodeInfo = {
  ownerWallet: string;
  nodeWallet: string;
  nodeType: NodeType;
  nodeApiBaseUrl: string;
  status: NodeStatus;
};

enum NodeType {
  VNode = 0, // validator 0
  SNode = 1, // storage 1
  DNode = 2, // delivery 2
}

enum NodeStatus {
  OK,
  Reported,
  Slashed,
  BannedAndUnstaked,
  Unstaked,
}
