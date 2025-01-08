import { useAppContext } from '@/context/AppContext';
import { Box, Spinner } from 'shared-components';
import { dummyEmail, EMAIL_BOX } from '@/common';
import EmailCard from '@/components/EmailCard';
import { FC } from 'react';

export type EmailListProps = { type: EMAIL_BOX.INBOX | EMAIL_BOX.SENT };

const EmailList: FC<EmailListProps> = ({ type }) => {
  const { searchInput, emails, isLoading } = useAppContext();

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
    <Box height="100%" width="100%" overflow="scroll">
      <Box display="flex" flexDirection="column">
        {type === EMAIL_BOX.INBOX && <EmailCard {...dummyEmail} />}
        {filteredEmails.map((email, index) => (
          <EmailCard key={index} {...email} />
        ))}
        {isLoading && (
          <Box display="flex" justifyContent="center" margin="spacing-lg">
            <Spinner size="medium" variant="primary" />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default EmailList;
