import { useAppContext } from '@/context/app-context';
import React from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from './card';

const EmailViewer = () => {
  const { selectedEmail } = useAppContext();
  return (
    <>
      {selectedEmail && (
        <Card className="cursor-pointer w-full h-full flex-1">
          <CardHeader>
            <CardTitle className="flex flex-col gap-2">
              <div className="flex flex-row justify-between items-center">
                <p>{selectedEmail.subject}</p>
                <p className="text-sm font-light">{selectedEmail.timestamp}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedEmail.from}
              </p>
            </CardTitle>
            <CardDescription>{selectedEmail.body}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </>
  );
};

export default EmailViewer;
