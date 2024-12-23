import React from 'react';
import { Card } from './ui/card';
import { IEmail } from '@/types';
import { useAppContext } from '@/context/app-context';
import { formatTimestamp, trimAddress } from '@/lib/utils';
import { EMAIL_BOX } from '@/constants';
import BlockiesSvg from 'blockies-react-svg';
import { Box, PushLogo, Text } from 'shared-components';
import { css } from 'styled-components';
import { useNavigate } from 'react-router-dom';

const EmailCard: React.FC<IEmail> = ({
  from,
  to,
  subject,
  timestamp,
  body,
  type,
  attachments,
  txHash,
}) => {
  const navigate = useNavigate();
  const { currTab, setSelectedEmail, selectedEmail } = useAppContext();

  return (
    <Card
      onClick={() => {
        setSelectedEmail({
          from,
          to,
          subject,
          timestamp,
          body,
          attachments,
          txHash,
        });
        navigate(`/${currTab}/${txHash}`);
      }}
      className={`cursor-pointer ${
        type === EMAIL_BOX.INBOX
          ? selectedEmail?.from === from && 'bg-secondary-foreground'
          : selectedEmail?.to === to && 'bg-primary-foreground'
      }`}
    >
      <Box
        display="flex"
        alignItems="flex-start"
        justifyContent="space-between"
        width="100%"
      >
        <Box
          display="flex"
          alignItems="center"
          gap="spacing-xs"
          width="70%"
          overflow="hidden"
        >
          {from === 'push.fam' ? (
            <PushLogo height={30} width={32} />
          ) : (
            <Box
              width="32px"
              height="32px"
              borderRadius="radius-round"
              overflow="hidden"
              alignSelf="center"
            >
              <BlockiesSvg address={from} />
            </Box>
          )}

          <Box
            css={css`
              flex: 1;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            `}
          >
            <Text
              variant="h5-bold"
              css={css`
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              `}
            >
              {subject}
            </Text>
            <Text variant="bes-semibold" color="text-tertiary">
              {from === 'push.fam' ? from : trimAddress(from)}
            </Text>
          </Box>
        </Box>
        <Box
          width="30%"
          display="flex"
          justifyContent="flex-end"
          overflow="hidden"
        >
          <Text
            variant="c-regular"
            css={css`
              white-space: nowrap;
            `}
          >
            {timestamp === 0 ? 'now' : formatTimestamp(timestamp.toString())}
          </Text>
        </Box>
      </Box>
      <Box>
        <Text
          dangerouslySetInnerHTML={{ __html: body }}
          variant="bs-regular"
          css={css`
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            word-break: break-word;
          `}
        />
      </Box>
    </Card>
  );
};

export default EmailCard;
