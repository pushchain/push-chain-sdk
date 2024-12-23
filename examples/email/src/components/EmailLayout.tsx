import React from 'react';

import EmailViewer from '../modules/emailPage/components/EmailViewer';
import { useAppContext } from '@/context/AppContext';
import { IEmail } from '@/helpers/types';

const EmailLayout: React.FC = () => {
  const { setReplyTo } = useAppContext();

  const handleReply = (email: IEmail) => {
    setReplyTo(email);
  };

  return (
    <div className="flex flex-col h-full w-full flex-1 ">
      <EmailViewer onReply={handleReply} />
    </div>
  );
};

export default EmailLayout;
