// src/pages/SentConfessionsPage/SentConfessionsPage.js
import React from 'react';
import styled from 'styled-components';

const SentConfessionsPage = () => {
  return (
    <Container>
      <Title>📤 Sent Confessions</Title>
      <ConfessionList>
        {/* Replace with actual sent confessions */}
        <Confession>Confession #1: Lorem ipsum dolor sit amet.</Confession>
        <Confession>Confession #2: Consectetur adipiscing elit.</Confession>
      </ConfessionList>
    </Container>
  );
};

export default SentConfessionsPage;

// Styled Components
const Container = styled.div`
  padding: 20px;
`;

const Title = styled.h1`
  font-size: 2rem;
  margin-bottom: 20px;
`;

const ConfessionList = styled.div`
  display: flex;
  flex-direction: column;
`;

const Confession = styled.div`
  padding: 15px;
  border: 1px solid #dee2e6;
  border-radius: 5px;
  margin-bottom: 10px;
`;
