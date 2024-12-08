import React, { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";
import { getConfessions } from "../../services/getConfessions";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";

const RumoursFeed = () => {
  const [confessions, setConfessions] = useState([]);
  const [upvotes, setUpvotes] = useState({});
  const [walletConnected, setWalletConnected] = useState(false); // Simulating wallet state
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  // Fetch confessions and sort by upvotes
  useEffect(() => {
    const fetchConfessions = async () => {
      const fetchedConfessions = await getConfessions();
      const sortedConfessions = fetchedConfessions.sort(
        (a, b) => b.upVoteCount - a.upVoteCount
      );
      setConfessions(sortedConfessions);

      // Initialize upvote count
      const upvoteMap = {};
      fetchedConfessions.forEach((confession) => {
        upvoteMap[confession.address] = confession.upVoteCount || 0;
      });
      setUpvotes(upvoteMap);
    };

    fetchConfessions();
    const interval = setInterval(fetchConfessions, 60000); // Poll every 60 seconds
    return () => clearInterval(interval);
  }, []);

  // Handle upvote logic
  const handleUpvote = (address) => {
    if (!walletConnected) {
      setShowModal(true);
      return;
    }

    setUpvotes((prev) => ({
      ...prev,
      [address]: prev[address] + 1,
    }));
  };

  // Close modal
  const closeModal = () => {
    setShowModal(false);
  };

  return (
    <Container>
      {/* Header */}
      <Header>
        <Logo>🔗 Web3 Rumours</Logo>
        <Nav>
          <NavItem onClick={() => navigate("/")}>🏠 Home</NavItem>
          {walletConnected && (
            <NavItem onClick={() => navigate("/profile")}>👤 Profile</NavItem>
          )}
        </Nav>
        <WalletButton onClick={() => setWalletConnected(!walletConnected)}>
          {walletConnected ? "Disconnect Wallet" : "Connect Wallet"}
        </WalletButton>
      </Header>

      {/* Feed Section */}
      <FeedContainer>
        <FeedTitle>Buzzing Rumours</FeedTitle>
        {confessions.length === 0 ? (
          <EmptyState>
            🌟 Patience is a virtue! The rumour mill is grinding something juicy...
          </EmptyState>
        ) : (
          <FeedList>
            {confessions.map((confession, index) => (
              <FeedItem key={index}>
                <ConfessionContent>
                  <Post>
                    <ReactMarkdown>{confession.markdownPost}</ReactMarkdown>
                  </Post>
                  <Details>
                    <Address>{`Posted by: ${confession.address}`}</Address>
                    <UpvoteButton onClick={() => handleUpvote(confession.address)}>
                      👍 {upvotes[confession.address]}
                    </UpvoteButton>
                  </Details>
                </ConfessionContent>
              </FeedItem>
            ))}
          </FeedList>
        )}
      </FeedContainer>

      {/* Wallet Modal */}
      {showModal && (
        <Modal>
          <ModalContent>
            <ModalHeader>Connect Wallet</ModalHeader>
            <ModalBody>
              To like a rumour, you need to connect your wallet. Would you like
              to connect now?
            </ModalBody>
            <ModalFooter>
              <ModalButton onClick={closeModal}>Cancel</ModalButton>
              <ModalButton
                onClick={() => {
                  setWalletConnected(true);
                  closeModal();
                }}
              >
                Connect Wallet
              </ModalButton>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </Container>
  );
};

export default RumoursFeed;

// Styled Components

const backgroundAnimation = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

const Container = styled.div`
  font-family: "Inter", sans-serif;
  background: linear-gradient(-45deg, #f9f9f9, #f0f4ff, #ffe9f9, #e9ecef);
  background-size: 400% 400%;
  animation: ${backgroundAnimation} 10s ease infinite;
  color: #0d1117;
  min-height: 100vh;
`;

const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 40px;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 2px solid #007aff;
`;

const Logo = styled.h1`
  font-size: 1.8rem;
  font-weight: 700;
  color: #007aff;
  font-family: "Roboto Slab", serif;
`;

const Nav = styled.nav`
  display: flex;
  gap: 15px;
`;

const NavItem = styled.button`
  background: transparent;
  border: none;
  font-size: 1rem;
  color: #333;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    color: #007aff;
  }
`;

const WalletButton = styled.button`
  background-color: #007aff;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background-color: #005bb5;
  }
`;

const FeedContainer = styled.section`
  max-width: 900px;
  margin: 20px auto;
  padding: 20px;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  border: 4px solid;
  border-image: linear-gradient(120deg, #ff3b57, #007aff, #ffd700) 1;
`;

const FeedTitle = styled.h2`
  font-size: 2.5rem;
  color: #0d1117;
  margin-bottom: 20px;
  text-align: center;
  font-family: "Dancing Script", cursive;
`;

const FeedList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 15px;
`;

const FeedItem = styled.div`
  background: linear-gradient(120deg, #f7f8fa, #ffffff);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.02);
  }
`;

const ConfessionContent = styled.div`
  display: flex;
  flex-direction: column;
`;

const Post = styled.div`
  font-size: 1.1rem;
  color: #495057;
  margin-bottom: 10px;
  line-height: 1.6;
`;

const Details = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9rem;
  color: #6c757d;
`;

const Address = styled.span`
  font-style: italic;
`;

const UpvoteButton = styled.button`
  background: #007aff;
  color: white;
  border: none;
  border-radius: 5px;
  padding: 5px 10px;
  font-size: 0.9rem;
  cursor: pointer;

  &:hover {
    background: #005bb5;
  }
`;

const EmptyState = styled.p`
  text-align: center;
  color: #6c757d;
  font-size: 1.2rem;
  margin-top: 50px;
`;

const Modal = styled.div`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  width: 90%;
  max-width: 400px;
`;

const ModalContent = styled.div``;

const ModalHeader = styled.h2`
  font-size: 1.5rem;
  margin-bottom: 10px;
`;

const ModalBody = styled.p`
  font-size: 1rem;
  margin-bottom: 20px;
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: space-between;
`;

const ModalButton = styled.button`
  background: #007aff;
  color: white;
  padding: 10px 15px;
  border: none;
  border-radius: 5px;
  cursor: pointer;

  &:hover {
    background: #005bb5;
  }
`;
