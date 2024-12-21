import React from 'react';
import { useAppContext } from '@/context/app-context';
import { Card, CardFooter } from './ui/card';
import { ReplyIcon } from 'lucide-react';
import { formatTimestamp, trimAddress } from '@/lib/utils';
import { FileAttachment, FileAttachments, IEmail } from '@/types';
import { Box, Text, Button, Back } from 'shared-components';
import BlockiesSvg from 'blockies-react-svg';
import { useNavigate } from 'react-router-dom';
import { css } from 'styled-components';
import { DownloadIcon } from '@radix-ui/react-icons';
import DummyEmail from './dummy-email';

interface EmailViewerProps {
  onReply: (email: IEmail) => void;
}

const EmailViewer: React.FC<EmailViewerProps> = ({ onReply }) => {
  const { currTab, selectedEmail, setSelectedEmail } = useAppContext();
  const navigate = useNavigate();

  const handleReply = () => {
    if (selectedEmail) {
      onReply(selectedEmail);
    }
  };

  const formatEmailBody = (body: string) => {
    const lines = body.split('\n');
    const formattedBody = [];
    let inQuote = false;

    for (const line of lines) {
      if (line.startsWith('On') && line.includes('wrote:')) {
        inQuote = true;
        formattedBody.push(
          <div key={formattedBody.length} className="text-gray-500 mt-4">
            {line}
          </div>
        );
      } else if (inQuote) {
        formattedBody.push(
          <div
            key={formattedBody.length}
            className="text-gray-500 border-l-4 border-gray-300 pl-2"
          >
            {line}
          </div>
        );
      } else {
        formattedBody.push(<div key={formattedBody.length}>{line}</div>);
      }
    }

    return formattedBody;
  };

  const handleBack = () => {
    navigate(`/${currTab}`);
    setSelectedEmail(null);
  };

  if (!selectedEmail) {
    return <></>;
  }

  console.log('welcome');

  return (
    <>
      {selectedEmail.txHash === 'welcome' ? (
        <DummyEmail handleBack={handleBack} />
      ) : (
        <Card className="w-full h-fit flex-1 py-6 px-4 md:px-8 gap-6">
          <Box cursor="pointer" onClick={handleBack}>
            <Back size={24} />
          </Box>
          <Box
            display="flex"
            justifyContent="space-between"
            alignSelf="stretch"
          >
            <Box
              display="flex"
              flexDirection="column"
              gap="spacing-xs"
              width="100%"
            >
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                width="100%"
                css={css`
                  padding-left: 48px;
                  @media (max-width: 768px) {
                    padding-left: 0px;
                  }
                `}
              >
                <Text variant="h4-semibold">{selectedEmail.subject}</Text>
                <Box>
                  <Text variant="bes-semibold">
                    {formatTimestamp(selectedEmail.timestamp.toString(), true)}
                  </Text>
                </Box>
              </Box>
              <Box display="flex" gap="spacing-xxs">
                <Box
                  width="40px"
                  height="40px"
                  borderRadius="radius-round"
                  overflow="hidden"
                  alignSelf="center"
                >
                  <BlockiesSvg address={selectedEmail.from} />
                </Box>
                <Box display="flex" flexDirection="column" gap="spacing-xxxs">
                  <Text variant="bes-semibold">
                    {trimAddress(selectedEmail.from)}
                  </Text>
                  <Text variant="bes-semibold" color="text-tertiary">
                    To:{' '}
                    {selectedEmail.to
                      .map((address) => trimAddress(address))
                      .join(', ')}
                  </Text>
                </Box>
              </Box>
            </Box>
          </Box>
          <Box
            css={css`
              padding: 0px 48px;
              @media (max-width: 768px) {
                padding: 0px;
              }
            `}
          >
            <Text variant="bs-regular">
              {formatEmailBody(selectedEmail.body)}
            </Text>
          </Box>
          {selectedEmail.attachments &&
            selectedEmail.attachments.length > 0 && (
              <CardFooter>
                <AttachmentList attachments={selectedEmail.attachments!} />
              </CardFooter>
            )}
          <Box
            gap="spacing-xxs"
            css={css`
              padding: 0px 48px;
              @media (max-width: 768px) {
                padding: 0px;
              }
            `}
          >
            <Button
              onClick={handleReply}
              variant="outline"
              size="extraSmall"
              leadingIcon={<ReplyIcon width={16} height={16} />}
            >
              Reply
            </Button>
          </Box>
        </Card>
      )}
    </>
  );
};

const AttachmentList: React.FC<{ attachments: FileAttachments }> = ({
  attachments,
}) => {
  const handleDownload = (attachment: FileAttachment) => {
    const decodedContent = atob(attachment.content);
    const blob = new Blob([decodedContent], { type: attachment.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Box
      display="flex"
      alignItems="center"
      gap="spacing-xs"
      css={css`
        flex-wrap: wrap;
      `}
    >
      {attachments.map((attachment, index) => (
        <Box
          key={index}
          display="flex"
          flexDirection="column"
          padding="spacing-xxs spacing-xs"
          gap="spacing-xxs"
          width="200px"
          borderRadius="radius-xxxs"
          backgroundColor="surface-secondary"
        >
          <Box height="122px" overflow="hidden">
            <img
              src={`data:${attachment.type};base64,${attachment.content}`}
              alt="attachment"
            />
          </Box>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
          >
            <Text
              variant="bes-semibold"
              css={css`
                overflow: hidden;
                text-overflow: ellipsis;
                text-wrap: nowrap;
              `}
            >
              {attachment.filename}
            </Text>
            <DownloadIcon
              cursor="pointer"
              height={28}
              width={28}
              onClick={() => handleDownload(attachment)}
            />
          </Box>
        </Box>
      ))}
    </Box>
  );
};
export default EmailViewer;
