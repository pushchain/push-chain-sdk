import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";

import LandingPage from './pages/LandingPage/LandingPage.jsx';
import ProfilePage from './pages/ProfilePage/ProfilePage.jsx';
import SentConfessions from './pages/SentConfessions/SentConfessions.jsx';
import ReceivedConfessions from './pages/ReceivedConfessions/ReceivedConfessions.jsx';
import PostConfession from './pages/PostConfession/PostConfession.jsx';
import RumoursFeed from './pages/RumoursFeed/RumoursFeed.jsx';
import AboutPage from "./pages/AboutPage/AboutPage";

function App() {
  return (
    <Router>
      <Routes>
        {/* Landing Page */}
        <Route path="/" element={<LandingPage />} />

        {/* Profile Page */}
        <Route path="/profile" element={<ProfilePage />} />

        {/* Sent Confessions */}
        <Route path="/sent" element={<SentConfessions />} />

        {/* Received Confessions */}
        <Route path="/received" element={<ReceivedConfessions />} />

        {/* Post Confession */}
        <Route path="/post" element={<PostConfession />} />

        <Route path="/feed" element={<RumoursFeed />} />
        <Route path="/about" element={<AboutPage />} />

      </Routes>
    </Router>
  );
}

export default App;
