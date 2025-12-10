import React, { FC, useState } from 'react';
import { PROGRESS_HOOK, ProgressEvent } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';
import styled from 'styled-components';
import { CrossIcon, Spinner, TickIcon, WarningIcon } from "../../components/common";
import CaretDown from '../common/icons/CaretDown';
import CaretUp from '../common/icons/CaretUp';

type PushWalletToastProps = {
    progress: ProgressEvent | null;
    setProgress: React.Dispatch<React.SetStateAction<ProgressEvent | null>>;
}

const PushWalletToast: FC<PushWalletToastProps> = ({ progress, setProgress }) => {
    const [isOpen, setIsOpen] = useState(false); 

    const handleViewOnScan = (txnHash: string) => {
        if (txnHash) {
            window.open(`https://donut.push.network/tx/${txnHash}`, '_blank');
        }
    };

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
            <ContentContainer>
                <TitleText>{progress.title}</TitleText>
                {
                    progress.id === PROGRESS_HOOK.SEND_TX_99_01 &&
                    progress.response && 
                    (
                        <LinkText
                            onClick={() => handleViewOnScan((progress.response as Array<Record<string, any>>)[0]['hash'])}
                        >
                            View in Explorer
                        </LinkText>
                    )
                }
                {
                    progress.id === PROGRESS_HOOK.SEND_TX_99_02 &&
                    progress.message && 
                    (
                        <DescriptionContainer>
                            <DescriptionText expanded={isOpen}>{progress.message}</DescriptionText>
                            {isOpen ?
                                <ExpandButton onClick={() => setIsOpen(false)}>
                                    View Less
                                    <CaretUp height='18px' width='18px' color='#6B7280' />
                                </ExpandButton> : 
                                <ExpandButton onClick={() => setIsOpen(true)}>
                                    View More
                                    <CaretDown height='18px' width='18px' color='#6B7280' />
                                </ExpandButton>
                            }
                        </DescriptionContainer>
                    )
                }
            </ContentContainer>
            <CloseContainer onClick={() => {
                setProgress(null);
                setIsOpen(false);
            }}>
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
    align-items: flex-start;
    border:1px solid #EAEBF2;
    padding:16px;
    border-radius:16px;
    background-color:#fff;
    z-index:9999;
    width:320px;
    max-width: 100%;
`

const ContentContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: flex-start;
    width: 80%;
    gap: 2px;
`

const TitleText = styled.h4`
    font-size:14px;
    font-weight:500;
    line-height:21px;
    margin:0;
    font-family:var(--pw-int-font-family);
    color:#17181B;
`

const DescriptionContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
`

const DescriptionText = styled.span<{ expanded?: boolean }>`
    font-size:12px;
    font-weight:400;
    line-height:18px;
    margin:0;
    font-family:var(--pw-int-font-family);
    color: #313338;
    width: 100%;
    text-overflow: ellipsis;
    text-wrap: wrap;
    overflow: hidden;
    white-space: ${({ expanded }) => (expanded ? 'pre-wrap' : 'nowrap')};
`

const ExpandButton = styled.div`
    display: flex;
    align-items: center;
    font-family: var(--pw-int-font-family);
    font-size: 12px;
    color: #6B7280;
    cursor: pointer;

    &:hover {
        color: #4B5563;
    }
`

const LinkText = styled.span`
    font-size:12px;
    font-weight:400;
    line-height:21px;
    cursor: pointer;
    color: #0056D0;
    font-family:var(--pw-int-font-family);
`

const IconContainer = styled.div`
    height: 21px;
    width: 18px;
    display: flex;
    align-items: center;
`

const CloseContainer = styled.div`
    display: flex;
    margin-left: auto;
    align-items: center;
    cursor: pointer;
    height: 21px;
`