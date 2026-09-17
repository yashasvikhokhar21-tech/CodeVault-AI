import { useState } from "react";
import { AuthContext } from "./authContextValue";

export const AuthProvider = ({children})=>{
    const [currentUser, setCurrentUser] = useState(() => localStorage.getItem("userId"));

    const logout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("userId");
        setCurrentUser(null);
    };

    const value = { currentUser, setCurrentUser, logout };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}