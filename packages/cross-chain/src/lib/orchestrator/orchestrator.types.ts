export type ExecuteParams = {
  target: string; // contract or recipient on Push Chain
  value?: bigint; // native token value
  data?: `0x${string}`; // encoded function call or transfer data
};
