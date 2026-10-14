import React, { useState } from 'react';
import "../App.css";
import { useNavigate } from 'react-router-dom';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import SecurityIcon from '@mui/icons-material/Security';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import ChatIcon from '@mui/icons-material/Chat';
import SpeedIcon from '@mui/icons-material/Speed';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import { Button } from '@mui/material';
import ThemeToggle from '../components/ThemeToggle';

export default function LandingPage() {
    const router = useNavigate();
    const [quickCode, setQuickCode] = useState("");

    const handleQuickJoin = (e) => {
        e.preventDefault();
        if (quickCode.trim()) {
            router(`/${quickCode.trim()}`);
        }
    };

    const handleGuestJoin = () => {
        const randomId = Math.random().toString(36).substring(2, 9);
        router(`/${randomId}`);
    };

    return (
        <div className='landingPageContainer'>
            <div className="ambientGlowTop"></div>

            {/* Navigation Bar */}
            <nav>
                <div className='brandLogo' onClick={() => router("/")}>
                    <div className='brandLogoIcon'>
                        <WhatshotIcon />
                    </div>
                    <span className='brandLogoText'>ᗪYᑎᗩ<span>ᗰ<span>EET</span></span></span>
                </div>

                <div className='navlist'>
                    <ThemeToggle />
                    <span className='navItem' onClick={handleGuestJoin}>
                        Join as Guest
                    </span>
                    <span className='navItem' onClick={() => router("/auth")}>
                        Sign In
                    </span>
                    <Button 
                        className='btnPrimaryGradient' 
                        onClick={() => router("/auth")}
                        variant="contained"
                    >
                        Get Started Free
                    </Button>
                </div>
            </nav>

            {/* Hero Section */}
            <main className="landingMainContainer">
                <div className="heroContent">
                    <div className="heroBadge">
                        <span className="heroBadgeDot"></span>
                        Next-Gen WebRTC Video Conferencing
                    </div>

                    <h1 className="heroHeading">
                        Connect with anyone, <br />
                        <span className="heroHeadingGradient">Anywhere in real-time.</span>
                    </h1>

                    <p className="heroSubtext">
                        Experience ultra-low latency, studio-quality 4K HD video & spatial audio meetings with end-to-end peer encryption. Fast, modern, and zero downloads required.
                    </p>

                    <div className="heroActions">
                        <Button 
                            className="btnPrimaryGradient" 
                            size="large"
                            onClick={() => router("/auth")}
                            endIcon={<ArrowForwardIcon />}
                            sx={{ py: 1.3, px: 2.5, fontSize: '1.02rem' }}
                        >
                            Start a Free Meeting
                        </Button>

                        <form onSubmit={handleQuickJoin} className="heroJoinBox">
                            <input
                                type="text"
                                className="heroJoinInput"
                                placeholder="Enter Room Code"
                                value={quickCode}
                                onChange={(e) => setQuickCode(e.target.value)}
                            />
                            <Button 
                                type="submit" 
                                className="btnSecondaryOutline"
                                size="small"
                                disabled={!quickCode.trim()}
                                sx={{ py: 0.7, px: 1.4 }}
                            >
                                Join
                            </Button>
                        </form>
                    </div>
                </div>

                <div className="heroGraphic">
                    <div className="heroGraphicCard">
                        <img src="/mobile.png" alt="Video Call Preview" />
                        <div className="floatingTag floatingTagTop">
                            <SecurityIcon style={{ color: "#e11d48", fontSize: "1.25rem" }} />
                            <span>End-to-End Encrypted</span>
                        </div>
                        <div className="floatingTag floatingTagBottom">
                            <SpeedIcon style={{ color: "#f43f5e", fontSize: "1.25rem" }} />
                            <span>Ultra HD 60FPS Stream</span>
                        </div>
                    </div>
                </div>
            </main>

            {/* Features Section */}
            <section className="featuresSection">
                <h2 className="featuresTitle">Engineered for seamless collaboration</h2>
                <div className="featuresGrid">
                    <div className="featureCard">
                        <div className="featureIcon">
                            <VideoCallIcon />
                        </div>
                        <h3>4K Video & Spatial Audio</h3>
                        <p>Adaptive bitrate streaming ensures crystal clear video and studio-grade audio even on low-bandwidth networks.</p>
                    </div>

                    <div className="featureCard">
                        <div className="featureIcon" style={{ color: "#e11d48", background: "rgba(225, 29, 72, 0.12)" }}>
                            <ScreenShareIcon />
                        </div>
                        <h3>1-Click Screen Share</h3>
                        <p>Share tabs, windows, or full displays instantly with high-fidelity frame rates and system audio.</p>
                    </div>

                    <div className="featureCard">
                        <div className="featureIcon" style={{ color: "#be123c", background: "rgba(190, 18, 60, 0.12)" }}>
                            <ChatIcon />
                        </div>
                        <h3>Integrated Live Chat</h3>
                        <p>Exchange live messages, links, and meeting notes in real-time alongside your active video stream.</p>
                    </div>

                    <div className="featureCard">
                        <div className="featureIcon" style={{ color: "#9f1239", background: "rgba(159, 18, 57, 0.12)" }}>
                            <SecurityIcon />
                        </div>
                        <h3>Zero Install & Secure</h3>
                        <p>Direct peer-to-peer WebRTC connections with no app downloads, no tracking, and 100% data privacy.</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
