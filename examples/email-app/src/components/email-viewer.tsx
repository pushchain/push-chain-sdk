import React, { useState } from 'react';
import { useAppContext } from '@/context/app-context';
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './ui/card';

import {
  File,
  FileText,
  Image,
  Music,
  Video,
  Archive,
  Code,
} from 'lucide-react';

import { formatTimestamp } from '@/lib/utils';
import { Badge } from './ui/badge';
import { FileAttachment, FileAttachments } from '@/types';

const EmailViewer = () => {
  const { selectedEmail } = useAppContext();

  return (
    <>
      {selectedEmail && (
        <Card className="cursor-pointer w-full h-full flex-1">
          <CardHeader>
            <CardTitle className="flex flex-col gap-2">
              <div className="flex flex-row justify-between items-center">
                <p className="text-md text-semibold">{selectedEmail.subject}</p>
                <p className="text-sm font-light">
                  {formatTimestamp(selectedEmail.timestamp.toString())}
                </p>
              </div>
              <Card className="flex flex-col gap-2 p-2 w-full">
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <span>Sender</span>
                  <Badge className="mr-1">
                    {selectedEmail.from.split(':')[2]}
                  </Badge>
                </div>
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <span>Recipients</span>
                  <div className="flex flex-col gap-1">
                    {selectedEmail.to.map((to) => (
                      <Badge key={to} className="mr-1">
                        {to.split(':')[2]}
                      </Badge>
                    ))}
                  </div>
                </div>
              </Card>
            </CardTitle>
            <CardDescription className="py-2">
              {selectedEmail.body}
            </CardDescription>
            {selectedEmail.attachments &&
              selectedEmail.attachments.length > 0 && (
                <CardFooter>
                  <AttachmentList attachments={selectedEmail.attachments!} />
                </CardFooter>
              )}
          </CardHeader>
        </Card>
      )}
    </>
  );
};

const AttachmentList: React.FC<{ attachments: FileAttachments }> = ({
  attachments,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/'))
      return <Image className="w-6 h-6 text-blue-500" />;
    if (type.startsWith('audio/'))
      return <Music className="w-6 h-6 text-green-500" />;
    if (type.startsWith('video/'))
      return <Video className="w-6 h-6 text-red-500" />;
    if (
      type.startsWith('application/zip') ||
      type.startsWith('application/x-rar-compressed')
    )
      return <Archive className="w-6 h-6 text-yellow-500" />;
    if (type === 'text/plain')
      return <FileText className="w-6 h-6 text-gray-500" />;
    if (type === 'application/pdf')
      return <File className="w-6 h-6 text-red-500" />;
    if (type.startsWith('application/'))
      return <Code className="w-6 h-6 text-purple-500" />;
    return <File className="w-6 h-6 text-gray-500" />;
  };

  return (
    <div className="p-4 bg-gray-100 rounded-lg">
      <h2 className="text-lg font-semibold mb-4 text-gray-700">Attachments</h2>
      <ul className="space-y-2">
        {attachments.map((attachment, index) => (
          <li
            key={index}
            className={`flex items-center p-2 rounded-md transition-colors duration-200 ${
              hoveredIndex === index ? 'bg-blue-100' : 'bg-white'
            }`}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="flex items-center flex-grow">
              {getFileIcon(attachment.type)}
              <span className="ml-3 text-sm font-medium text-gray-700">
                {attachment.filename}
              </span>
            </div>
            <button
              onClick={() => handleDownload(attachment)}
              className="ml-2 text-sm text-blue-600 hover:text-blue-800 focus:outline-none"
            >
              Download
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default EmailViewer;
