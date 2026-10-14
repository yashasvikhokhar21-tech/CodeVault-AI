import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
    Button,
    IconButton,
    Typography,
    Box,
    CssBaseline,
    TextField,
    InputAdornment,
    Snackbar,
    Alert
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import SearchIcon from '@mui/icons-material/Search';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import CheckIcon from '@mui/icons-material/Check';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import ThemeToggle from '../components/ThemeToggle';
import "../App.css";

export default function History() {
    const { getHistoryOfUser } = useContext(AuthContext);
    const [meetings, setMeetings] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(true);
    const [copiedCode, setCopiedCode] = useState("");
    const [toastOpen, setToastOpen] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const history = await getHistoryOfUser();
                setMeetings(Array.isArray(history) ? history : []);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, []);

    const formatDate = (dateString) => {
        if (!dateString) return "N/A";
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleCopy = (code) => {
        navigator.clipboard.writeText(`${window.location.origin}/${code}`);
        setCopiedCode(code);
        setToastOpen(true);
    };

    const filteredMeetings = meetings.filter(m =>
        (m.meetingCode || "").toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="historyContainer">
            <CssBaseline />
            {/* Navbar Header */}
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
                        startIcon={<ArrowBackIcon />}
                        onClick={() => navigate("/home")}
                        className="btnSecondaryOutline"
                        size="small"
                    >
                        Back to Dashboard
                    </Button>
                </div>
            </header>

            {/* History Content */}
            <main className="historyContent">
                <div className="historyHeader">
                    <div>
                        <Typography variant="h5" sx={{ fontWeight: 800 }}>Meeting Activity Log</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            Total {meetings.length} meeting {meetings.length === 1 ? 'session' : 'sessions'} recorded
                        </Typography>
                    </div>

                    {meetings.length > 0 && (
                        <TextField
                            size="small"
                            placeholder="Search room code..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon sx={{ color: '#e11d48', fontSize: '1.2rem' }} />
                                    </InputAdornment>
                                ),
                            }}
                            sx={{ width: 230 }}
                        />
                    )}
                </div>

                {loading ? (
                    <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                        Loading session logs...
                    </Typography>
                ) : filteredMeetings.length > 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.6 }}>
                        {filteredMeetings.map((item, index) => (
                            <div key={index} className="historyCard">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1.3rem' }}>
                                    <div
                                        style={{
                                            width: 48,
                                            height: 48,
                                            borderRadius: 14,
                                            background: 'rgba(225, 29, 72, 0.12)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#e11d48',
                                            boxShadow: '0 4px 15px rgba(225, 29, 72, 0.15)',
                                        }}
                                    >
                                        <VideoCallIcon />
                                    </div>

                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                            <span className="meetingCodeBadge">{item.meetingCode}</span>
                                            <IconButton
                                                size="small"
                                                onClick={() => handleCopy(item.meetingCode)}
                                                sx={{ color: copiedCode === item.meetingCode ? '#e11d48' : 'text.secondary' }}
                                                title="Copy link"
                                            >
                                                {copiedCode === item.meetingCode ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                                            </IconButton>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem' }}>
                                            <CalendarMonthIcon sx={{ fontSize: '0.95rem', color: 'text.secondary' }} />
                                            <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                                                {formatDate(item.date)}
                                            </Typography>
                                        </div>
                                    </div>
                                </div>

                                <Button
                                    variant="contained"
                                    size="small"
                                    className="btnPrimaryGradient"
                                    onClick={() => navigate(`/${item.meetingCode}`)}
                                    sx={{ py: 0.8, px: 1.8 }}
                                >
                                    Rejoin Call
                                </Button>
                            </div>
                        ))}
                    </Box>
                ) : (
                    <div className="emptyState">
                        <EventBusyIcon sx={{ fontSize: 52, color: '#e11d48', opacity: 0.5 }} />
                        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
                            {searchTerm ? 'No matching meetings found' : 'No past meeting history yet'}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
                            {searchTerm
                                ? `No meetings match the query "${searchTerm}". Try searching another room code.`
                                : 'When you start or join video conferences, your activity records will appear right here.'}
                        </Typography>
                        <Button
                            variant="contained"
                            className="btnPrimaryGradient"
                            onClick={() => navigate("/home")}
                            sx={{ mt: 1.5 }}
                        >
                            Start a New Meeting
                        </Button>
                    </div>
                )}
            </main>

            <Snackbar
                open={toastOpen}
                autoHideDuration={2500}
                onClose={() => setToastOpen(false)}
            >
                <Alert severity="success" sx={{ borderRadius: '12px' }}>
                    Meeting link copied to clipboard!
                </Alert>
            </Snackbar>
        </div>
    );
}
