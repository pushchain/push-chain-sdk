import React, { useState, useEffect, useContext } from "react";
import styled, { keyframes } from "styled-components";
import ReactMarkdown from "react-markdown";
import { postConfession } from "../../services/postConfession";
import { useConnectWallet } from "@web3-onboard/react";
import { useNavigate } from "react-router-dom";
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { ConfessionContext } from "../../context/ConfessionContext";

const PostRumour = () => {
  const [text, setText] = useState("");
  const [isCardVisible, setIsCardVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [{ wallet }, connect, disconnect] = useConnectWallet();
  const navigate = useNavigate();

  const { handleSendSignRequestToPushWallet, connectionStatus } = usePushWalletContext();
  const { pushWalletAddress, user } = useContext(ConfessionContext);

  // Preserve wallet state on page reload
  useEffect(() => {
    const storedWallet = sessionStorage.getItem("walletConnected");
    if (storedWallet && !wallet && !pushWalletAddress) {
      connectWallet();
    }
  }, []);

  useEffect(() => {
    if (connectionStatus === "connected") {
      console.log("Push Wallet connected successfully");
    }
  }, [connectionStatus]);

  const connectWallet = async () => {
    try {
      if (!pushWalletAddress) {
        await connect();
        sessionStorage.setItem("walletConnected", "true");
      }
    } catch (error) {
      console.error("Wallet connection failed:", error);
    }
  };

  const handleDisconnect = async () => {
    if (wallet) {
      await disconnect(wallet);
      sessionStorage.removeItem("walletConnected");
      navigate("/");
    }
  };

  const handlePost = async () => {
    if (!text.trim()) {
      alert("Please write something to post your rumour.");
      return;
    }
  
    setLoading(true);
  
    const rumourDetails = {
      post: text,
      address: pushWalletAddress || wallet?.accounts[0]?.address,
      upvotes: 0,
      isVisible: true,
    };
  
    try {
      if (pushWalletAddress) {
        await postConfession(user, pushWalletAddress, rumourDetails, handleSendSignRequestToPushWallet);
      } else {
        await postConfession(user, wallet, rumourDetails);
      }
  
      setIsCardVisible(true);
      setText("");
    } catch (error) {
      console.error("Error posting rumour:", error);
      alert("Failed to post your rumour. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const insertText = (before, after = "") => {
    const textarea = document.getElementById("textarea");
    const start = text.slice(0, textarea.selectionStart);
    const end = text.slice(textarea.selectionEnd);
    setText(`${start}${before}${end}${after}`);
  };

  // Get the display address
  const displayAddress = pushWalletAddress || (wallet?.accounts[0]?.address 
    ? `${wallet.accounts[0].address.slice(0, 6)}...${wallet.accounts[0].address.slice(-4)}`
    : null);

  return (
    <Container>
      <Header>
        <Logo>🔗 Web3 Rumours</Logo>
        <HeaderButtons>
          {displayAddress ? (
            <>
              <WalletButton>
                {`Wallet: ${displayAddress}`}
              </WalletButton>
              <ActionButton onClick={() => navigate("/profile")}>
                Profile
              </ActionButton>
              <DisconnectButton onClick={handleDisconnect}>
                Disconnect
              </DisconnectButton>
            </>
          ) : (
            <>
              <ActionButton onClick={connectWallet}>Connect Metamask</ActionButton>
              <ActionButton 
                onClick={handleSendSignRequestToPushWallet}
                disabled={connectionStatus === "connected"}
              >
                {connectionStatus === "connected" ? "Push Connected" : "Connect Push"}
              </ActionButton>
            </>
          )}
        </HeaderButtons>
      </Header>

      <PostContainer>
        <HeaderTitle>✍️ Post a Rumour</HeaderTitle>
        <MarkdownToolbar>
          <ToolbarButton onClick={() => insertText("**", "**")}>Bold</ToolbarButton>
          <ToolbarButton onClick={() => insertText("_", "_")}>Italic</ToolbarButton>
          <ToolbarButton onClick={() => insertText("~~", "~~")}>Strikethrough</ToolbarButton>
          <ToolbarButton onClick={() => insertText("> ")}>Quote</ToolbarButton>
          <ToolbarButton onClick={() => insertText("[", "](url)")}>Link</ToolbarButton>
        </MarkdownToolbar>
        <PostBox>
          <Textarea
            id="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your rumour here... (Markdown supported!)"
          />
          <MarkdownPreview>
            <PreviewHeader>Markdown Preview:</PreviewHeader>
            <ReactMarkdown>{text}</ReactMarkdown>
          </MarkdownPreview>
        </PostBox>
        <PostButton onClick={handlePost} disabled={loading || (!wallet && !pushWalletAddress)}>
          {loading ? "Posting..." : "Post Rumour"}
        </PostButton>
      </PostContainer>

      {isCardVisible && (
        <Card>
          <CardHeader>🎉 Rumour Posted Successfully!</CardHeader>
          <CardContent>
            <p>Your rumour has been recorded on the blockchain.</p>
          </CardContent>
          <CardButton onClick={() => navigate("/profile")}>
            Visit Updated Feed
          </CardButton>
        </Card>
      )}
    </Container>
  );
};

export default PostRumour;

// Styled Components
const gradientAnimation = keyframes`
  0% { border-color: #007aff; }
  50% { border-color: #ff3b57; }
  100% { border-color: #6c63ff; }
`;

const Container = styled.div`
  padding: 20px;
  font-family: "Inter", sans-serif;
  background: linear-gradient(120deg, #e6f7ff, #ffffff);
  min-height: 100vh;
`;

const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  padding: 15px 20px;
  border-bottom: 1px solid #ddd;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

const Logo = styled.h1`
  font-size: 1.8rem;
  font-weight: bold;
  color: #007aff;
`;

const HeaderButtons = styled.div`
  display: flex;
  gap: 10px;

  @media (max-width: 768px) {
    margin-top: 10px;
    flex-direction: column;
  }
`;

const WalletButton = styled.button`
  background: #007aff;
  color: white;
  border: none;
  border-radius: 20px;
  padding: 10px 20px;
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

const PostContainer = styled.div`
  max-width: 800px;
  margin: 20px auto;
  background: #ffffff;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  border: 4px solid;
  animation: ${gradientAnimation} 2s infinite;
`;

const HeaderTitle = styled.h1`
  font-size: 2rem;
  text-align: center;
  color: #333;
  margin-bottom: 20px;
`;

const MarkdownToolbar = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
`;

const ToolbarButton = styled.button`
  background: #f8f9fa;
  border: 1px solid #ddd;
  padding: 8px 12px;
  font-size: 0.9rem;
  border-radius: 8px;
  cursor: pointer;

  &:hover {
    background: #e9ecef;
  }
`;

const PostBox = styled.div`
  margin-bottom: 20px;
`;

const Textarea = styled.textarea`
  width: 100%;
  height: 150px;
  padding: 10px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 1rem;
  margin-bottom: 10px;
`;

const MarkdownPreview = styled.div`
  padding: 15px;
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
`;

const PreviewHeader = styled.h3`
  font-size: 1rem;
  color: #495057;
  margin-bottom: 10px;
`;

const PostButton = styled.button`
  background-color: #007aff;
  color: white;
  padding: 12px 20px;
  border: none;
  border-radius: 20px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  display: block;
  margin: 0 auto;

  &:hover {
    background-color: #005bb5;
  }

  &:disabled {
    background-color: #ccc;
    cursor: not-allowed;
  }
`;

const Card = styled.div`
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: #ffffff;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  width: 300px;
`;

const CardHeader = styled.h3`
  font-size: 1.5rem;
  color: #28a745;
  margin-bottom: 10px;
`;

const CardContent = styled.div`
  font-size: 1rem;
  color: #333;
  margin-bottom: 10px;
`;

const CardButton = styled.button`
  background-color: #007aff;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 20px;
  font-size: 1rem;
  cursor: pointer;

  &:hover {
    background-color: #005bb5;
  }
`;
