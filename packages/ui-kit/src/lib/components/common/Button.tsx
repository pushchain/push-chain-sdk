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
  bgcolor?: React.CSSProperties['backgroundColor'];
  /* Text color of the button */
  textcolor?: React.CSSProperties['color'];
  /* Border Radius of the button */
  borderradius?: React.CSSProperties['borderRadius'];
  /* Spacing between the elements of the button */
  gap?: React.CSSProperties['gap'];
  padding?: React.CSSProperties['padding'];
  /* Sets button as disabled */
  disabled?: boolean;
} & TransformedHTMLAttributes<HTMLButtonElement>;

const StyledButton = styled.button<ButtonProps>`
  /* Common Button CSS */

  align-items: center;
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};
  background: ${(props) => (props.bgcolor ? props.bgcolor : '#d548ec')};
  color: ${(props) =>
    props.textcolor ? props.textcolor : 'rgba(255, 255, 255, 1)'};
  display: flex;
  font-family: var(--pw-int-font-family);
  justify-content: center;
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 16px;
  padding: ${(props) =>
    props.padding ? props.padding : '16px 24px'};
  min-width: 100px;
  width: inherit;
  height: 48px;
  gap: ${(props) =>
    props.gap ? props.gap : '4px'};
  border: none;
  border-radius: ${(props) =>
    props.borderradius ? props.borderradius : '12px'};
  white-space: nowrap;
`;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ disabled, bgcolor, textcolor, borderradius, gap, padding, children, ...props }, ref) => (
    <StyledButton
      {...(disabled ? { 'aria-disabled': true } : {})}
      disabled={disabled}
      role="button"
      ref={ref}
      bgcolor={bgcolor}
      textcolor={textcolor}
      borderradius={borderradius}
      gap={gap}
      padding={padding}
      {...props}
    >
      {children}
    </StyledButton>
  )
);

Button.displayName = 'Button';

export { Button };
