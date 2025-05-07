import { Box, Spinner } from 'shared-components';
import RumorItem from './RumorItem';
import { useAppContext } from '@/context/AppContext';
import { useEffect, useRef, useState } from 'react';
import { TABS } from '@/common';

type RumorsListProps = {
  containerRef: React.RefObject<HTMLElement>;
};

const RumorsList: React.FC<RumorsListProps> = ({ containerRef }) => {
  const {
    currTab,
    data,
    hasMore,
    fetchSentConfessions,
    fetchConfessions,
    loading,
    easterData,
  } = useAppContext();

  const [pages, setPages] = useState({
    [TABS.LATEST]: 2,
    [TABS.MY_RUMORS]: 2,
  });
  const isFetchingRef = useRef(false);

  const handleScroll = () => {
    if (isFetchingRef.current || !hasMore[currTab]) return;

    const container = containerRef.current;

    if (
      container &&
      container.scrollTop + container.clientHeight >=
        container.scrollHeight - 50
    ) {
      fetchData(currTab);
    }
  };

  const fetchData = async (tab: TABS) => {
    if (loading[tab] || isFetchingRef.current) return;

    isFetchingRef.current = true;

    try {
      const page = pages[tab];
      const fetchFn =
        tab === TABS.MY_RUMORS ? fetchSentConfessions : fetchConfessions;
      await fetchFn(page);
      setPages((prev) => ({
        ...prev,
        [tab]: prev[tab] + 1,
      }));
    } catch (error) {
      console.error(`Error fetching data for ${tab}:`, error);
    } finally {
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasMore, currTab, loading]);

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap="spacing-md"
    >
      {easterData && currTab === TABS.LATEST && (<RumorItem pinned {...easterData} />)}
      {loading[currTab] && data[currTab].length === 0 && (
        <Spinner size="medium" />
      )}
      {data[currTab].map((item) => (
        <RumorItem key={item.txnHash} {...item} />
      ))}
      {loading[currTab] && data[currTab].length > 0 && (
        <Spinner size="medium" />
      )}
    </Box>
  );
};

export default RumorsList;
