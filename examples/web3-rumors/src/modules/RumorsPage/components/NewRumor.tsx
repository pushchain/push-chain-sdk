import { useState, useRef } from 'react';
import {
  Box,
  Button,
  Cross,
  Pencil,
  Text,
  TextArea,
  css,
} from 'shared-components';
import { RumorType, SymbolBox, TABS } from '@/common';
import RumorItem from './RumorItem';
import { useAppContext } from '@/context/AppContext';
import { postConfession } from '@/services/postConfession';
import Bold from '@/common/icons/Bold';
import Italic from '@/common/icons/Italic';
import Strikethrough from '@/common/icons/Strikethrough';
import Quote from '@/common/icons/Quote';
import Link from '@/common/icons/Link';
import { getSentConfessions } from '@/services/getSentConfessions';

const NewRumor = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { account, pushNetwork, setData, handleSendSignRequestToPushWallet } =
    useAppContext();

  const insertText = (before: string, after = '') => {
    const textarea = textareaRef.current;
    if (textarea) {
      const { selectionStart, selectionEnd } = textarea;
      const start = text.slice(0, selectionStart);
      const middle = text.slice(selectionStart, selectionEnd);
      const end = text.slice(selectionEnd);

      if (before === '> ') {
        setText(
          start
            ? `${start}\n${before}${middle}\n\n${end}`
            : `${before}${middle}\n\n${end}`
        );
      } else {
        setText(`${start}${before}${middle}${after}${end}`);
      }

      setTimeout(() => {
        textarea.focus();
        const cursorPosition = selectionStart + before.length + middle.length;
        textarea.setSelectionRange(cursorPosition, cursorPosition);
      }, 0);
    }
  };

  const handleFetchNewData = async () => {
    if (!account || !pushNetwork) return;
    try {
      const fetchedSentConfession = await getSentConfessions(
        pushNetwork,
        account,
        1,
        1
      );
      if (fetchedSentConfession && fetchedSentConfession.length) {
        setData((prev) => ({
          ...prev,
          [TABS.LATEST]: prev[TABS.LATEST].map((item) =>
            item.txnHash === 'temp-rumor' ? fetchedSentConfession[0] : item
          ),
          [TABS.MY_RUMORS]: prev[TABS.MY_RUMORS].map((item) =>
            item.txnHash === 'temp-rumor' ? fetchedSentConfession[0] : item
          ),
        }));
      }
    } catch (error) {
      console.error('Error fetching confessions:', error);
    }
  };

  const handlePost = async () => {
    if (!account) return;
    if (!text.trim()) {
      alert('Please write something to post your rumour.');
      return;
    }

    setLoading(true);

    const rumourDetails = {
      post: text,
      address: account,
      upvotes: 0,
      isVisible: true,
      timestamp: Date.now().toString(),
    };

    try {
      if (pushNetwork) {
        await postConfession(
          pushNetwork,
          account,
          rumourDetails,
          handleSendSignRequestToPushWallet
        );
      }
      const tempRumor: RumorType = {
        txnHash: `temp-rumor`,
        post: text,
        address: account,
        isVisible: true,
        timestamp: Date.now().toString(),
        markdownPost: text,
        upvoteWallets: [],
        downvoteWallets: [],
      };
      setData((prev) => ({
        ...prev,
        [TABS.LATEST]: [tempRumor, ...prev[TABS.LATEST]],
        [TABS.MY_RUMORS]: [tempRumor, ...prev[TABS.MY_RUMORS]],
      }));
      setTimeout(() => {
        handleFetchNewData();
      }, 2000);
      setText('');
      setIsOpen(false);
    } catch (error) {
      console.error('Error posting rumour:', error);
      alert('Failed to post your rumour. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Box
        position="fixed"
        css={css`
          z-index: 10;
          right: 1.25rem;
          bottom: 1.25rem;

          opacity: 1;
          transform: scale(1);
          transition: opacity 0.2s ease, transform 0.2s ease;

          ${isOpen &&
          `
                opacity: 0;
                transform: scale(0.8);
            `}
        `}
      >
        <Button
          size="large"
          leadingIcon={<Pencil size={16} />}
          css={css`
            border-radius: var(--radius-md);
            background: #0056d0 !important;
          `}
          onClick={() => setIsOpen(true)}
        >
          <Text
            variant="h5-regular"
            color="text-primary-inverse"
            display={{ initial: 'block', ml: 'none' }}
          >
            Post a Rumor
          </Text>
        </Button>
      </Box>
      <Box
        backgroundColor="surface-secondary"
        boxShadow="-2px 2px 7.8px 0px rgba(0, 0, 0, 0.25)"
        borderRadius="radius-md"
        position="fixed"
        maxWidth="800px"
        maxHeight="90vh"
        width="100%"
        padding="spacing-md"
        display="flex"
        flexDirection="column"
        alignItems="center"
        gap="spacing-md"
        css={css`
          z-index: 999;
          left: 50%;
          transform: translate(-50%);
          overflow-y: auto;
          box-sizing: border-box;
          margin-top: 75px;

          opacity: 0;
          transform: translate(-50%, 20px) scale(0.95);
          visibility: hidden;

          transition: opacity 0.3s ease, transform 0.3s ease,
            visibility 0.3s ease;

          ${isOpen &&
          `
                opacity: 1;
                transform: translate(-50%, 0) scale(1);
                visibility: visible;
            `}
        `}
      >
        <Box position="relative" width="100%" textAlign="center">
          <Text variant="h3-bold">Post Rumor</Text>
          <Box
            position="absolute"
            cursor="pointer"
            css={css`
              right: 0;
              top: 0;
            `}
          >
            <Cross size={27} onClick={() => setIsOpen(false)} />
          </Box>
        </Box>
        <Box
          display="flex"
          flexDirection="column"
          borderRadius="radius-md"
          width="100%"
          padding="spacing-md"
          gap="spacing-sm"
          backgroundColor="surface-primary"
          css={css`
            box-sizing: border-box;
          `}
        >
          <Box display="flex" gap="spacing-xxs">
            <SymbolBox onClick={() => insertText('**', '**')}>
              <Bold size={14} color="icon-primary" />
            </SymbolBox>
            <SymbolBox onClick={() => insertText('_', '_')}>
              <Italic size={14} color="icon-primary" />
            </SymbolBox>
            <SymbolBox onClick={() => insertText('~~', '~~')}>
              <Strikethrough size={14} color="icon-primary" />
            </SymbolBox>
            <SymbolBox onClick={() => insertText('> ')}>
              <Quote size={14} color="icon-primary" />
            </SymbolBox>
            <SymbolBox onClick={() => insertText('[', '](url)')}>
              <Link size={16} color="icon-primary" />
            </SymbolBox>
          </Box>
          <TextArea
            ref={textareaRef}
            onChange={(e) => setText(e.target.value)}
            value={text}
            placeholder="Write your rumour here....... (Markdown Supported!)"
            numberOfLines={8}
          />
        </Box>
        <Box
          display="flex"
          flexDirection="column"
          borderRadius="radius-md"
          width="100%"
          padding="spacing-md"
          gap="spacing-xs"
          backgroundColor="surface-primary"
          css={css`
            box-sizing: border-box;
          `}
        >
          <Text variant="h5-bold">Rumor Preview</Text>
          <RumorItem
            address={account || ''}
            markdownPost={text}
            post=""
            isVisible
            txnHash=""
            timestamp={Date.now().toString()}
            upvoteWallets={[]}
            downvoteWallets={[]}
          />
        </Box>
        <Button
          onClick={handlePost}
          css={css`
            border-radius: var(--radius-md);
            background: #0056d0 !important;
          `}
          leadingIcon={<Pencil size={16} />}
          disabled={loading}
        >
          <Text
            variant="h5-regular"
            color="text-primary-inverse"
            display={{ initial: 'block', ml: 'none' }}
          >
            Post a Rumor
          </Text>
        </Button>
      </Box>
    </>
  );
};

export default NewRumor;
