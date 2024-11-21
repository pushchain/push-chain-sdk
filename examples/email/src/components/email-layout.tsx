import React, { useState } from 'react';

import { IEmail } from '@/types';

import NewEmail from './new-email';
import EmailViewer from './email-viewer';

const EmailLayout: React.FC = () => {
  const [replyTo, setReplyTo] = useState<IEmail | undefined>(undefined);

  const handleReply = (email: IEmail) => {
    setReplyTo(email);
  };

  return (
    <div className="flex flex-col h-full w-full flex-1 ">
      <EmailViewer onReply={handleReply} />

      <NewEmail replyTo={replyTo} />
    </div>
  );
};

export default EmailLayout;
