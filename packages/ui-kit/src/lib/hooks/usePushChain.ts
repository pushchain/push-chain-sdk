import { useMemo } from 'react';
import { PushChain as PushChainCore } from '@pushchain/core';

export const usePushChain = () => {
  const PushChain = useMemo(() => PushChainCore, []);
  return { PushChain };
};