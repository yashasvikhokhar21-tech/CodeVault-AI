import { useState } from "react";
import api from "../../api";
import { useAuth } from "../../useAuth";
import "./auth.css";

import { Link } from "react-router-dom";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { setCurrentUser } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    try {
      setLoading(true);

      const res = await api.post("/login", {
        email,
        password,
      });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("userId", String(res.data.userId));

      setCurrentUser(String(res.data.userId));

      window.location.href = "/";
    } catch (err) {
      setError(err?.response?.data?.message || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-brand">CV<span>/</span>AI</div>
        <p className="auth-kicker">CODEVAULT AI</p>
        <h1 className="auth-title">Your code, under control.</h1>
        <p className="auth-subtitle">Version control, enhanced by intelligence.</p>

        <form className="auth-card" onSubmit={handleLogin}>
          <label>Email address</label>
          <input
            autoComplete="off"
            name="Email"
            id="Email"
            className="auth-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label>Password</label>
          <input
            autoComplete="off"
            name="Password"
            id="Password"
            className="auth-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <div className="auth-message error">{error}</div>}

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="auth-footer">
          New to CodeVault? <Link to="/signup">Create an account</Link>
        </div>
      </div>
    </div>
  );
};

export default Login;