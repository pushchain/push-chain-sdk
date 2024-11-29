import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { useConnectWallet } from "@web3-onboard/react";
import { ethers, BrowserProvider } from "ethers";
import { useNavigate } from "react-router-dom";
import { connectPushWallet } from "../../services/pushWalletService"; // Importing Push Wallet service
import RumoursImage from "../../assets/ho.gif"; // Example image
import ChainAnimation from "../../assets/confession-bg.jpg"; // Example animation

const LandingPage = () => {
  const [{ wallet, connecting }, connect, disconnect] = useConnectWallet();
  const [network, setNetwork] = useState("");
  const [pushWalletAddress, setPushWalletAddress] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (wallet) {
      setNetwork(wallet.chains[0]?.label || "Unknown Network");
    }
  }, [wallet]);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error("Wallet connection failed:", error);
    }
  };

  const handleDisconnect = async () => {
    if (wallet) {
      await disconnect(wallet);
      setNetwork("");
    }
  };

  const handlePushWalletConnect = async () => {
    const result = await connectPushWallet();
    if (result.success) {
      setPushWalletAddress(result.walletAddress);
      alert(`Push Wallet Connected: ${result.walletAddress}`);
    } else {
      alert("Failed to connect Push Wallet. Please try again.");
    }
  };

  const navigateToProfile = () => {
    navigate("/profile");
  };

  return (
    <Container>
      {/* Header */}
      <Header>
        <Logo>🔗 Web3 Rumours</Logo>
        <Nav>
          <NavItem onClick={() => navigate("/about")}>About</NavItem>
          <NavItem onClick={() => navigate("/feed")}>Rumour Feed</NavItem>
          <HeaderButtons>
            {wallet || pushWalletAddress ? (
              <CTAButton onClick={navigateToProfile} blue>
                Go to Profile
              </CTAButton>
            ) : (
              <>
                <CTAButton onClick={handleConnect} blue>
                  {connecting ? "Connecting..." : "Connect Wallet"}
                </CTAButton>
                <CTAButton onClick={handlePushWalletConnect} purple>
                  Connect with Push Wallet
                </CTAButton>
              </>
            )}
          </HeaderButtons>
        </Nav>
      </Header>

      {/* Hero Section */}
      <Hero>
        <HeroText>
          <HeroTitle>Discover the Latest Web3 Rumours</HeroTitle>
          <HeroSubtitle>
            Powered by decentralized technology, Web3 Rumours ensures the fastest and most secure way to explore the buzzing world of blockchain!
          </HeroSubtitle>
        </HeroText>
        <HeroImage>
          <StyledImage src={RumoursImage} alt="Rumours Graphic" />
        </HeroImage>
      </Hero>

      {/* Features Section */}
      <Features>
        <FeatureCard>
          <FeatureTitle>🔒 Decentralized Truth</FeatureTitle>
          <FeatureDescription>
            Leveraging Push Chain, we ensure rumours are verified and secure.
          </FeatureDescription>
        </FeatureCard>
        <FeatureCard>
          <FeatureTitle>🚀 Scalable Discussions</FeatureTitle>
          <FeatureDescription>
            From whispers to bold claims, Web3 Rumours handles it all with unmatched scalability.
          </FeatureDescription>
        </FeatureCard>
        <FeatureCard>
          <FeatureTitle>💬 Anonymous Participation</FeatureTitle>
          <FeatureDescription>
            Your privacy is our priority. Share rumours without revealing your identity.
          </FeatureDescription>
        </FeatureCard>
      </Features>

      {/* Graphics Section */}
      <GraphicsSection>
        <GraphicText>
          <h2>Embrace the Future of Rumour Sharing</h2>
          <p>
            Web3 Rumours is a hub for discovering, verifying, and debating the latest in blockchain and crypto. Stay connected, stay informed.
          </p>
        </GraphicText>
        <Animation src={ChainAnimation} alt="Blockchain Animation" />
      </GraphicsSection>
    </Container>
  );
};

export default LandingPage;

// Styled Components
const Container = styled.div`
  font-family: "Inter", sans-serif;
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

const NavItem = styled.button`
  background: transparent;
  border: none;
  font-size: 1rem;
  color: #333333;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    color: #007aff;
  }
`;

const HeaderButtons = styled.div`
  display: flex;
  gap: 10px;
`;

const CTAButton = styled.button`
  background-color: ${({ blue }) => (blue ? "#007aff" : "#ff3b57")};
  color: #ffffff;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background-color: ${({ blue }) => (blue ? "#005bb5" : "#e0354e")};
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

const HeroImage = styled.div`
  flex: 1;
  display: flex;
  justify-content: center;
`;

const StyledImage = styled.img`
  max-width: 90%;
  height: auto;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
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

const GraphicsSection = styled.section`
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

const GraphicText = styled.div`
  flex: 1;

  h2 {
    font-size: 2.5rem;
    color: #0d1117;
    margin-bottom: 20px;
  }

  p {
    font-size: 1.25rem;
    color: #4a5568;
  }
`;

const Animation = styled.img`
  flex: 1;
  max-width: 400px;
  height: auto;
  border-radius: 10px;

  @media (max-width: 768px) {
    margin-top: 20px;
  }
`;
