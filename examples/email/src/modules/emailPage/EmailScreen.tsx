import { Text, Box, TextInput, Tabs } from 'shared-components';
import { useAppContext } from '@/context/AppContext';
import { css } from 'styled-components';
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { dummyEmail } from '@/helpers/utils';
import { EMAIL_BOX } from '@/helpers/types';
import EmailLayout from '@/components/EmailLayout';
import EmailList from './components/EmailList';
import NewEmail from './components/NewEmail';
import { Header } from './components/Header';

const EmailScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const {
    currTab,
    setCurrTab,
    emails,
    searchInput,
    setSearchInput,
    setSelectedEmail,
    selectedEmail,
    replyTo,
  } = useAppContext();

  const handleTabSwitch = (tab: 'inbox' | 'sent') => {
    setCurrTab(tab);
    // navigate(`/${tab}`);
  };

  useEffect(() => {
    if (location.pathname.includes('sent')) {
      setCurrTab('sent');
    } else {
      setCurrTab('inbox');
    }
  }, []);

  useEffect(() => {
    if (id) {
      const emailList = emails[currTab];
      if (id === 'welcome') {
        setSelectedEmail(dummyEmail);
      } else if (emailList && emailList.length > 0) {
        const email = emailList.find((email) => email.txHash === id);

        if (email) {
          setSelectedEmail(email);
        } else {
          navigate(`/${currTab}`);
        }
      }
    } else {
      setSelectedEmail(null);
    }
  }, []);

  return (
    <div className="relative w-full h-[100vh] flex flex-col">
      <Header />
      <Box width="100%" height="calc(100% - 74px)" display="flex">
        <Box
          display={{ initial: 'flex', tb: selectedEmail ? 'none' : 'flex' }}
          width={{
            initial: '30%',
            lp: '35%',
            tb: selectedEmail ? '0%' : '100%',
          }}
          flexDirection="column"
          height="100%"
          padding="spacing-md spacing-none spacing-none spacing-none"
          css={css`
            border-right: 1px solid #eaebf2;
          `}
        >
          <NewEmail replyTo={replyTo} />
          <Box
            position="sticky"
            display="flex"
            flexDirection="column"
            padding="spacing-none spacing-sm"
            gap="spacing-xs"
            alignItems="flex-start"
            css={css`
              border-bottom: 1px solid var(--stroke-secondary);
            `}
          >
            <Text variant="h3-semibold">Inbox</Text>
            <TextInput
              placeholder="Search for a sender address"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              css={css`
                width: 100%;
              `}
            />
            <Tabs
              variant="fill"
              activeKey={currTab}
              onChange={(tab) => handleTabSwitch(tab as 'inbox' | 'sent')}
              items={[
                {
                  key: 'inbox',
                  label: <Text variant="h5-semibold">Inbox</Text>,
                  children: null,
                },
                {
                  key: 'sent',
                  label: <Text variant="h5-semibold">Sent</Text>,
                  children: null,
                },
              ]}
            />
          </Box>
          {currTab === 'inbox' && <EmailList type={EMAIL_BOX.INBOX} />}
          {currTab === 'sent' && <EmailList type={EMAIL_BOX.SENT} />}
        </Box>
        <Box
          height="100%"
          display={{ initial: 'flex', tb: selectedEmail ? 'flex' : 'none' }}
          width={{
            initial: '70%',
            lp: '65%',
            tb: selectedEmail ? '100%' : '0%',
          }}
        >
          <EmailLayout />
        </Box>
      </Box>
    </div>
  );
};

export default EmailScreen;
