import React, { FC } from 'react';
import styled from 'styled-components';
import { CrossIcon, Spinner, TickIcon, WarningIcon } from "../../components/common";
import { PROGRESS_HOOK, ProgressEvent } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';

type PushWalletToastProps = {
    progress: ProgressEvent;
    setProgress: React.Dispatch<React.SetStateAction<ProgressEvent | null>>;
}

const PushWalletToast: FC<PushWalletToastProps> = ({ progress, setProgress }) => {
    if (!progress) return <></>
    return (
        <ToastContainer>
            <IconContainer>
                {
                    progress.id === PROGRESS_HOOK.SEND_TX_99_01 ? <TickIcon /> :
                    progress.id === PROGRESS_HOOK.SEND_TX_99_02 ? <WarningIcon /> :
                    <Spinner color='var(--pw-int-brand-primary-color)' />
                }
            </IconContainer>
            <TitleText>{progress.title}</TitleText>
            <CloseContainer onClick={() => setProgress(null)}>
                <CrossIcon height='18px' width='18px' color='#000000' />
            </CloseContainer>
        </ToastContainer>
    );
};

export { PushWalletToast };

const ToastContainer = styled.div`
    position: fixed;
    bottom: 40px;
    right: 30px;
    display:flex;
    flex-direction:row;
    gap:8px;
    align-items:center;
    border:1px solid #EAEBF2;
    padding:16px;
    border-radius:16px;
    background-color:#fff;
    z-index:9999;
    width:320px;
    max-width: 100%;
`

const TitleText = styled.h4`
    font-size:14px;
    font-weight:500;
    line-height:21px;
    margin:0;
    font-family:var(--pw-int-font-family);
    color:#17181B;
`

const IconContainer = styled.div`
    height: 18px;
    width: 18px;
`

const CloseContainer = styled.div`
    display: flex;
    margin-left: auto;
    align-items: center;
    cursor: pointer;
`