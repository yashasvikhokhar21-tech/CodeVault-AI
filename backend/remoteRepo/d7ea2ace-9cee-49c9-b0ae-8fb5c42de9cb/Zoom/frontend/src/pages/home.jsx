import React, { useContext, useState } from 'react';
import withAuth from '../utils/withAuth';
import { useNavigate } from 'react-router-dom';
import "../App.css";
import { Button, TextField, Box, Typography, CssBaseline } from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import LogoutIcon from '@mui/icons-material/Logout';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import HistoryEduIcon from '@mui/icons-material/HistoryEdu';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import { AuthContext } from '../contexts/AuthContext';
import ThemeToggle from '../components/ThemeToggle';
import { useThemeMode } from '../contexts/ThemeContext';

function HomeComponent() {
    const navigate = useNavigate();
    const { isDark } = useThemeMode();
    const [meetingCode, setMeetingCode] = useState("");
    const [createdCode, setCreatedCode] = useState("");
    const [copied, setCopied] = useState(false);
    const { addToUserHistory } = useContext(AuthContext);

    const handleJoinVideoCall = async (e) => {
        if (e) e.preventDefault();
        const code = meetingCode.trim();
        if (!code) return;
        try {
            await addToUserHistory(code);
        } catch (err) {
            console.error(err);
        }
        navigate(`/${code}`);
    };

    const handleCreateInstantMeeting = async () => {
        const randomCode = Math.random().toString(36).substring(2, 8);
        try {
            await addToUserHistory(randomCode);
        } catch (err) {
            console.error(err);
        }
        navigate(`/${randomCode}`);
    };

    const handleGenerateCode = () => {
        const code = Math.random().toString(36).substring(2, 8);
        setCreatedCode(code);
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(`${window.location.origin}/${createdCode}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    return (
        <div className="dashboardContainer">
            <CssBaseline />
            {/* Navbar */}
            <header className="modernNavBar">
                <div className="brandLogo" onClick={() => navigate("/home")}>
                    <div className="brandLogoIcon">
                        <WhatshotIcon />
                    </div>
                    <span className="brandLogoText">Apna <span>Meet</span></span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <ThemeToggle />

                    <Button
                        startIcon={<RestoreIcon />}
                        onClick={() => navigate("/history")}
                        className="btnSecondaryOutline"
                        size="small"
                    >
                        Meeting History
                    </Button>

                    <Button
                        startIcon={<LogoutIcon />}
                        onClick={() => {
                            localStorage.removeItem("token");
                            navigate("/auth");
                        }}
                        sx={{
                            color: isDark ? '#fca5a5' : '#dc2626',
                            border: isDark ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid #e2e8f0',
                            background: isDark ? 'transparent' : '#ffffff',
                            borderRadius: '10px',
                            textTransform: 'none',
                            fontWeight: 700,
                            px: 1.6,
                            '&:hover': {
                                background: isDark ? 'rgba(239, 68, 68, 0.08)' : '#f1f5f9',
                                borderColor: isDark ? 'rgba(239, 68, 68, 0.4)' : '#cbd5e1',
                            }
                        }}
                        size="small"
                    >
                        Sign Out
                    </Button>
                </div>
            </header>

            {/* Dashboard Main Content */}
            <main className="dashboardMain">
                {/* Welcome Banner */}
                <div className="dashboardHeroCard">
                    <div className="dashboardHeroContent">
                        <div className="heroBadge">
                            <span className="heroBadgeDot"></span>
                            HD Studio Active
                        </div>
                        <h2>Welcome to your Video Conferencing Hub</h2>
                        <p>
                            Start an instant video conference, generate shareable meeting links for your team, or jump straight into an active room with a code.
                        </p>
                    </div>
                    <div style={{ display: "flex", gap: "1rem" }}>
                        <Button
                            variant="contained"
                            size="large"
                            className="btnPrimaryGradient"
                            startIcon={<AddCircleOutlineIcon />}
                            onClick={handleCreateInstantMeeting}
                            sx={{ py: 1.1, px: 2.2, fontSize: '0.96rem' }}
                        >
                            Instant Meeting
                        </Button>
                    </div>
                </div>

                {/* Quick Actions Grid */}
                <div className="quickActionsGrid">
                    {/* 1. Join Existing Meeting Card */}
                    <div className="actionCard">
                        <div className="actionCardHeader">
                            <div className="actionIcon actionIconRed">
                                <MeetingRoomIcon />
                            </div>
                            <div>
                                <Typography variant="h6" sx={{ fontWeight: 800 }}>Join Meeting</Typography>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>Enter a code to join a call</Typography>
                            </div>
                        </div>

                        <form onSubmit={handleJoinVideoCall} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="e.g. abc-123 or meeting-room"
                                label="Meeting Code"
                                value={meetingCode}
                                onChange={(e) => setMeetingCode(e.target.value)}
                            />
                            <Button
                                type="submit"
                                variant="contained"
                                className="btnPrimaryGradient"
                                disabled={!meetingCode.trim()}
                                endIcon={<ArrowForwardIcon />}
                            >
                                Join Call Now
                            </Button>
                        </form>
                    </div>

                    {/* 2. Schedule / Create Room Card */}
                    <div className="actionCard">
                        <div className="actionCardHeader">
                            <div className="actionIcon actionIconRose">
                                <VideoCallIcon />
                            </div>
                            <div>
                                <Typography variant="h6" sx={{ fontWeight: 800 }}>Get Meeting Link</Typography>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>Generate a shareable room link</Typography>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {createdCode ? (
                                <Box
                                    sx={{
                                        background: isDark ? 'rgba(255, 255, 255, 0.04)' : '#f8fafc',
                                        p: 1.4,
                                        borderRadius: '10px',
                                        border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid #e2e8f0',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                    }}
                                >
                                    <Typography sx={{ fontFamily: 'Fira Code', fontWeight: 700, color: isDark ? '#fca5a5' : '#dc2626', fontSize: '1rem' }}>
                                        {createdCode}
                                    </Typography>
                                    <Button
                                        size="small"
                                        onClick={copyToClipboard}
                                        startIcon={copied ? <CheckIcon style={{ color: '#10b981' }} /> : <ContentCopyIcon />}
                                        sx={{ textTransform: 'none', color: isDark ? '#fca5a5' : '#dc2626', fontWeight: 700 }}
                                    >
                                        {copied ? 'Copied Link' : 'Copy Link'}
                                    </Button>
                                </Box>
                            ) : (
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                    Click below to create a unique link that you can share with friends and colleagues.
                                </Typography>
                            )}

                            <Button
                                variant="outlined"
                                className="btnSecondaryOutline"
                                onClick={handleGenerateCode}
                            >
                                {createdCode ? 'Generate Another Code' : 'Generate Link to Share'}
                            </Button>
                        </div>
                    </div>

                    {/* 3. History Shortcut Card */}
                    <div className="actionCard">
                        <div className="actionCardHeader">
                            <div className="actionIcon actionIconSlate">
                                <HistoryEduIcon />
                            </div>
                            <div>
                                <Typography variant="h6" sx={{ fontWeight: 800 }}>Past Activity</Typography>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>View previously attended calls</Typography>
                            </div>
                        </div>

                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            Access complete logs, recordings, and timestamps of all meetings you have hosted or joined.
                        </Typography>

                        <Button
                            variant="outlined"
                            className="btnSecondaryOutline"
                            onClick={() => navigate("/history")}
                            endIcon={<ArrowForwardIcon />}
                            sx={{ mt: 'auto' }}
                        >
                            View Activity Log
                        </Button>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default withAuth(HomeComponent);