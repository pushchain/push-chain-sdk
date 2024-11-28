import React, { useState } from "react";
import styled from "styled-components";
import ReactMarkdown from "react-markdown";
import Modal from "react-modal";

import { postConfession } from "../../services/postConfession";
import { useConnectWallet } from "@web3-onboard/react";

const PostConfession = () => {
  const [text, setText] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [{ wallet }] = useConnectWallet();

  const handlePost = async () => {
    if (text.trim()) {
      const confessionDetails = {
        post: text,
        address: wallet.accounts[0]?.address,
        upvotes: 0,
        isVisible: true,
      };

      console.log(
        "Sending this confession: " + JSON.stringify(confessionDetails)
      );

      postConfession(wallet, confessionDetails);

      // Open modal for successful submission
      setIsModalOpen(true);
      setText("");
    } else {
      alert("Please write something to post your confession.");
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  return (
    <Container>
      <Header>✍️ Post a Confession</Header>
      <ConfessionBox>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your confession here... (Markdown supported!)"
        />
        <MarkdownPreview>
          <PreviewHeader>Markdown Preview:</PreviewHeader>
          <ReactMarkdown>{text}</ReactMarkdown>
        </MarkdownPreview>
      </ConfessionBox>
      <PostButton onClick={handlePost}>Post Confession</PostButton>

      {/* Modal Popup */}
      <Modal
        isOpen={isModalOpen}
        onRequestClose={closeModal}
        style={modalStyles}
        ariaHideApp={false}
      >
        <ModalContent>
          <ModalEmoji>🎉</ModalEmoji>
          <ModalMessage>Your confession has been submitted successfully!</ModalMessage>
          <CloseButton onClick={closeModal}>Close</CloseButton>
        </ModalContent>
      </Modal>
    </Container>
  );
};

export default PostConfession;

// Styled Components
const Container = styled.div`
  padding: 20px;
  font-family: "Inter", sans-serif;
  min-height: 100vh;
  background: #f0f2f5;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const Header = styled.h1`
  font-size: 2rem;
  color: #007aff;
  margin-bottom: 20px;
`;

const ConfessionBox = styled.div`
  width: 100%;
  max-width: 600px;
  background: #ffffff;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  margin-bottom: 20px;
`;

const Textarea = styled.textarea`
  width: 100%;
  height: 150px;
  padding: 15px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 1rem;
  color: #4a5568;
  resize: none;
  margin-bottom: 20px;
`;

const MarkdownPreview = styled.div`
  background: #f9f9f9;
  padding: 15px;
  border-radius: 8px;
  border: 1px solid #dee2e6;
`;

const PreviewHeader = styled.h3`
  font-size: 1rem;
  color: #007aff;
  margin-bottom: 10px;
`;

const PostButton = styled.button`
  background-color: #007aff;
  color: #ffffff;
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.3s ease, transform 0.2s ease;

  &:hover {
    background-color: #005bb5;
    transform: scale(1.05);
  }
`;

const ModalContent = styled.div`
  text-align: center;
  padding: 30px;
`;

const ModalEmoji = styled.div`
  font-size: 3rem;
  margin-bottom: 20px;
`;

const ModalMessage = styled.h3`
  font-size: 1.5rem;
  color: #4a5568;
  margin-bottom: 20px;
`;

const CloseButton = styled.button`
  background-color: #007aff;
  color: #ffffff;
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.3s ease;

  &:hover {
    background-color: #005bb5;
  }
`;

const modalStyles = {
  content: {
    top: "50%",
    left: "50%",
    right: "auto",
    bottom: "auto",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    width: "400px",
    borderRadius: "12px",
    boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)",
  },
};


