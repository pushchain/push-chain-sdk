import React, { useState } from 'react';
import styled from 'styled-components';
import { useConnectWallet } from '@web3-onboard/react';
import { ethers, BrowserProvider } from 'ethers'; // Ensure BrowserProvider is used for the latest ethers version
import { useNavigate } from 'react-router-dom';
import { connectPushWallet } from '../../services/pushWalletService'; // Push Wallet logic

const LandingPage = () => {
  const [{ wallet, connecting }, connect, disconnect] = useConnectWallet();
  const [network, setNetwork] = useState('');
  const navigate = useNavigate();

  // Update network when wallet connects
  if (wallet && !network) {
    setNetwork(wallet.chains[0]?.label || 'Unknown Network');
  }

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Wallet connection failed:', error);
    }
  };

  const handleDisconnect = async () => {
    if (wallet) {
      await disconnect(wallet);
      setNetwork('');
    }
  };

  const handleConnectPushWallet = async () => {
    try {
      const response = await connectPushWallet();
      if (response.success) {
        alert('Push Wallet connected successfully!');
        navigate('/profile', { state: { wallet: response.response.wallet } }); // Redirect with wallet details
      } else {
        alert('Push Wallet connection failed.');
      }
    } catch (error) {
      console.error('Push Wallet connection failed:', error);
      alert('An error occurred while connecting to Push Wallet.');
    }
  };

  return (
    <Container>
      {/* Header */}
      <Header>
        <Logo>🤫 Confession</Logo>
        <Nav>
          <NavItem>About</NavItem>
          <NavItem>Documentation</NavItem>
          <NavItem>Blog</NavItem>
          {wallet ? (
            <WalletInfo>
              <WalletDetail>
                Address: <strong>{wallet.accounts[0]?.address || 'N/A'}</strong>
              </WalletDetail>
              <WalletDetail>
                Network: <strong>{network}</strong>
              </WalletDetail>
              <StyledDisconnectButton onClick={handleDisconnect}>
                Disconnect
              </StyledDisconnectButton>
            </WalletInfo>
          ) : (
            <>
              <LaunchButton onClick={handleConnect}>
                {connecting ? 'Connecting...' : 'Launch App'}
              </LaunchButton>
              <PushWalletButton onClick={handleConnectPushWallet}>
                Connect with Push Wallet
              </PushWalletButton>
            </>
          )}
        </Nav>
      </Header>

      {/* Hero Section */}
      <Hero>
        <HeroText>
          <HeroTitle>Push your Confessions</HeroTitle>
          <HeroSubtitle>
            Anonymous, blockchain-verified confessions built on the Push chain.
            A secure platform to share your thoughts and experiences anonymously.
          </HeroSubtitle>
          {wallet && (
            <CTAButton onClick={() => navigate('/profile')}>Go to Profile</CTAButton>
          )}
        </HeroText>
        <HeroImage>
          <SpeechBubble>
            <BubbleTitle>Push Chain Integration</BubbleTitle>
            <BubbleText>
              Powered by decentralized infrastructure ensuring data integrity and
              anonymity. 🔔
            </BubbleText>
          </SpeechBubble>
        </HeroImage>
      </Hero>

      {/* Features Section */}
      <Features>
        <FeatureCard>
          <FeatureTitle>🕶️ Total Anonymity</FeatureTitle>
          <FeatureDescription>
            Share your confessions without revealing your identity.
          </FeatureDescription>
        </FeatureCard>
        <FeatureCard>
          <FeatureTitle>🔒 Privacy & Security</FeatureTitle>
          <FeatureDescription>
            Built with cutting-edge blockchain technology.
          </FeatureDescription>
        </FeatureCard>
        <FeatureCard>
          <FeatureTitle>✅ Blockchain Verified</FeatureTitle>
          <FeatureDescription>
            Every confession is verified and stored securely on the blockchain.
          </FeatureDescription>
        </FeatureCard>
      </Features>
    </Container>
  );
};

export default LandingPage;

// Styled Components

const Container = styled.div`
  font-family: 'Inter', sans-serif;
  background: #f9f9f9;
  color: #0d1117;
  min-height: 100vh;
`;

const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 40px;
  background: #ffffff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 10;
`;

const Logo = styled.h1`
  font-size: 1.5rem;
  font-weight: 700;
  color: #007aff;
`;

const Nav = styled.nav`
  display: flex;
  align-items: center;
  gap: 20px;
`;

const NavItem = styled.a`
  text-decoration: none;
  color: #333333;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    color: #007aff;
  }
`;

const WalletInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const WalletDetail = styled.p`
  font-size: 0.9rem;
  color: #333333;
`;

const LaunchButton = styled.button`
  background-color: #007aff;
  color: #ffffff;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.3s;

  &:hover {
    background-color: #005bb5;
  }
`;

const PushWalletButton = styled(LaunchButton)`
  background-color: #ff3b57;

  &:hover {
    background-color: #e02b47;
  }
`;

const StyledDisconnectButton = styled(LaunchButton)`
  background-color: #e53e3e;

  &:hover {
    background-color: #c53030;
  }
`;

const Hero = styled.section`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 60px 40px;
  max-width: 1200px;
  margin: 0 auto;

  @media (max-width: 768px) {
    flex-direction: column;
    text-align: center;
  }
`;

const HeroText = styled.div`
  flex: 1;
`;

const HeroTitle = styled.h1`
  font-size: 3rem;
  font-weight: 700;
  color: #0d1117;

  @media (max-width: 768px) {
    font-size: 2.5rem;
  }
`;

const HeroSubtitle = styled.p`
  font-size: 1.25rem;
  color: #4a5568;
  margin: 20px 0;
`;

const CTAButton = styled(LaunchButton)`
  margin-top: 20px;
`;

const HeroImage = styled.div`
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;

  @media (max-width: 768px) {
    margin-top: 40px;
  }
`;

const SpeechBubble = styled.div`
  background: #007aff;
  color: #ffffff;
  padding: 20px;
  border-radius: 16px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  max-width: 300px;
  text-align: left;

  @media (max-width: 768px) {
    max-width: 100%;
  }
`;

const BubbleTitle = styled.h3`
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 10px;
`;

const BubbleText = styled.p`
  font-size: 1rem;
  font-weight: 400;
`;

const Features = styled.section`
  display: flex;
  gap: 20px;
  padding: 40px 20px;
  max-width: 1200px;
  margin: 0 auto;
  flex-wrap: wrap;
`;

const FeatureCard = styled.div`
  flex: 1;
  min-width: 250px;
  background: #ffffff;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  text-align: center;
`;

const FeatureTitle = styled.h3`
  font-size: 1.5rem;
  margin-bottom: 10px;
`;

const FeatureDescription = styled.p`
  font-size: 1rem;
  color: #4a5568;
`;
