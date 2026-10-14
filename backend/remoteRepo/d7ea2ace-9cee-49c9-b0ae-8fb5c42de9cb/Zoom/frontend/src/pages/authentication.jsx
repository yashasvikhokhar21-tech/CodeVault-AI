import * as React from 'react';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import CssBaseline from '@mui/material/CssBaseline';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import BadgeIcon from '@mui/icons-material/Badge';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { AuthContext } from '../contexts/AuthContext';
import { Alert, Snackbar } from '@mui/material';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { useThemeMode } from '../contexts/ThemeContext';

export default function Authentication() {
    const navigate = useNavigate();
    const { isDark } = useThemeMode();
    const [username, setUsername] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [name, setName] = React.useState("");
    const [showPassword, setShowPassword] = React.useState(false);
    const [error, setError] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [formState, setFormState] = React.useState(0); // 0 = Login, 1 = Register
    const [open, setOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);

    const { handleRegister, handleLogin } = React.useContext(AuthContext);

    const handleAuth = async (e) => {
        if (e) e.preventDefault();
        setError("");
        setLoading(true);

        try {
            if (formState === 0) {
                if (!username || !password) {
                    setError("Please enter both username and password");
                    setLoading(false);
                    return;
                }
                await handleLogin(username, password);
            }
            if (formState === 1) {
                if (!name || !username || !password) {
                    setError("Please fill in all required fields");
                    setLoading(false);
                    return;
                }
                let result = await handleRegister(name, username, password);
                setUsername("");
                setName("");
                setPassword("");
                setMessage(result || "Account created successfully! Please sign in.");
                setOpen(true);
                setError("");
                setFormState(0);
            }
        } catch (err) {
            console.log(err);
            let errMsg = err?.response?.data?.message || err?.message || "Authentication failed. Please check your credentials.";
            setError(errMsg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'background.default',
                p: 2,
                position: 'relative',
                transition: 'background-color 0.25s ease',
            }}
        >
            <CssBaseline />

            {/* Back to Home / Logo Header */}
            <Box
                sx={{
                    position: 'absolute',
                    top: 24,
                    left: { xs: 20, sm: 32 },
                    right: { xs: 20, sm: 'auto' },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    zIndex: 10,
                }}
            >
                <Box
                    onClick={() => navigate('/')}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        cursor: 'pointer',
                    }}
                >
                    <Box
                        sx={{
                            width: 38,
                            height: 38,
                            borderRadius: '10px',
                            background: '#dc2626',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ffffff',
                            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.12)',
                        }}
                    >
                        <WhatshotIcon />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary' }}>
                        Apna <span style={{ color: isDark ? '#f87171' : '#dc2626' }}>Meet</span>
                    </Typography>
                </Box>
            </Box>

            {/* Top Right Theme Toggle */}
            <Box sx={{ position: 'absolute', top: 24, right: { xs: 20, sm: 32 }, zIndex: 10 }}>
                <ThemeToggle />
            </Box>

            {/* Auth Card */}
            <Box
                sx={{
                    maxWidth: 440,
                    width: '100%',
                    background: 'background.paper',
                    border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e2e8f0',
                    borderRadius: '20px',
                    boxShadow: isDark
                        ? '0 12px 36px rgba(0, 0, 0, 0.6)'
                        : '0 8px 24px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04)',
                    p: { xs: 3.5, sm: 4.5 },
                    mt: { xs: 8, sm: 0 },
                }}
            >
                {/* Header Avatar & Titles */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
                    <Avatar
                        sx={{
                            m: 1,
                            bgcolor: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(220, 38, 38, 0.08)',
                            color: isDark ? '#fca5a5' : '#dc2626',
                            border: isDark ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid rgba(220, 38, 38, 0.2)',
                            width: 50,
                            height: 50,
                        }}
                    >
                        <LockOutlinedIcon fontSize="medium" />
                    </Avatar>
                    <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mt: 1, color: 'text.primary', letterSpacing: '-0.02em' }}>
                        {formState === 0 ? 'Welcome Back' : 'Create Account'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                        {formState === 0
                            ? 'Sign in to access your meetings & history'
                            : 'Sign up to start hosting your own video conferences'}
                    </Typography>
                </Box>

                {/* Segmented Switcher */}
                <Box
                    sx={{
                        display: 'flex',
                        background: isDark ? 'rgba(255, 255, 255, 0.04)' : '#f1f5f9',
                        p: 0.5,
                        borderRadius: '12px',
                        border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
                        mb: 3,
                    }}
                >
                    <Button
                        fullWidth
                        onClick={() => {
                            setFormState(0);
                            setError("");
                        }}
                        sx={{
                            py: 1,
                            borderRadius: '9px',
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '0.92rem',
                            color: formState === 0 ? '#ffffff' : 'text.secondary',
                            background: formState === 0 ? '#dc2626' : 'transparent',
                            boxShadow: formState === 0 ? '0 2px 6px rgba(0, 0, 0, 0.1)' : 'none',
                            '&:hover': {
                                background: formState === 0 ? '#b91c1c' : 'transparent',
                            },
                        }}
                    >
                        Sign In
                    </Button>
                    <Button
                        fullWidth
                        onClick={() => {
                            setFormState(1);
                            setError("");
                        }}
                        sx={{
                            py: 1,
                            borderRadius: '9px',
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '0.92rem',
                            color: formState === 1 ? '#ffffff' : 'text.secondary',
                            background: formState === 1 ? '#dc2626' : 'transparent',
                            boxShadow: formState === 1 ? '0 2px 6px rgba(0, 0, 0, 0.1)' : 'none',
                            '&:hover': {
                                background: formState === 1 ? '#b91c1c' : 'transparent',
                            },
                        }}
                    >
                        Sign Up
                    </Button>
                </Box>

                {/* Error Alert */}
                {error && (
                    <Alert severity="error" sx={{ mb: 2.5, borderRadius: '10px' }} onClose={() => setError("")}>
                        {error}
                    </Alert>
                )}

                {/* Form Controls */}
                <Box component="form" onSubmit={handleAuth} noValidate>
                    {formState === 1 && (
                        <TextField
                            margin="dense"
                            required
                            fullWidth
                            id="name"
                            label="Full Name"
                            name="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <BadgeIcon sx={{ color: isDark ? '#f87171' : '#dc2626', fontSize: '1.2rem' }} />
                                    </InputAdornment>
                                ),
                            }}
                            sx={{ mb: 1.5 }}
                        />
                    )}

                    <TextField
                        margin="dense"
                        required
                        fullWidth
                        id="username"
                        label="Username"
                        name="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <PersonOutlineIcon sx={{ color: isDark ? '#f87171' : '#dc2626', fontSize: '1.2rem' }} />
                                </InputAdornment>
                            ),
                        }}
                        sx={{ mb: 1.5 }}
                    />

                    <TextField
                        margin="dense"
                        required
                        fullWidth
                        name="password"
                        label="Password"
                        type={showPassword ? 'text' : 'password'}
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <LockOpenIcon sx={{ color: isDark ? '#f87171' : '#dc2626', fontSize: '1.2rem' }} />
                                </InputAdornment>
                            ),
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={() => setShowPassword(!showPassword)}
                                        edge="end"
                                        size="small"
                                        sx={{ color: 'text.secondary' }}
                                    >
                                        {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                        sx={{ mb: 2 }}
                    />

                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        disabled={loading}
                        sx={{
                            py: 1.25,
                            mt: 0.5,
                            mb: 2,
                            fontWeight: 700,
                            fontSize: '0.98rem',
                            textTransform: 'none',
                            borderRadius: '10px',
                            color: '#ffffff',
                            background: '#dc2626',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                            '&:hover': {
                                background: '#b91c1c',
                            },
                        }}
                    >
                        {loading ? 'Processing...' : formState === 0 ? 'Sign In to Apna Meet' : 'Create Free Account'}
                    </Button>

                    {/* Guest Join shortcut */}
                    <Box sx={{ textAlign: 'center', mt: 1 }}>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            Want to test without an account?{' '}
                            <span
                                onClick={() => {
                                    const randomRoom = Math.random().toString(36).substring(2, 9);
                                    navigate(`/${randomRoom}`);
                                }}
                                style={{ color: isDark ? '#f87171' : '#dc2626', cursor: 'pointer', fontWeight: 700 }}
                            >
                                Join as Guest
                            </span>
                        </Typography>
                    </Box>
                </Box>
            </Box>

            <Snackbar
                open={open}
                autoHideDuration={4000}
                onClose={() => setOpen(false)}
                message={message}
            />
        </Box>
    );
}