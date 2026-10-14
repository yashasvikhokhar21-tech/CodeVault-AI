import { useState } from "react";
import api from "../../api";
import { Link } from "react-router-dom";
import { useAuth } from "../../useAuth";
import { AlertIcon } from "@primer/octicons-react";
import "./auth.css";

const Signup = () => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { setCurrentUser } = useAuth();

  const handleSignup = async (e) => {
    e.preventDefault();

    if (!username.trim() || !email.trim() || !password.trim()) {
      setError("Username, email, and password are required.");
      return;
    }

    try {
      setLoading(true);

      const res = await api.post("/signup", {
        email,
        username,
        password,
      });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("userId", String(res.data.userId));

      setCurrentUser(String(res.data.userId));

      window.location.href = "/";
    } catch (err) {
      setError(err?.response?.data?.message || (!err?.response ? "Network error. Unable to connect to server." : "Could not create your account."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-brand">CV<span>/</span>AI</div>
        <p className="auth-kicker">CODEVAULT AI</p>
        <h1 className="auth-title">Build your next release.</h1>
        <p className="auth-subtitle">A focused home for your repositories and ideas.</p>

        <form className="auth-card" onSubmit={handleSignup}>
          <label>Username</label>
          <input
            className="auth-input"
            type="text"
            placeholder="Enter username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (error) setError("");
            }}
          />

          <label>Email address</label>
          <input
            className="auth-input"
            type="email"
            placeholder="Enter email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError("");
            }}
          />

          <label>Password</label>
          <input
            className="auth-input"
            type="password"
            placeholder="Create password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
          />

          {error && (
            <div className="auth-message error" role="alert">
              <AlertIcon size={16} className="error-icon" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="auth-btn"
            disabled={loading}
          >
            {loading ? "Creating Account..." : "Create Account"}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account?{" "}
          <Link to="/auth">Sign In</Link>
        </div>
      </div>
    </div>
  );
};

export default Signup;


