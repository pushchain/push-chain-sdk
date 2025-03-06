import { Box, css } from 'shared-components';
import { Header } from './Header';
import { ReactNode, FC } from 'react';

type ContentLayoutProps = {
  children: ReactNode;
};

const PageLayout: FC<ContentLayoutProps> = ({ children }) => {
  return (
    <Box
      position="relative"
      width="100%"
      height="100%"
      display="flex"
      flexDirection="column"
      css={css`
        background-color: #202124;
        overflow-x: hidden;
      `}
    >
      <Header />
      {children}
    </Box>
  );
};

export { PageLayout };
