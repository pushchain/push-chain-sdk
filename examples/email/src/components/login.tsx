import { usePrivy } from '@privy-io/react-auth';
import { useAppContext } from '@/context/app-context';
import { toBytes } from 'viem';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import React from 'react';
import styled from 'styled-components';
import { Box, Front, Text } from 'shared-components';
import { ConnectPushWalletButton } from '@pushprotocol/pushchain-ui-kit';

import ChainAlertBar from './ui/alert-bar';

const featuresCard = [
  {
    text: 'Send and receive emails across multiple blockchain networks without barriers.',
  },
  {
    text: 'Push Mail brings a seamless web2 experience to web3.',
  },
  {
    text: 'Maintain a unified inbox across chains for an effortless user experience.',
  },
];

const Template = () => {
  const { login } = usePrivy();
  const { pushNetwork } = useAppContext();

  const StarIcon = () => {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
      >
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M15.3524 1.31893C14.8155 0.0899936 13.0473 0.103007 12.529 1.33972L10.7439 5.59859C9.57977 8.37604 7.3245 10.5676 4.49458 11.6714L0.970016 13.0461C-0.32334 13.5506 -0.323339 15.3593 0.970021 15.8637L4.52088 17.2487C7.33613 18.3468 9.58332 20.5217 10.7527 23.2801L12.5313 27.4753C13.0524 28.7044 14.8101 28.7175 15.3498 27.4962L17.2695 23.1523C18.4543 20.4715 20.6628 18.3617 23.4143 17.2823L27.0328 15.8626C28.3224 15.3567 28.3224 13.5532 27.0328 13.0473L23.4411 11.6382C20.6746 10.5528 18.4576 8.42604 17.2778 5.72569L15.3524 1.31893Z"
          fill="#E21D48"
        />
      </svg>
    );
  };

  return (
    <TemplateWrapper>
      <TemplateContent>
        <ItemContainer>
          <TextContainer>
            <Box display="flex" flexDirection="column" gap="spacing-md">
              <ChainAlertBar
                text="Push Chain Governance is live"
                url="https://test.com"
              />
              <Box
                display="flex"
                flexDirection="column"
                gap="spacing-xs"
                alignItems="flex-end"
              >
                <TextTitle>Email</TextTitle>
                <TextSubtitle>Powered by Push Chain</TextSubtitle>
              </Box>
            </Box>

            <TextSpan>
              Push Mail enables seamless communication across any chain. Shared
              state email ensures secure, transparent, and interoperable
              messaging.
            </TextSpan>

            {/* <Box display="flex" flexDirection="column" gap="spacing-sm">
              {pushNetwork && (
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  width="-webkit-fill-available"
                >
                  <ConnectPushWalletButton />
                </Box>
              )}

              <a href="https://push.org/chain" target="_blank">
                <Box
                  display={{ initial: 'flex', ml: 'none' }}
                  flexDirection="row"
                  gap="spacing-xxs"
                  width="100%"
                  justifyContent="center"
                >
                  <Text variant="bl-semibold" color="text-brand-medium">
                    Learn more about Push Chain
                  </Text>
                  <Front color="icon-brand-medium" size={24} />
                </Box>
                <Box
                  flexDirection="row"
                  gap="spacing-xxs"
                  width="100%"
                  justifyContent="center"
                  display={{ initial: 'none', ml: 'flex' }}
                >
                  <Text variant="bl-semibold" color="text-brand-medium">
                    Learn more about Push Chain
                  </Text>
                  <Front color="icon-brand-medium" size={24} />
                </Box>
              </a>
            </Box> */}

            <Button onClick={login}>Launch App</Button>

            {featuresCard.map((item) => (
              <Features>
                <StarIconContainer>
                  <StarIcon />
                </StarIconContainer>
                <FeaturesSpan>{item.text}</FeaturesSpan>
              </Features>
            ))}
          </TextContainer>
          <DesktopImageItem>
            <img src="/EmailBanner.png" style={{ maxHeight: '100%' }} />
          </DesktopImageItem>
        </ItemContainer>
      </TemplateContent>
    </TemplateWrapper>
  );
};

export default Template;

const TemplateWrapper = styled.div`
  height: 100vh;
  background: #fff;

  @media (max-width: 768px) {
    min-height: 100vh;
    height: auto;
  }
`;

const TemplateContent = styled.div`
  margin: auto auto;
  height: 100%;
  display: flex;
  align-items: center;

  @media (max-width: 2560px) {
    width: 1400px;
  }

  @media (max-width: 2000px) {
    width: 1200px;
  }

  @media (max-width: 1548px) {
    width: 100%;
    padding: 0 48px;
  }

  @media (max-width: 768px) {
    padding: 0 24px;
    margin: 24px auto;
  }

  @media (max-width: 470px) {
    padding: 0 16px;
  }
`;

const ItemContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;

  @media (max-width: 768px) {
    flex-direction: column;
  }
`;

const TextContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 40%;

  @media (max-width: 768px) {
    width: 100%;
  }
`;

const TextTitle = styled.span`
  color: #17181b;
  leading-trim: both;
  text-edge: cap;
  font-family: N27;
  font-size: 128px;
  font-style: normal;
  font-weight: 500;
  line-height: 90px;
  letter-spacing: 5.12px;
`;

const TextSubtitle = styled.span`
  color: #d796fd;
  font-family: N27;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 140%;
`;

const TextSpan = styled.span`
  color: #17181b;
  font-family: N27;
  font-size: 20px;
  font-style: normal;
  font-weight: 400;
  line-height: 140%;
  margin-top: 24px;

  @media (max-width: 768px) {
    margin-top: 16px;
  }

  @media (max-width: 470px) {
    font-size: 17px;
  }
`;

const Features = styled.div`
  display: flex;
  border-bottom: 1px solid #c4cbd5;
  padding: 24px 0;
  gap: 24px;
  align-items: center;
  width: 100%;
`;

const StarIconContainer = styled.div`
  flex-shrink: 0; /* Prevent the icon from shrinking */
  width: 28px;
  height: 28px; /* Maintain the icon's size */
`;

const FeaturesSpan = styled.span`
  color: #313338;
  font-family: N27;
  font-size: 18px;
  font-style: normal;
  font-weight: 400;
  line-height: 140%;

  @media (max-width: 470px) {
    font-size: 15px;
  }
`;

const Button = styled.button`
  background: #e21d48;
  width: 100%;
  margin: 48px 0 32px 0;
  height: 58px;
  padding: 16px 32px;
  justify-content: center;
  align-items: center;
  align-self: stretch;
  color: #fff;
  font-family: N27;
  font-size: 18px;
  font-style: normal;
  font-weight: 500;
  border-radius: 1000px;
  border: none;
  line-height: 16px;
  cursor: pointer;
`;

const DesktopImageItem = styled.div`
  height: 756px;
  border-radius: 32px;
  width: fit-content;
  display: flex;
  align-items: center;

  @media (max-width: 768px) {
    display: none;
  }
`;
