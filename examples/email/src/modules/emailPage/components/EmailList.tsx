import { useAppContext } from '@/context/AppContext';
import { Box } from 'shared-components';
import { dummyEmail } from '@/helpers/utils';
import { EMAIL_BOX } from '@/helpers/types';
import { ScrollArea } from '@/common/components';
import EmailCard from '@/components/EmailCard';

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
      <Box display="flex" flexDirection="column">
        {type === EMAIL_BOX.INBOX && <EmailCard {...dummyEmail} />}
        {filteredEmails.map((email, index) => (
          <EmailCard key={index} {...email} />
        ))}
      </Box>
      <div className="flex flex-col gap-2"></div>
    </ScrollArea>
  );
};

export default EmailList;
