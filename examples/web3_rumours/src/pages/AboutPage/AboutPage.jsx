import React from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";

const AboutPage = () => {
  const navigate = useNavigate();

  return (
    <Container>
      <Header>
        <Logo>🔗 Web3 Rumours</Logo>
        <BackButton onClick={() => navigate("/")}>⬅ Back to Home</BackButton>
      </Header>

      <Content>
        <Title>About Web3 Rumours</Title>
        <Description>
          Welcome to Web3 Rumours – the decentralized platform where you can
          share, explore, and upvote the latest buzz in the blockchain world!
          Our mission is to ensure transparency, anonymity, and a fun
          environment for all Web3 enthusiasts.
        </Description>

        <HowItWorks>
          <SectionTitle>How it Works:</SectionTitle>
          <Steps>
            <Step>
              <StepTitle>1. Connect Your Wallet</StepTitle>
              <StepDescription>
                Start by securely connecting your Web3 wallet. Your wallet
                address will serve as your anonymous identity.
              </StepDescription>
            </Step>
            <Step>
              <StepTitle>2. Post Rumours</StepTitle>
              <StepDescription>
                Share your thoughts, ideas, or insights with the Web3 community
                in the form of rumours.
              </StepDescription>
            </Step>
            <Step>
              <StepTitle>3. Upvote Your Favorites</StepTitle>
              <StepDescription>
                Browse through the buzzing rumours and upvote the ones you find
                most interesting or insightful.
              </StepDescription>
            </Step>
          </Steps>
        </HowItWorks>

        <FeaturesSection>
          <SectionTitle>Features</SectionTitle>
          <Features>
            <Feature>
              <FeatureTitle>🔒 Decentralized Truth</FeatureTitle>
              <FeatureText>
                All rumours are verified and stored securely on the blockchain.
              </FeatureText>
            </Feature>
            <Feature>
              <FeatureTitle>🚀 Scalable Discussions</FeatureTitle>
              <FeatureText>
                Join the discussion with seamless scalability for millions of
                users.
              </FeatureText>
            </Feature>
            <Feature>
              <FeatureTitle>💬 Anonymous Participation</FeatureTitle>
              <FeatureText>
                Maintain your privacy while sharing your insights.
              </FeatureText>
            </Feature>
          </Features>
        </FeaturesSection>
      </Content>
    </Container>
  );
};

export default AboutPage;

// Styled Components
const Container = styled.div`
  font-family: "Inter", sans-serif;
  padding: 20px;
`;

const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  background: #f9f9f9;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 10;
`;

const Logo = styled.h1`
  font-size: 1.5rem;
  font-weight: bold;
  color: #007aff;
`;

const BackButton = styled.button`
  background-color: #007aff;
  color: #ffffff;
  padding: 5px 10px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;

  &:hover {
    background-color: #005bb5;
  }
`;

const Content = styled.div`
  padding: 20px;
`;

const Title = styled.h2`
  font-size: 2rem;
  font-weight: bold;
  color: #007aff;
  text-align: center;
  margin-bottom: 20px;
`;

const Description = styled.p`
  font-size: 1.2rem;
  color: #4a5568;
  text-align: center;
  margin-bottom: 40px;
`;

const HowItWorks = styled.div`
  margin-bottom: 40px;
`;

const SectionTitle = styled.h3`
  font-size: 1.5rem;
  font-weight: bold;
  color: #007aff;
  margin-bottom: 20px;
`;

const Steps = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const Step = styled.div`
  background: #f9f9f9;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
`;

const StepTitle = styled.h4`
  font-size: 1.2rem;
  font-weight: bold;
  color: #007aff;
  margin-bottom: 10px;
`;

const StepDescription = styled.p`
  font-size: 1rem;
  color: #4a5568;
`;

const FeaturesSection = styled.div`
  margin-top: 40px;
`;

const Features = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
`;

const Feature = styled.div`
  flex: 1;
  min-width: 250px;
  background: #ffffff;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
`;

const FeatureTitle = styled.h4`
  font-size: 1.2rem;
  font-weight: bold;
  color: #007aff;
  margin-bottom: 10px;
`;

const FeatureText = styled.p`
  font-size: 1rem;
  color: #4a5568;
`;
