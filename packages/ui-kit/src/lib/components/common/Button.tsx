import React, { HTMLAttributes, ReactNode, forwardRef } from 'react';
import styled from 'styled-components';

export type TransformedHTMLAttributes<T> = Omit<
  HTMLAttributes<T>,
  'style' | 'color'
>;

export type ButtonProps = {
  /* Child react nodes rendered by Box */
  children?: ReactNode;
  /* Background color of the button */
  bgColor?: React.CSSProperties['backgroundColor'];
  /* Text color of the button */
  textColor?: React.CSSProperties['color'];
  /* Border Radius of the button */
  borderRadius?: React.CSSProperties['borderRadius'];
  /* Spacing between the elements of the button */
  gap?: React.CSSProperties['gap'];
  padding?: React.CSSProperties['padding'];
  /* Sets button as disabled */
  disabled?: boolean;
  style?: React.CSSProperties;
} & TransformedHTMLAttributes<HTMLButtonElement>;

const StyledButton = styled.button<{
  $bgColor?: ButtonProps['bgColor'];
  $textColor?: ButtonProps['textColor'];
  $borderRadius?: ButtonProps['borderRadius'];
  $gap?: ButtonProps['gap'];
  $padding?: ButtonProps['padding'];
  $disabled?: ButtonProps['disabled'];
}>`
  /* Common Button CSS */

  align-items: center;
  cursor: ${({ $disabled }) => ($disabled ? 'not-allowed' : 'pointer')};
  background: ${({ $bgColor }) => ($bgColor ? $bgColor : '#d548ec')};
  color: ${({ $textColor }) =>
    $textColor ? $textColor : 'rgba(255, 255, 255, 1)'};
  display: flex;
  font-family: var(--pw-int-font-family);
  justify-content: center;
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 16px;
  padding: ${({ $padding }) =>
    $padding ? $padding : '16px 24px'};
  min-width: 100px;
  width: inherit;
  height: 48px;
  gap: ${({ $gap }) =>
    $gap ? $gap : '4px'};
  border: none;
  border-radius: ${({ $borderRadius }) =>
    $borderRadius ? $borderRadius : '12px'};
  white-space: nowrap;
`;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ disabled, bgColor, textColor, borderRadius, gap, padding, style, children, ...props }, ref) => (
    <StyledButton
      {...(disabled ? { 'aria-disabled': true } : {})}
      style={style}
      role="button"
      ref={ref}
      $bgColor={bgColor}
      $textColor={textColor}
      $borderRadius={borderRadius}
      $gap={gap}
      $padding={padding}
      $disabled={disabled}
      {...props}
    >
      {children}
    </StyledButton>
  )
);

Button.displayName = 'Button';

export { Button };
