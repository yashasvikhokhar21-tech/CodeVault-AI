import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import { useThemeMode } from '../contexts/ThemeContext';

export default function ThemeToggle({ sx = {} }) {
    const { toggleTheme, isDark } = useThemeMode();

    return (
        <Tooltip title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}>
            <IconButton
                onClick={toggleTheme}
                sx={{
                    width: 38,
                    height: 38,
                    borderRadius: '10px',
                    border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid #e2e8f0',
                    background: isDark ? 'rgba(255, 255, 255, 0.04)' : '#ffffff',
                    color: isDark ? '#fbbf24' : '#dc2626',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                        background: isDark ? 'rgba(255, 255, 255, 0.08)' : '#f1f5f9',
                        borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : '#cbd5e1',
                    },
                    ...sx
                }}
            >
                {isDark ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
            </IconButton>
        </Tooltip>
    );
}
