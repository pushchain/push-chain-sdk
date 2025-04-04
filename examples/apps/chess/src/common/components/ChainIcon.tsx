import { PushMonotone } from 'shared-components';
import { CHAIN_LOGO } from '../common.utils';
import { FC } from 'react';

type ChainIconProps = {
  chainId: string;
};

const ChainIcon: FC<ChainIconProps> = ({ chainId }) => {
  if (!chainId) {
    return <PushMonotone size={24} />;
  }
  const IconComponent = CHAIN_LOGO[chainId];
  if (IconComponent) {
    return <IconComponent size={24} color="icon-tertiary" />;
  } else {
    // TO Bypass some test cases addresses
    return <PushMonotone size={24} />;
  }
};

export { ChainIcon };
