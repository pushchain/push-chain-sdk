import React, { FC } from 'react';
import styled from 'styled-components';
import { Spinner } from "../../components/common";

type PushWalletToastProps = {
    toast: string | null;
}

const PushWalletToast: FC<PushWalletToastProps> = ({toast}) => {
    if (!toast) return <></>
    return (
        <ToastContainer>
            <Spinner color='var(--pw-int-brand-primary-color)' />
            <TitleText>{toast}</TitleText>
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
    gap:12px;
    align-items:center;
    border:1px solid #C4CBD5;
    padding:10px 20px;
    border-radius:10px;
    background-color:#fff;
    z-index:9999;
`

const TitleText = styled.h4`
    font-size:18px;
    font-weight:400;
    margin:0;
    font-family: var(--pw-int-font-family);
`