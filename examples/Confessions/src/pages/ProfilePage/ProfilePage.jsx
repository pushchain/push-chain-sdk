import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import { useConnectWallet } from "@web3-onboard/react";
import ReactMarkdown from "react-markdown"; // Import for Markdown rendering

import { getConfessions } from "../../services/getConfessions";

const ProfilePage = () => {
  const [{ wallet }, , disconnect] = useConnectWallet();
  const [confessions, setConfessions] = useState([]);
  const navigate = useNavigate();

  const handleDisconnect = async () => {
    if (wallet) {
      await disconnect(wallet);
      navigate("/"); // Redirect back to the landing page
    }
  };

  useEffect(() => {
    const fetchConfessions = async () => {
      const allConfessions = await getConfessions();
      setConfessions(allConfessions);
    };

    fetchConfessions();
  }, []);

  return (
    <Container>
      <Header>
        <Title>Confessions dApp</Title>
        <Subtitle>Your confessions are anonymous and secure.</Subtitle>
        <DisconnectButton onClick={handleDisconnect}>Disconnect Wallet</DisconnectButton>
      </Header>

      <WalletDetails>
        <Label>Connected Wallet:</Label>
        <Value>{wallet?.accounts[0]?.address || "N/A"}</Value>
      </WalletDetails>

      <CardContainer>
        <Card onClick={() => navigate("/sent")}>
          <CardEmoji>📤</CardEmoji>
          <CardTitle>Sent Confessions</CardTitle>
        </Card>
        <Card onClick={() => navigate("/received")}>
          <CardEmoji>📥</CardEmoji>
          <CardTitle>Received Confessions</CardTitle>
        </Card>
        <Card onClick={() => navigate("/post")}>
          <CardEmoji>✍️</CardEmoji>
          <CardTitle>Post Confession</CardTitle>
        </Card>
      </CardContainer>

      <Feed>
        <FeedTitle>Confession Feed</FeedTitle>
        {confessions && confessions.map((confession, index) => (
          <Confession key={index}>
            <ConfessionHeader>
              <ConfessionAuthor>{confession.address}</ConfessionAuthor>
              <UpvoteButton>⬆ {confession.upvotes}</UpvoteButton>
            </ConfessionHeader>
            <ConfessionText>
              <ReactMarkdown>{confession.post}</ReactMarkdown>
            </ConfessionText>
          </Confession>
        ))}
      </Feed>
    </Container>
  );
};

export default ProfilePage;

// Styled Components
const Container = styled.div`
  padding: 20px;
  font-family: "Inter", sans-serif;
  background: #f9f9f9;
  min-height: 100vh;
`;

const Header = styled.header`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 30px;
`;

const Title = styled.h1`
  font-size: 2.5rem;
  font-weight: bold;
  color: #007aff;
`;

const Subtitle = styled.p`
  font-size: 1.2rem;
  color: #4a5568;
`;

const DisconnectButton = styled.button`
  background-color: #e53e3e;
  color: #ffffff;
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  margin-top: 20px;

  &:hover {
    background-color: #c53030;
  }
`;

const WalletDetails = styled.div`
  text-align: center;
  margin-bottom: 40px;
`;

const Label = styled.p`
  font-size: 1.2rem;
  font-weight: bold;
`;

const Value = styled.p`
  font-size: 1rem;
  color: #2d3748;
`;

const CardContainer = styled.div`
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-bottom: 40px;
`;

const Card = styled.div`
  background: #ffffff;
  border: 1px solid #dee2e6;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  width: 200px;
  cursor: pointer;
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.05);
  }
`;

const CardEmoji = styled.div`
  font-size: 2rem;
  margin-bottom: 10px;
`;

const CardTitle = styled.h3`
  font-size: 1.2rem;
  font-weight: bold;
`;

const Feed = styled.div`
  margin-top: 40px;
`;

const FeedTitle = styled.h2`
  font-size: 1.5rem;
  margin-bottom: 20px;
`;

const Confession = styled.div`
  background: #ffffff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
`;

const ConfessionHeader = styled.div`
  display: flex;
  justify-content: space-between;
`;

const ConfessionAuthor = styled.p`
  font-weight: bold;
`;

const ConfessionText = styled.div`
  margin-top: 10px;
  font-size: 1rem;
  color: #2d3748;
`;

const UpvoteButton = styled.button`
  background: #007aff;
  color: #ffffff;
  border: none;
  padding: 5px 10px;
  border-radius: 8px;
  cursor: pointer;

  &:hover {
    background: #005bb5;
  }
`;
