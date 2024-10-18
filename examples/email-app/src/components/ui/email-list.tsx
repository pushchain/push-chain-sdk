import EmailCard from './email-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppContext } from '@/context/app-context';
import { EMAIL_BOX } from '@/constants';

const EmailList = ({ type }: { type: EMAIL_BOX.INBOX | EMAIL_BOX.SENT }) => {
  const { searchInput, emails } = useAppContext();

  return (
    <ScrollArea className="h-full w-full">
      <div className="flex flex-col gap-2 p-2">
        {emails[type]
          .filter((email) =>
            email.from.toLowerCase().includes(searchInput.toLowerCase())
          )
          .map((email, index) => (
            <EmailCard key={index} {...email} />
          ))}
      </div>
    </ScrollArea>
  );
};

export default EmailList;
