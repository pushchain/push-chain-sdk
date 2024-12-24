import React from 'react';
import { useAppContext } from '@/context/AppContext';
import { extractWalletAddress, formatTimestamp, trimAddress } from '@/common';
import BlockiesSvg from 'blockies-react-svg';
import { Box, PushLogo, Text, css } from 'shared-components';
import { useNavigate } from 'react-router-dom';
import { EMAIL_BOX, Email } from '../common';
import { Card } from '@/common/components';

const EmailCard: React.FC<Email> = ({
  from,
  to,
  subject,
  timestamp,
  body,
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
        selectedEmail?.txHash === txHash && 'bg-[#F5F6F8]'
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
              <BlockiesSvg
                address={currTab === EMAIL_BOX.INBOX ? from : to[0]}
              />
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
              {currTab === EMAIL_BOX.INBOX
                ? from === 'push.fam'
                  ? from
                  : trimAddress(extractWalletAddress(from))
                : to
                    .map((address) =>
                      trimAddress(extractWalletAddress(address))
                    )
                    .join(', ')}
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
