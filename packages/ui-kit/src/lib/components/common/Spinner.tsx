import React, { FC } from 'react';
import styled, { keyframes } from 'styled-components';
import { Ellipse } from './icons';

// Keyframes for the spinning animation
const spin = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

// Styled container for the Spinner
const Container = styled.div<{
  color?: string;
}>`
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${spin} 1s linear infinite;
  width: 16px;
  height: 16px;
  color: ${({ color }) => color || 'var(--pwauth-btn-connect-text-color)'};
`;

type SpinnerProps = {
  color?: string;
}


// Spinner functional component
const Spinner: FC<SpinnerProps> = ({ color }) => {
  return (
    <Container color={color} >
      <Ellipse />
    </Container>
  );
};

export default Spinner;
