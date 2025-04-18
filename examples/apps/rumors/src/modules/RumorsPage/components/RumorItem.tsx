import {
  CHAIN_LOGO,
  convertCaipToObject,
  easterRumor,
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
  ThumbsDown,
  ThumbsUp,
} from 'shared-components';
import ReactMarkdown from 'react-markdown';
import { useEffect, useState } from 'react';
import { performUpVote } from '@/services/performUpVote';
import { useAppContext } from '@/context/AppContext';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { performDownVote } from '@/services/performDownVote';
import { checkAndUpdateVoteActivity } from '@/services/rewards';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';

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

interface RumorItemProps extends RumorType {
  pinned?: boolean;
}

const RumorItem: React.FC<RumorItemProps> = ({
  address,
  markdownPost,
  txnHash,
  timestamp,
  upvoteWallets,
  downvoteWallets,
  pinned = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpvote, setIsUpvote] = useState(false);
  const [isDownvote, setIsDownvote] = useState(false);

  const { account, pushChain, setData, setEasterData } = useAppContext();
  const { universalAddress } = usePushWalletContext();

  const { result } = convertCaipToObject(address);

  const handleUpvote = async () => {
    if (!txnHash) return;
    try {
      if (pushChain && account) {
        await performUpVote(
          pushChain,
          account,
          timestamp,
          upvoteWallets,
          downvoteWallets,
        );
        if (universalAddress) {
          checkAndUpdateVoteActivity(universalAddress, 'upvote', txnHash);
        }
        if (upvoteWallets.includes(account)) {
          if (txnHash === easterRumor.txnHash) {
            setEasterData((item) => (item && {
              ...item,
              upvoteWallets: item.upvoteWallets.filter(
                (w) => w !== account
              ),
            }));
          } else {
            setData((prev) => ({
              ...prev,
              [TABS.LATEST]: prev[TABS.LATEST].map((item) =>
                item.txnHash === txnHash
                  ? {
                      ...item,
                      upvoteWallets: item.upvoteWallets.filter(
                        (w) => w !== account
                      ),
                    }
                  : item
              ),
              [TABS.MY_RUMORS]: prev[TABS.MY_RUMORS].map((item) =>
                item.txnHash === txnHash
                  ? {
                      ...item,
                      upvoteWallets: item.upvoteWallets.filter(
                        (w) => w !== account
                      ),
                    }
                  : item
              ),
            }));
          }
        } else {
          if (txnHash === easterRumor.txnHash) {
            setEasterData((item) => (item && {
              ...item,
              upvoteWallets: [account, ...item.upvoteWallets],
              downvoteWallets: item.downvoteWallets.filter(
                (w) => w !== account
              ),
            }))
          } else {
            setData((prev) => ({
              ...prev,
              [TABS.LATEST]: prev[TABS.LATEST].map((item) =>
                item.txnHash === txnHash
                  ? {
                      ...item,
                      upvoteWallets: [account, ...item.upvoteWallets],
                      downvoteWallets: item.downvoteWallets.filter(
                        (w) => w !== account
                      ),
                    }
                  : item
              ),
              [TABS.MY_RUMORS]: prev[TABS.MY_RUMORS].map((item) =>
                item.txnHash === txnHash
                  ? {
                      ...item,
                      upvoteWallets: [account, ...item.upvoteWallets],
                      downvoteWallets: item.downvoteWallets.filter(
                        (w) => w !== account
                      ),
                    }
                  : item
              ),
            }));
          }
        }
      }
    } catch (error) {
      console.error('Error performing upvote:', error);
      setIsUpvote(false);
    }
  };

  const handleDownvote = async () => {
    if (!txnHash) return;
    try {
      if (pushChain && account) {
        await performDownVote(
          pushChain,
          account,
          timestamp,
          upvoteWallets,
          downvoteWallets,
        );
        if (universalAddress) {
          checkAndUpdateVoteActivity(universalAddress, 'downvote', txnHash);
        }
        if (downvoteWallets.includes(account)) {
          setData((prev) => ({
            ...prev,
            [TABS.LATEST]: prev[TABS.LATEST].map((item) =>
              item.txnHash === txnHash
                ? {
                    ...item,
                    downvoteWallets: item.downvoteWallets.filter(
                      (w) => w !== account
                    ),
                  }
                : item
            ),
            [TABS.MY_RUMORS]: prev[TABS.MY_RUMORS].map((item) =>
              item.txnHash === txnHash
                ? {
                    ...item,
                    downvoteWallets: item.downvoteWallets.filter(
                      (w) => w !== account
                    ),
                  }
                : item
            ),
          }));
        } else {
          setData((prev) => ({
            ...prev,
            [TABS.LATEST]: prev[TABS.LATEST].map((item) =>
              item.txnHash === txnHash
                ? {
                    ...item,
                    downvoteWallets: [account, ...item.downvoteWallets],
                    upvoteWallets: item.upvoteWallets.filter(
                      (w) => w !== account
                    ),
                  }
                : item
            ),
            [TABS.MY_RUMORS]: prev[TABS.MY_RUMORS].map((item) =>
              item.txnHash === txnHash
                ? {
                    ...item,
                    downvoteWallets: [account, ...item.downvoteWallets],
                    upvoteWallets: item.upvoteWallets.filter(
                      (w) => w !== account
                    ),
                  }
                : item
            ),
          }));
        }
      }
    } catch (error) {
      console.error('Error performing upvote:', error);
      setIsUpvote(false);
    }
  };

  useEffect(() => {
    if (account && upvoteWallets.includes(account)) {
      setIsUpvote(true);
    } else {
      setIsUpvote(false);
    }
  }, [account, upvoteWallets]);

  useEffect(() => {
    if (account && downvoteWallets.includes(account)) {
      setIsDownvote(true);
    } else {
      setIsDownvote(false);
    }
  }, [account, downvoteWallets]);

  return (
    <Box
      display="flex"
      padding="spacing-md"
      gap="spacing-md"
      alignItems="flex-start"
      border={`border-sm solid ${pinned ? 'stroke-state-info-bold' : 'stroke-secondary'}`}
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
        gap="spacing-xs"
        height="100%"
      >
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
        >
          <Box cursor="pointer" onClick={handleUpvote}>
            <ThumbsUp
              size={16}
              color={isUpvote ? 'icon-state-info-bold' : 'icon-tertiary'}
            />
          </Box>
          <Text variant="bs-semibold" color="text-tertiary">
            {upvoteWallets.length}
          </Text>
        </Box>

        <Box cursor="pointer" onClick={handleDownvote}>
          <ThumbsDown
            size={16}
            color={isDownvote ? 'icon-state-info-bold' : 'icon-tertiary'}
          />
        </Box>
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
              <>
                <Box display={{ initial: 'block', ml: 'none' }}>
                  <Text
                    color="text-tertiary"
                    variant="bs-regular"
                    css={css`
                      white-space: nowrap;
                    `}
                  >
                    {formatTimestamp(timestamp.toString(), true)}
                  </Text>
                </Box>
                <Box display={{ initial: 'none', ml: 'block' }}>
                  <Text
                    color="text-tertiary"
                    variant="bs-regular"
                    css={css`
                      white-space: nowrap;
                    `}
                  >
                    {formatTimestamp(timestamp.toString(), false)}
                  </Text>
                </Box>
              </>
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
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
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
