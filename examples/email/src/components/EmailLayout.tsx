import React from 'react';

import EmailViewer from '../modules/emailPage/components/EmailViewer';
import { useAppContext } from '@/context/AppContext';
import { Email } from '../common';
import { Box } from 'shared-components';

const EmailLayout: React.FC = () => {
  const { setReplyTo } = useAppContext();

  const handleReply = (email: Email) => {
    setReplyTo(email);
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      height="100%"
      width="100%"
      overflow="scroll"
    >
      <EmailViewer onReply={handleReply} />
    </Box>
  );
};

export default EmailLayout;
