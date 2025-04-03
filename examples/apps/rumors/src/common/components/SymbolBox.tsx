import { FC, ReactNode } from 'react';
import { Box, css } from 'shared-components';

type SymbolBoxProps = {
  children: ReactNode;
  onClick: () => void;
};

const SymbolBox: FC<SymbolBoxProps> = ({ children, onClick }) => {
  return (
    <Box
      width="40px"
      height="40px"
      display="flex"
      backgroundColor="surface-tertiary"
      borderRadius="radius-xs"
      alignItems="center"
      justifyContent="center"
      cursor="pointer"
      onClick={onClick}
      css={css`
        transition: background-color 0.2s ease-in-out;
        &:hover {
          background-color: var(--surface-primary-inverse);
          span {
            color: var(--icon-secondary) !important;
          }
        }
      `}
    >
      {children}
    </Box>
  );
};

export { SymbolBox };
