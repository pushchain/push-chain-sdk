import React from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from './ui/card';
import { IEmail } from '@/types';
import { useAppContext } from '@/context/app-context';
import { formatTimestamp, trimAddress } from '@/lib/utils';
import { EMAIL_BOX } from '@/constants';

const EmailCard: React.FC<IEmail> = ({
  from,
  to,
  subject,
  timestamp,
  body,
  type,
  attachments,
}) => {
  const { setSelectedEmail, selectedEmail } = useAppContext();
  return (
    <Card
      onClick={() => {
        setSelectedEmail({ from, to, subject, timestamp, body, attachments });
      }}
      className={`cursor-pointer ${
        type === EMAIL_BOX.INBOX
          ? selectedEmail?.from === from && 'bg-primary-foreground'
          : selectedEmail?.to === to && 'bg-primary-foreground'
      }`}
    >
      <CardHeader>
        <CardTitle>
          <div className="flex flex-row justify-between items-center">
            <p>{subject}</p>
            <p className="text-sm font-light min-w-12">
              {formatTimestamp(timestamp.toString())}
            </p>
          </div>
        </CardTitle>
        <CardDescription>
          {type === EMAIL_BOX.INBOX
            ? trimAddress(from.split(':')[2])
            : to.map((t) => trimAddress(t.split(':')[2])).join(', ')}
        </CardDescription>
      </CardHeader>
    </Card>
  );
};

export default EmailCard;
