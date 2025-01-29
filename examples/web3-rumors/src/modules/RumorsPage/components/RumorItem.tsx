import {
  CHAIN_LOGO,
  convertCaipToObject,
  extractWalletAddress,
  formatTimestamp,
  RumorType,
  TABS,
  trimAddress,
} from '@/common';
import {
  Box,
  CaretDown,
  CaretUp,
  css,
  PushMonotone,
  Text,
  ThumbsUp,
} from 'shared-components';
import ReactMarkdown from 'react-markdown';
import { useEffect, useState } from 'react';
import { performUpVote } from '@/services/performUpVote';
import { useAppContext } from '@/context/AppContext';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

const getChainIcon = (chainId: string) => {
  if (!chainId) {
    return <PushMonotone size={18} />;
  }
  const IconComponent = CHAIN_LOGO[chainId];
  if (IconComponent) {
    return <IconComponent size={18} color="icon-tertiary" />;
  } else {
    // TO Bypass some test cases addresses
    return <PushMonotone size={18} />;
  }
};

const RumorItem: React.FC<RumorType> = ({
  upVoteCount,
  address,
  markdownPost,
  txnHash,
  timestamp,
  wallets,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpvote, setIsUpvote] = useState(false);

  const { setMinimiseWallet } = usePushWalletContext();

  const { account, pushNetwork, setData, handleSendSignRequestToPushWallet } =
    useAppContext();

  const { result } = convertCaipToObject(address);

  const handleUpvote = async () => {
    if (isUpvote) return;
    try {
      if (pushNetwork && account) {
        await performUpVote(
          pushNetwork,
          account,
          upVoteCount,
          txnHash,
          wallets,
          handleSendSignRequestToPushWallet
        );
        setData((prev) => ({
          ...prev,
          [TABS.LATEST]: prev[TABS.LATEST].map((item) =>
            item.txnHash === txnHash
              ? {
                  ...item,
                  upVoteCount: item.upVoteCount + 1,
                  wallets: [account, ...item.wallets],
                }
              : item
          ),
          [TABS.MY_RUMORS]: prev[TABS.MY_RUMORS].map((item) =>
            item.txnHash === txnHash
              ? {
                  ...item,
                  upVoteCount: item.upVoteCount + 1,
                  wallets: [account, ...item.wallets],
                }
              : item
          ),
        }));
        setMinimiseWallet(true);
        setIsUpvote(true);
      }
    } catch (error) {
      console.error('Error performing upvote:', error);
      setIsUpvote(false);
    }
  };

  useEffect(() => {
    if (account && wallets.includes(account)) {
      setIsUpvote(true);
    }
  }, [wallets]);

  return (
    <Box
      display="flex"
      padding="spacing-md"
      gap="spacing-md"
      alignItems="flex-start"
      border="border-sm solid stroke-secondary"
      borderRadius="radius-md"
      width="100%"
      css={css`
        box-sizing: border-box;
      `}
    >
      <Box
        display="flex"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        gap="spacing-xxxs"
        height="100%"
      >
        <Box cursor={isUpvote ? 'default' : 'pointer'} onClick={handleUpvote}>
          <ThumbsUp
            size={24}
            color={isUpvote ? 'icon-state-info-bold' : 'icon-tertiary'}
          />
        </Box>
        <Text variant="bs-semibold" color="text-tertiary">
          {upVoteCount}
        </Text>
      </Box>
      <Box
        width="100%"
        overflow="hidden"
        css={css`
          text-overflow: ellipsis;
          word-break: break-word;
        `}
      >
        <Box display="flex" flexDirection="column" alignItems="flex-start">
          <Box
            display="flex"
            alignItems="center"
            gap="spacing-sm"
            justifyContent="space-between"
            width="100%"
          >
            <Box
              display="flex"
              alignItems="center"
              gap="spacing-xxs"
              overflow="hidden"
              css={css`
                white-space: nowrap;
              `}
            >
              <Text color="text-tertiary" variant="bs-semibold">
                {address && trimAddress(extractWalletAddress(address))}
              </Text>
              {result.chainId && getChainIcon(result.chainId)}
            </Box>

            {timestamp && (
              <Text
                color="text-tertiary"
                variant="bs-regular"
                css={css`
                  white-space: nowrap;
                `}
              >
                {formatTimestamp(timestamp.toString())}
              </Text>
            )}
          </Box>
          <Box
            display="flex"
            flexDirection="column"
            alignItems="flex-start"
            gap="spacing-xxxs"
          >
            <Text variant="bm-regular">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
              >
                {!isOpen && markdownPost.length > 280
                  ? `${markdownPost.slice(0, 280)}...`
                  : markdownPost}
              </ReactMarkdown>
            </Text>
            {markdownPost.length > 280 && (
              <Box
                display="flex"
                alignItems="center"
                gap="spacing-xxxs"
                cursor="pointer"
                onClick={() => setIsOpen((prev) => !prev)}
              >
                {isOpen ? (
                  <>
                    <Text variant="bm-semibold" color="text-state-info-bold">
                      Show Less
                    </Text>
                    <CaretUp color="icon-state-info-bold" />
                  </>
                ) : (
                  <>
                    <Text variant="bm-semibold" color="text-state-info-bold">
                      Show More
                    </Text>
                    <CaretDown color="icon-state-info-bold" />
                  </>
                )}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default RumorItem;
