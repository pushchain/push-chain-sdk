import React, { FC, ReactNode } from 'react';
import styled from 'styled-components';

type ButtonProps = {
    children: ReactNode,
    onClick: () => void,
    disabled?: boolean
}

const Button: FC<ButtonProps> = ({ children, onClick, disabled = false }) => {
    return (
        <ConnectButton
            onClick={onClick}
            disabled={disabled}
        >
            {children}
        </ConnectButton>
    );
};

export default Button;

const ConnectButton = styled.button`
    display: flex;
    align-items: center;
    cursor: pointer;
    justify-content: center;
    white-space: nowrap;
    flex-shrink: 0;
    border: none;
    background-color: #d548ec;
    color: rgba(255, 255, 255, 1);
    border-radius: 12px;
    gap: 4px;
    height: 48px;
    padding: 16px 24px;
    min-width: 100px;
    leading-trim: both;
    text-edge: cap;
    font-family: FK Grotesk Neu;
    font-size: 16px;
    font-style: normal;
    font-weight: 500;
    line-height: 16px;
    width: inherit;

`