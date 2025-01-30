import { Box, css, Tabs, Text } from 'shared-components';
import { Header } from './components/Header';
import { TABS } from '@/common';
import { useAppContext } from '@/context/AppContext';
import RumorsList from './components/RumorsList';
import NewRumor from './components/NewRumor';
import { useRef } from 'react';

const RumorsScreen = () => {
  const { currTab, isMobile, setCurrTab } = useAppContext();

  const containerRef = useRef<HTMLElement>(null);

  return (
    <Box
      position="relative"
      width="100%"
      height="100vh"
      display="flex"
      flexDirection="column"
    >
      <Header />
      <NewRumor />
      <Box
        ref={containerRef}
        alignSelf="center"
        display="flex"
        flexDirection="column"
        alignItems="center"
        width="100%"
        css={css`
          overflow-y: auto;
        `}
      >
        <Box
          maxWidth="100%"
          css={css`
            box-sizing: border-box;
            margin-top: 24px;
          `}
        >
          <Tabs
            variant="fill"
            activeKey={currTab}
            onChange={(tab) => setCurrTab(tab as TABS)}
            items={[
              {
                key: TABS.LATEST,
                label: (
                  <Text variant="h5-semibold">
                    {isMobile ? 'New' : 'Latest Rumors'}
                  </Text>
                ),
                children: null,
              },
              {
                key: TABS.MY_RUMORS,
                label: <Text variant="h5-semibold">My Rumors</Text>,
                children: null,
              },
            ]}
          />
        </Box>
        <Box
          padding="spacing-xs"
          maxWidth="800px"
          width="100%"
          css={css`
            box-sizing: border-box;
          `}
        >
          <RumorsList containerRef={containerRef} />
        </Box>
      </Box>
    </Box>
  );
};

export default RumorsScreen;
