import { DragEventHandler, forwardRef, ReactNode, useRef } from 'react';
import styled, { FlattenSimpleInterpolation } from 'styled-components';

export type FileUploadProps = {
  children?: ReactNode;
  css?: FlattenSimpleInterpolation;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop?: DragEventHandler;
  id: string;
};

const Container = styled.div<{ css?: FlattenSimpleInterpolation }>`
  align-items: center;
  display: flex;
  flex-direction: column;
  flex: 1 0 0;
  gap: var(--spacing-xxs, 8px);

  /* Custom CSS applied via styled component css prop */
  ${(props) => props.css || ''};
`;

export const FileUpload = forwardRef<HTMLInputElement, FileUploadProps>(
  ({ disabled, children, onChange, onDrop, id }, ref) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDragOver: DragEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e);
      
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    };

    return (
      <Container ref={ref} onDrop={onDrop} onDragOver={handleDragOver}>
        {children}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/*"
          hidden
          disabled={!!disabled}
          {...(disabled ? { 'aria-disabled': true } : {})}
          onChange={handleChange}
        />
      </Container>
    );
  }
);
