import EmailCard from './email-card';
import { ScrollArea } from './ui/scroll-area';
import { useAppContext } from '@/context/app-context';
import { EMAIL_BOX } from '@/constants';

const EmailList = ({ type }: { type: EMAIL_BOX.INBOX | EMAIL_BOX.SENT }) => {
  const { searchInput, emails } = useAppContext();

  const filterEmails = (emails: any[], searchInput: string) => {
    if (searchInput === '') {
      return emails;
    }
    return emails.filter((email) => {
      if (type === EMAIL_BOX.INBOX) {
        return email.from.toLowerCase().includes(searchInput.toLowerCase());
      } else if (type === EMAIL_BOX.SENT) {
        return email.to.some((recipient: string) =>
          recipient.toLowerCase().includes(searchInput.toLowerCase())
        );
      }
      return false;
    });
  };

  const filteredEmails = filterEmails(emails[type], searchInput);

  return (
    <ScrollArea className="h-full w-full">
      <div className="flex flex-col gap-2 p-2">
        {filteredEmails.map((email, index) => (
          <EmailCard key={index} {...email} />
        ))}
      </div>
    </ScrollArea>
  );
};

export default EmailList;
