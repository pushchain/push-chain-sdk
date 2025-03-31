import React, { ReactNode } from 'react';
import { ConnectPushWalletButton } from './ConnectPushWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import { UniversalAddress } from '../wallet.types';
import { PushWalletIFrame } from './PushWalletIFrame';
import styled from 'styled-components';

type PushUniversalWalletProps = {
    universalAddress: UniversalAddress | null;
    component?: ReactNode;
    title?: string;
    styling?: React.CSSProperties;
};

const RenderWallet: React.FC<PushUniversalWalletProps> = ({
    universalAddress,
    component,
    title = 'Login',
    styling
}) => {

    if (universalAddress) {
        return <TogglePushWalletButton universalAddress={universalAddress} />;
    } else if (component) {
        // If no UA and custom component, then render the component
        return <>{component}</>;
    } else return <ConnectPushWalletButton title={title} styling={styling} />;
}

const PushUniversalWallet: React.FC<PushUniversalWalletProps> = ({
    universalAddress,
    component,
    title = 'Login',
    styling,
}) => {
    return (
        <WalletContainer>
            <RenderWallet universalAddress={universalAddress} component={component} title={title} styling={styling} />
            <PushWalletIFrame />
        </WalletContainer>
    )
};



export { PushUniversalWallet };

const WalletContainer = styled.div`
    position:relative;  
`
