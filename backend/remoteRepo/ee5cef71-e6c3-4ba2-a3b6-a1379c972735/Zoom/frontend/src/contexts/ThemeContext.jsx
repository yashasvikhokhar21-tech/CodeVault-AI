import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { createTheme, ThemeProvider as MuiThemeProvider } from '@mui/material/styles';

const ThemeContext = createContext();

export const useThemeMode = () => useContext(ThemeContext);

export const CustomThemeProvider = ({ children }) => {
    // Default to 'light'
    const [mode, setMode] = useState(() => {
        const saved = localStorage.getItem('app_theme');
        return saved ? saved : 'light';
    });

    useEffect(() => {
        localStorage.setItem('app_theme', mode);
        document.documentElement.setAttribute('data-theme', mode);
        document.body.className = mode === 'dark' ? 'dark-theme' : 'light-theme';
    }, [mode]);

    const toggleTheme = () => {
        setMode(prev => (prev === 'light' ? 'dark' : 'light'));
    };

    const muiTheme = useMemo(() => {
        const isDark = mode === 'dark';
        return createTheme({
            palette: {
                mode: isDark ? 'dark' : 'light',
                primary: {
                    main: '#dc2626', // Attractive Bold Red
                    light: '#ef4444',
                    dark: '#b91c1c',
                    contrastText: '#ffffff',
                },
                secondary: {
                    main: '#991b1b',
                },
                background: {
                    default: isDark ? '#0d0f12' : '#f8fafc',
                    paper: isDark ? '#16191f' : '#ffffff',
                },
                text: {
                    primary: isDark ? '#f1f5f9' : '#0f172a',
                    secondary: isDark ? '#94a3b8' : '#64748b',
                },
            },
            typography: {
                fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
            },
            shape: {
                borderRadius: 12,
            },
            components: {
                MuiButton: {
                    styleOverrides: {
                        root: {
                            textTransform: 'none',
                            fontWeight: 700,
                            borderRadius: 10,
                        },
                    },
                },
                MuiTextField: {
                    styleOverrides: {
                        root: {
                            '& .MuiOutlinedInput-root': {
                                borderRadius: 10,
                            },
                        },
                    },
                },
            },
        });
    }, [mode]);

    return (
        <ThemeContext.Provider value={{ mode, toggleTheme, isDark: mode === 'dark' }}>
            <MuiThemeProvider theme={muiTheme}>
                {children}
            </MuiThemeProvider>
        </ThemeContext.Provider>
    );
};
