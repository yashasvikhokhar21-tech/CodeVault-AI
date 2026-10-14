import React, { useEffect, useRef, useState } from 'react';
import io from "socket.io-client";
import { 
    Badge, 
    IconButton, 
    TextField, 
    Button, 
    Typography, 
    Box, 
    Tooltip, 
    CssBaseline,
    Snackbar,
    Alert
} from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import CallEndIcon from '@mui/icons-material/CallEnd';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import ChatIcon from '@mui/icons-material/Chat';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';
import styles from "../styles/videoComponent.module.css";
import server from '../environment';
import ThemeToggle from '../components/ThemeToggle';
import { useThemeMode } from '../contexts/ThemeContext';

const server_url = server;

var connections = {};

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
};

export default function VideoMeetComponent() {
    const navigate = useNavigate();
    const { isDark } = useThemeMode();
    const routeParams = useParams();
    const roomCode = routeParams.url || window.location.pathname.replace('/', '') || "meeting-room";

    var socketRef = useRef();
    let socketIdRef = useRef();
    let localVideoref = useRef();

    let [videoAvailable, setVideoAvailable] = useState(true);
    let [audioAvailable, setAudioAvailable] = useState(true);
    let [video, setVideo] = useState([]);
    let [audio, setAudio] = useState();
    let [screen, setScreen] = useState();
    let [showModal, setModal] = useState(false);
    let [screenAvailable, setScreenAvailable] = useState();
    let [messages, setMessages] = useState([]);
    let [message, setMessage] = useState("");
    let [newMessages, setNewMessages] = useState(0);
    let [askForUsername, setAskForUsername] = useState(true);
    let [username, setUsername] = useState("");
    const videoRef = useRef([]);
    let [videos, setVideos] = useState([]);
    let [copied, setCopied] = useState(false);
    let [callSeconds, setCallSeconds] = useState(0);

    // Call duration timer
    useEffect(() => {
        let timer;
        if (!askForUsername) {
            timer = setInterval(() => {
                setCallSeconds(prev => prev + 1);
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [askForUsername]);

    const formatTime = (secs) => {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    useEffect(() => {
        getPermissions();
    }, []);

    let getDislayMedia = () => {
        if (screen) {
            if (navigator.mediaDevices.getDisplayMedia) {
                navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
                    .then(getDislayMediaSuccess)
                    .catch((e) => console.log(e));
            }
        }
    };

    const getPermissions = async () => {
        try {
            const videoPermission = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoPermission) {
                setVideoAvailable(true);
            } else {
                setVideoAvailable(false);
            }

            const audioPermission = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (audioPermission) {
                setAudioAvailable(true);
            } else {
                setAudioAvailable(false);
            }

            if (navigator.mediaDevices.getDisplayMedia) {
                setScreenAvailable(true);
            } else {
                setScreenAvailable(false);
            }

            if (videoAvailable || audioAvailable) {
                const userMediaStream = await navigator.mediaDevices.getUserMedia({ video: videoAvailable, audio: audioAvailable });
                if (userMediaStream) {
                    window.localStream = userMediaStream;
                    if (localVideoref.current) {
                        localVideoref.current.srcObject = userMediaStream;
                    }
                }
            }
        } catch (error) {
            console.log(error);
        }
    };

    useEffect(() => {
        if (video !== undefined && audio !== undefined) {
            getUserMedia();
        }
    }, [video, audio]);

    let getMedia = () => {
        setVideo(videoAvailable);
        setAudio(audioAvailable);
        connectToSocketServer();
    };

    let getUserMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach(track => track.stop());
        } catch (e) { console.log(e); }

        window.localStream = stream;
        if (localVideoref.current) {
            localVideoref.current.srcObject = stream;
        }

        for (let id in connections) {
            if (id === socketIdRef.current) continue;

            connections[id].addStream(window.localStream);

            connections[id].createOffer().then((description) => {
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }));
                    })
                    .catch(e => console.log(e));
            });
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setVideo(false);
            setAudio(false);

            try {
                let tracks = localVideoref.current.srcObject.getTracks();
                tracks.forEach(track => track.stop());
            } catch (e) { console.log(e); }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
            window.localStream = blackSilence();
            if (localVideoref.current) {
                localVideoref.current.srcObject = window.localStream;
            }

            for (let id in connections) {
                connections[id].addStream(window.localStream);

                connections[id].createOffer().then((description) => {
                    connections[id].setLocalDescription(description)
                        .then(() => {
                            socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }));
                        })
                        .catch(e => console.log(e));
                });
            }
        });
    };

    let getUserMedia = () => {
        if ((video && videoAvailable) || (audio && audioAvailable)) {
            navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
                .then(getUserMediaSuccess)
                .catch((e) => console.log(e));
        } else {
            try {
                let tracks = localVideoref.current.srcObject.getTracks();
                tracks.forEach(track => track.stop());
            } catch (e) { }
        }
    };

    let getDislayMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach(track => track.stop());
        } catch (e) { console.log(e); }

        window.localStream = stream;
        if (localVideoref.current) {
            localVideoref.current.srcObject = stream;
        }

        for (let id in connections) {
            if (id === socketIdRef.current) continue;

            connections[id].addStream(window.localStream);

            connections[id].createOffer().then((description) => {
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }));
                    })
                    .catch(e => console.log(e));
            });
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setScreen(false);

            try {
                let tracks = localVideoref.current.srcObject.getTracks();
                tracks.forEach(track => track.stop());
            } catch (e) { console.log(e); }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
            window.localStream = blackSilence();
            if (localVideoref.current) {
                localVideoref.current.srcObject = window.localStream;
            }

            getUserMedia();
        });
    };

    let gotMessageFromServer = (fromId, message) => {
        var signal = JSON.parse(message);

        if (fromId !== socketIdRef.current) {
            if (signal.sdp) {
                connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
                    if (signal.sdp.type === 'offer') {
                        connections[fromId].createAnswer().then((description) => {
                            connections[fromId].setLocalDescription(description).then(() => {
                                socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': connections[fromId].localDescription }));
                            }).catch(e => console.log(e));
                        }).catch(e => console.log(e));
                    }
                }).catch(e => console.log(e));
            }

            if (signal.ice) {
                connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.log(e));
            }
        }
    };

    let connectToSocketServer = () => {
        socketRef.current = io.connect(server_url, { secure: false });

        socketRef.current.on('signal', gotMessageFromServer);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-call', window.location.href);
            socketIdRef.current = socketRef.current.id;

            socketRef.current.on('chat-message', addMessage);

            socketRef.current.on('user-left', (id) => {
                setVideos((videos) => videos.filter((video) => video.socketId !== id));
            });

            socketRef.current.on('user-joined', (id, clients) => {
                clients.forEach((socketListId) => {
                    connections[socketListId] = new RTCPeerConnection(peerConfigConnections);
                    
                    connections[socketListId].onicecandidate = function (event) {
                        if (event.candidate != null) {
                            socketRef.current.emit('signal', socketListId, JSON.stringify({ 'ice': event.candidate }));
                        }
                    };

                    connections[socketListId].onaddstream = (event) => {
                        let videoExists = videoRef.current.find(v => v.socketId === socketListId);

                        if (videoExists) {
                            setVideos(vList => {
                                const updatedVideos = vList.map(v =>
                                    v.socketId === socketListId ? { ...v, stream: event.stream } : v
                                );
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        } else {
                            let newVideo = {
                                socketId: socketListId,
                                stream: event.stream,
                                autoplay: true,
                                playsinline: true
                            };

                            setVideos(vList => {
                                const updatedVideos = [...vList, newVideo];
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        }
                    };

                    if (window.localStream !== undefined && window.localStream !== null) {
                        connections[socketListId].addStream(window.localStream);
                    } else {
                        let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
                        window.localStream = blackSilence();
                        connections[socketListId].addStream(window.localStream);
                    }
                });

                if (id === socketIdRef.current) {
                    for (let id2 in connections) {
                        if (id2 === socketIdRef.current) continue;

                        try {
                            connections[id2].addStream(window.localStream);
                        } catch (e) { }

                        connections[id2].createOffer().then((description) => {
                            connections[id2].setLocalDescription(description)
                                .then(() => {
                                    socketRef.current.emit('signal', id2, JSON.stringify({ 'sdp': connections[id2].localDescription }));
                                })
                                .catch(e => console.log(e));
                        });
                    }
                }
            });
        });
    };

    let silence = () => {
        let ctx = new AudioContext();
        let oscillator = ctx.createOscillator();
        let dst = oscillator.connect(ctx.createMediaStreamDestination());
        oscillator.start();
        ctx.resume();
        return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false });
    };

    let black = ({ width = 640, height = 480 } = {}) => {
        let canvas = Object.assign(document.createElement("canvas"), { width, height });
        canvas.getContext('2d').fillRect(0, 0, width, height);
        let stream = canvas.captureStream();
        return Object.assign(stream.getVideoTracks()[0], { enabled: false });
    };

    let handleVideo = () => {
        setVideo(!video);
    };

    let handleAudio = () => {
        setAudio(!audio);
    };

    useEffect(() => {
        if (screen !== undefined) {
            getDislayMedia();
        }
    }, [screen]);

    let handleScreen = () => {
        setScreen(!screen);
    };

    let handleEndCall = () => {
        try {
            if (localVideoref.current && localVideoref.current.srcObject) {
                let tracks = localVideoref.current.srcObject.getTracks();
                tracks.forEach(track => track.stop());
            }
        } catch (e) { }
        navigate("/home");
    };

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prev) => prev + 1);
        }
    };

    let sendMessage = (e) => {
        if (e) e.preventDefault();
        if (!message.trim()) return;
        socketRef.current.emit('chat-message', message.trim(), username || "Guest");
        setMessage("");
    };

    let connect = (e) => {
        if (e) e.preventDefault();
        if (!username.trim()) {
            setUsername(`User_${Math.floor(1000 + Math.random() * 9000)}`);
        }
        setAskForUsername(false);
        getMedia();
    };

    const handleCopyRoomLink = () => {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    return (
        <div>
            <CssBaseline />
            {askForUsername === true ? (
                /* ================= Pre-Join Lobby Studio ================= */
                <div className={styles.lobbyContainer}>
                    <div className={styles.lobbyCard}>
                        <div className={styles.lobbyHeader}>
                            <div>
                                <h1 className={styles.lobbyTitle}>Ready to enter the room?</h1>
                                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                                    Set up your camera and microphone preview before connecting
                                </Typography>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <ThemeToggle />
                                <span className={styles.lobbyRoomPill}>Room: {roomCode}</span>
                                <IconButton size="small" onClick={handleCopyRoomLink} sx={{ color: copied ? '#e11d48' : 'text.secondary' }}>
                                    {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                                </IconButton>
                            </div>
                        </div>

                        <div className={styles.lobbyBody}>
                            {/* Live Video Preview Box */}
                            <div className={styles.lobbyVideoWrapper}>
                                <video ref={localVideoref} className={styles.lobbyVideo} autoPlay muted></video>
                                <div className={styles.lobbyControlsOverlay}>
                                    <Tooltip title={videoAvailable ? "Turn Off Camera" : "Turn On Camera"}>
                                        <IconButton 
                                            size="small" 
                                            onClick={() => setVideoAvailable(!videoAvailable)}
                                            sx={{ color: videoAvailable ? '#ffffff' : '#ef4444' }}
                                        >
                                            {videoAvailable ? <VideocamIcon fontSize="small" /> : <VideocamOffIcon fontSize="small" />}
                                        </IconButton>
                                    </Tooltip>

                                    <Tooltip title={audioAvailable ? "Mute Mic" : "Unmute Mic"}>
                                        <IconButton 
                                            size="small" 
                                            onClick={() => setAudioAvailable(!audioAvailable)}
                                            sx={{ color: audioAvailable ? '#ffffff' : '#ef4444' }}
                                        >
                                            {audioAvailable ? <MicIcon fontSize="small" /> : <MicOffIcon fontSize="small" />}
                                        </IconButton>
                                    </Tooltip>
                                </div>
                            </div>

                            {/* Lobby Join Form */}
                            <form onSubmit={connect} className={styles.lobbyForm}>
                                <TextField
                                    fullWidth
                                    label="Your Display Name"
                                    placeholder="e.g. Alex Johnson"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    autoFocus
                                />

                                <Button
                                    type="submit"
                                    variant="contained"
                                    size="large"
                                    className="btnPrimaryGradient"
                                    sx={{ py: 1.4, fontWeight: 800, fontSize: '1.02rem', borderRadius: '14px' }}
                                >
                                    Join Meeting Now
                                </Button>

                                <Button
                                    startIcon={<ArrowBackIcon />}
                                    variant="text"
                                    onClick={() => navigate("/home")}
                                    sx={{ color: 'text.secondary', textTransform: 'none', fontWeight: 600 }}
                                >
                                    Back to Dashboard
                                </Button>
                            </form>
                        </div>
                    </div>
                </div>
            ) : (
                /* ================= Active In-Call Conference ================= */
                <div className={styles.meetVideoContainer}>
                    {/* Top In-Call Header Bar */}
                    <div className={styles.topMeetingBar}>
                        <div className={styles.roomInfoBadge}>
                            <FiberManualRecordIcon sx={{ color: '#e11d48', fontSize: '0.9rem' }} />
                            <span>Room: {roomCode}</span>
                            <IconButton size="small" onClick={handleCopyRoomLink} sx={{ color: copied ? '#e11d48' : '#a1a1aa', p: 0.2 }}>
                                {copied ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
                            </IconButton>
                        </div>

                        <div className={styles.roomInfoBadge}>
                            <PeopleAltIcon sx={{ fontSize: '1.15rem', color: '#f43f5e' }} />
                            <span>{videos.length + 1} participant{videos.length > 0 ? 's' : ''}</span>
                            <span style={{ color: '#71717a', margin: '0 5px' }}>|</span>
                            <span>{formatTime(callSeconds)}</span>
                        </div>
                    </div>

                    {/* Remote Participants Video Grid */}
                    <div className={styles.conferenceView}>
                        {videos.length === 0 ? (
                            <Box sx={{ textAlign: 'center', color: '#71717a', gridColumn: '1 / -1' }}>
                                <Typography variant="h5" sx={{ fontWeight: 800, color: '#ffffff' }}>Waiting for others to join...</Typography>
                                <Typography variant="body2" sx={{ mt: 0.8, color: '#a1a1aa' }}>Share the room link with team members to collaborate in real-time</Typography>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    className="btnSecondaryOutline"
                                    onClick={handleCopyRoomLink}
                                    sx={{ mt: 2.5 }}
                                    startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
                                >
                                    {copied ? 'Link Copied!' : 'Copy Invitation Link'}
                                </Button>
                            </Box>
                        ) : (
                            videos.map((v) => (
                                <div key={v.socketId} className={styles.videoCard}>
                                    <video
                                        data-socket={v.socketId}
                                        ref={(ref) => {
                                            if (ref && v.stream) {
                                                ref.srcObject = v.stream;
                                            }
                                        }}
                                        autoPlay
                                        playsInline
                                    />
                                    <div className={styles.participantNameTag}>
                                        <FiberManualRecordIcon sx={{ color: '#e11d48', fontSize: '0.7rem' }} />
                                        <span>Participant</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Local User Floating PIP Video */}
                    <video 
                        className={styles.meetUserVideo} 
                        ref={localVideoref} 
                        autoPlay 
                        muted 
                        playsInline 
                        title={`${username || 'You'} (Local Video)`}
                    />

                    {/* Floating Bottom Control Capsule */}
                    <div className={styles.buttonContainers}>
                        <Tooltip title={video ? "Turn Off Camera" : "Turn On Camera"}>
                            <IconButton 
                                onClick={handleVideo} 
                                className={`${styles.controlBtn} ${!video ? styles.controlBtnMuted : ''}`}
                            >
                                {video ? <VideocamIcon /> : <VideocamOffIcon />}
                            </IconButton>
                        </Tooltip>

                        <Tooltip title={audio ? "Mute Microphone" : "Unmute Microphone"}>
                            <IconButton 
                                onClick={handleAudio} 
                                className={`${styles.controlBtn} ${!audio ? styles.controlBtnMuted : ''}`}
                            >
                                {audio ? <MicIcon /> : <MicOffIcon />}
                            </IconButton>
                        </Tooltip>

                        {screenAvailable && (
                            <Tooltip title={screen ? "Stop Screen Share" : "Share Screen"}>
                                <IconButton 
                                    onClick={handleScreen} 
                                    className={`${styles.controlBtn} ${screen ? styles.controlBtnActive : ''}`}
                                >
                                    {screen ? <StopScreenShareIcon /> : <ScreenShareIcon />}
                                </IconButton>
                            </Tooltip>
                        )}

                        <Tooltip title="In-Call Chat">
                            <IconButton 
                                onClick={() => {
                                    setModal(!showModal);
                                    setNewMessages(0);
                                }} 
                                className={`${styles.controlBtn} ${showModal ? styles.controlBtnActive : ''}`}
                            >
                                <Badge badgeContent={newMessages} color="primary">
                                    <ChatIcon />
                                </Badge>
                            </IconButton>
                        </Tooltip>

                        <Tooltip title="Leave Call">
                            <IconButton onClick={handleEndCall} className={`${styles.controlBtn} ${styles.endCallBtn}`}>
                                <CallEndIcon />
                            </IconButton>
                        </Tooltip>
                    </div>

                    {/* Floating In-Call Chat Drawer */}
                    {showModal && (
                        <div className={styles.chatRoom}>
                            <div className={styles.chatHeader}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <ChatIcon sx={{ color: '#e11d48', fontSize: '1.25rem' }} />
                                    <span className={styles.chatTitle}>In-Call Messages</span>
                                </div>
                                <IconButton size="small" onClick={() => setModal(false)} sx={{ color: '#a1a1aa' }}>
                                    <CloseIcon fontSize="small" />
                                </IconButton>
                            </div>

                            <div className={styles.chattingDisplay}>
                                {messages.length === 0 ? (
                                    <Typography variant="body2" sx={{ color: '#71717a', textAlign: 'center', mt: 4 }}>
                                        No messages yet. Send a message to start the conversation!
                                    </Typography>
                                ) : (
                                    messages.map((item, idx) => {
                                        const isMe = item.sender === (username || "Guest");
                                        return (
                                            <div 
                                                key={idx} 
                                                className={`${styles.chatBubble} ${isMe ? styles.chatBubbleSelf : styles.chatBubbleOther}`}
                                            >
                                                {!isMe && <div className={styles.chatSenderName}>{item.sender}</div>}
                                                <div>{item.data}</div>
                                                {item.time && (
                                                    <div style={{ fontSize: '0.65rem', opacity: 0.75, textAlign: 'right', marginTop: '3px' }}>
                                                        {item.time}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            <form onSubmit={sendMessage} className={styles.chattingArea}>
                                <TextField
                                    fullWidth
                                    size="small"
                                    placeholder="Type a message..."
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                />
                                <IconButton type="submit" className="btnPrimaryGradient" disabled={!message.trim()} size="small" sx={{ p: '9px' }}>
                                    <SendIcon fontSize="small" />
                                </IconButton>
                            </form>
                        </div>
                    )}
                </div>
            )}

            <Snackbar
                open={copied}
                autoHideDuration={2000}
                onClose={() => setCopied(false)}
            >
                <Alert severity="success" sx={{ borderRadius: '12px', bgcolor: isDark ? '#181724' : '#ffffff', color: '#e11d48', border: '1px solid rgba(225, 29, 72, 0.4)' }}>
                    Meeting link copied to clipboard!
                </Alert>
            </Snackbar>
        </div>
    );
}
