import React, { useEffect, useState, useContext } from "react";
import styled, { keyframes } from "styled-components";
import { useConnectWallet } from "@web3-onboard/react";
import ReactMarkdown from "react-markdown";
import { getSentConfessions } from "../../services/getSentConfessions";
import { useNavigate } from "react-router-dom";
import { ConfessionContext } from "../../context/ConfessionContext";

const SentConfessionsPage = () => {
  const [sentConfessions, setSentConfessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRumor, setSelectedRumor] = useState(null);
  const [{ wallet }, connect, disconnect] = useConnectWallet();
  const navigate = useNavigate();
  const { pushWalletAddress, user } = useContext(ConfessionContext);

  const web3Facts = [
    "Web3 ensures decentralized data ownership!",
    "Rumors can travel faster on the blockchain!",
    "Every transaction tells a unique story in Web3.",
    "Blockchain never forgets, and neither do rumors!",
    "Web3 rumors are immutable and secure!",
  ];

  const randomFact =
    web3Facts[Math.floor(Math.random() * web3Facts.length)] || "Loading...";

  useEffect(() => {
    const fetchSentConfessions = async () => {
      try {
        setLoading(true);
        const address = pushWalletAddress || wallet?.accounts?.[0]?.address;
        if (!address) {
          throw new Error("No wallet connected");
        }
        const data = await getSentConfessions(address);
        setSentConfessions(data || []);
      } catch (error) {
        console.error("Error fetching sent confessions:", error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSentConfessions();

    const interval = setInterval(fetchSentConfessions, 60000); // Polling every 60 seconds
    return () => clearInterval(interval);
  }, [wallet, pushWalletAddress]);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error("Error connecting wallet:", error.message);
    }
  };

  const handleDisconnect = async () => {
    if (wallet) {
      await disconnect(wallet);
    }
  };

  const truncateAddress = (address) =>
    address ? `${address.slice(0, 4)}...${address.slice(-4)}` : "N/A";

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert("Rumor copied to clipboard!");
  };

  return (
    <Container>
      {/* Header */}
      <Header>
        <Logo>🔗 Web3 Rumours</Logo>
        <HeaderButtons>
          {wallet ? (
            <>
              <WalletButton>
                {`Wallet: ${truncateAddress(wallet.accounts[0]?.address)}`}
              </WalletButton>
              <ActionButton onClick={() => navigate("/profile")}>
                Profile
              </ActionButton>
              <DisconnectButton onClick={handleDisconnect}>
                Disconnect
              </DisconnectButton>
            </>
          ) : (
            <ActionButton onClick={handleConnect}>Connect Wallet</ActionButton>
          )}
        </HeaderButtons>
      </Header>

      {/* Back Button */}
      <BackButton onClick={() => navigate("/profile")}>⬅ Back to Profile</BackButton>

      <Content>
        <Title>📤 Sent Rumours</Title>
        {loading ? (
          <Loader>⏳ Loading... Did you know? {randomFact}</Loader>
        ) : sentConfessions.length === 0 ? (
          <EmptyState>No rumors sent yet. Start the buzz now!</EmptyState>
        ) : (
          <ConfessionList>
            {sentConfessions.map((confession, index) => (
              <ConfessionCard key={index}>
                <ReactMarkdown>{confession.post}</ReactMarkdown>
                <CardActions>
                  <ActionButton
                    onClick={() => setSelectedRumor(confession.post)}
                  >
                    Open
                  </ActionButton>
                  <ActionButton
                    onClick={() => copyToClipboard(confession.post)}
                  >
                    Copy
                  </ActionButton>
                </CardActions>
              </ConfessionCard>
            ))}
          </ConfessionList>
        )}
      </Content>

      {/* Modal for Selected Rumor */}
      {selectedRumor && (
        <Modal>
          <ModalContent>
            <ModalCloseButton onClick={() => setSelectedRumor(null)}>
              ×
            </ModalCloseButton>
            <ReactMarkdown>{selectedRumor}</ReactMarkdown>
          </ModalContent>
        </Modal>
      )}
    </Container>
  );
};

export default SentConfessionsPage;

// Styled Components

const gradientAnimation = keyframes`
  0% { background-color: #007aff; }
  50% { background-color: #ff3b57; }
  100% { background-color: #6c63ff; }
`;

const Container = styled.div`
  font-family: "Inter", sans-serif;
  background: linear-gradient(120deg, #f0f9ff, #ffffff);
  min-height: 100vh;
`;

const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  padding: 15px 20px;
  border-bottom: 1px solid #ddd;
`;

const Logo = styled.h1`
  font-size: 1.8rem;
  font-weight: bold;
  color: #007aff;
`;

const HeaderButtons = styled.div`
  display: flex;
  gap: 10px;
`;

const WalletButton = styled.button`
  background: #007aff;
  color: white;
  border: none;
  border-radius: 20px;
  padding: 8px 15px;
  font-size: 1rem;
  cursor: pointer;

  &:hover {
    background: #005bb5;
  }
`;

const ActionButton = styled(WalletButton)`
  background: #6c63ff;

  &:hover {
    background: #4b4aee;
  }
`;

const DisconnectButton = styled(WalletButton)`
  background: #ff3b57;

  &:hover {
    background: #e0354e;
  }
`;

const BackButton = styled.button`
  background: linear-gradient(120deg, #ff3b57, #6c63ff);
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  margin: 20px;

  &:hover {
    background: linear-gradient(120deg, #6c63ff, #ff3b57);
  }
`;

const Content = styled.div`
  padding: 20px;
`;

const Title = styled.h1`
  font-size: 2rem;
  margin-bottom: 20px;
  color: #333;
`;

const Loader = styled.div`
  text-align: center;
  font-size: 1.2rem;
  color: #6c757d;
`;

const EmptyState = styled.div`
  text-align: center;
  font-size: 1rem;
  color: #6c757d;
  margin-top: 30px;
`;

const ConfessionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 15px;
`;

const ConfessionCard = styled.div`
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border: 1px solid #dee2e6;
`;

const CardActions = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
`;

const Modal = styled.div`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  width: 90%;
  max-width: 500px;
`;

const ModalContent = styled.div`
  position: relative;
`;

const ModalCloseButton = styled.button`
  position: absolute;
  top: 10px;
  right: 10px;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
`;
