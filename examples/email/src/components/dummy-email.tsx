import { Back, Box, PushLogo, Text } from 'shared-components';
import { Card } from './ui/card';
import { css } from 'styled-components';

interface EmailViewerProps {
  handleBack: () => void;
}

const DummyEmail: React.FC<EmailViewerProps> = ({ handleBack }) => {
  return (
    <Card className="w-full h-fit flex-1 py-6 px-4 md:px-8 gap-6">
      <Box cursor="pointer" onClick={handleBack}>
        <Back size={24} />
      </Box>
      <Box display="flex" justifyContent="space-between" alignSelf="stretch">
        <Box
          display="flex"
          flexDirection="column"
          gap="spacing-xs"
          width="100%"
        >
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            width="100%"
            css={css`
              padding-left: 48px;
              @media (max-width: 768px) {
                padding-left: 0px;
              }
            `}
          >
            <Text variant="h4-semibold">GM! Web3 Email</Text>
            <Box>
              <Text variant="bes-semibold">now</Text>
            </Box>
          </Box>
          <Box display="flex" gap="spacing-xxs">
            <PushLogo height={36} width={40} />
            <Box display="flex" flexDirection="column" gap="spacing-xxxs">
              <Text variant="bes-semibold">Push Fam</Text>
              <Text variant="bes-semibold" color="text-tertiary">
                To:
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
      <Box
        display="flex"
        flexDirection="column"
        maxWidth="600px"
        alignSelf="center"
        gap="spacing-md"
        css={css`
          padding: 0px 48px;
          @media (max-width: 768px) {
            padding: 0px;
          }
        `}
      >
        <img src="/DummyHeader.png" />
        <Text variant="bs-regular">
          Hello Degen, <br />
          Welcome to the future of email, where web3 meets seamless unified
          across all chains! With this app, you can easily connect with your
          fellow Solana, Ethereum, Polygon, Optimism and other blockchain users.
        </Text>
        <Box
          display="flex"
          gap="spacing-lg"
          alignItems="flex-start"
          css={css`
            flex-direction: row;
            flex: 1;
            @media (max-width: 768px) {
              flex-direction: column;
            }
          `}
        >
          <Box
            display="flex"
            flexDirection="column"
            gap="spacing-xxs"
            alignItems="flex-start"
            css={css`
              flex: 1;
              @media (max-width: 768px) {
                flex: none;
              }
            `}
          >
            <img src="/DummyEmail.png" height={75} width={75} />
            <Box>
              <Text variant="bm-bold">About Push Email</Text>
              <Text variant="bs-regular">
                Push Email is a sample Devnet app designed to showcase the power
                of a shared state email app.
              </Text>
              <br />
              <Text variant="bs-semibold">
                Please note that in this version, emails sent and received are
                not encrypted.
              </Text>
            </Box>
          </Box>
          <Box
            display="flex"
            flexDirection="column"
            gap="spacing-xxs"
            alignItems="flex-start"
            css={css`
              flex: 1;
              @media (max-width: 768px) {
                flex: none;
              }
            `}
          >
            <img src="/DummyDiscord.png" height={75} width={75} />
            <Box>
              <Text variant="bm-bold">No Frens? No Problem!</Text>
              <Text variant="bs-regular">
                Feeling too busy for frens? Don’t worry! We’ve got your back.
                Test out the email experience by chatting with our sassy email
                bot.
              </Text>
              <br />
              <Text variant="bs-semibold">
                It’s quick, fun, and always ready to banter.
              </Text>
            </Box>
          </Box>
        </Box>
        <Box display="flex" flexDirection="column" alignItems="flex-start">
          <Text variant="bs-regular">Happy emailing,</Text>
          <Text variant="bs-bold">Push Fam</Text>
        </Box>
      </Box>
    </Card>
  );
};

export default DummyEmail;
