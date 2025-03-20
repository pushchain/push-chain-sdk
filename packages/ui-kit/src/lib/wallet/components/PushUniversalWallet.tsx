import React, { ReactNode } from 'react';
import { ConnectPushWalletButton } from './ConnectPushWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import { UniversalAddress } from '../wallet.types';

type PushUniversalWalletProps = {
    universalAddress: UniversalAddress | null;
    component?: ReactNode;
    title?: string;
    styling?: React.CSSProperties;
};

const PushUniversalWallet: React.FC<PushUniversalWalletProps> = ({
    universalAddress,
    component,
    title = 'Login',
    styling,
}) => {
    // If universal address is present render the button
    if (universalAddress) {
        return <TogglePushWalletButton universalAddress={universalAddress} />;
    } else if (component) {
        // If no UA and custom component, then render the component
        return <>{component}</>;
    } else return <ConnectPushWalletButton title={title} styling={styling} />; // If no UA and no custom component, then render the connect button
};

export { PushUniversalWallet };
