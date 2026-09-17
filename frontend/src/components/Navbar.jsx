
import { Link, useNavigate } from "react-router-dom";
import "./navbar.css";
import { CodeIcon, PlusIcon, PersonIcon, SignOutIcon } from "@primer/octicons-react";
import { useAuth } from "../useAuth";

const Navbar = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/auth");
  };

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <Link to="/" className="logo-link">
          <span className="brand-mark"><CodeIcon size={18} /></span>
          <div><strong className="nav-title">CODEVAULT AI</strong><small>Version control, enhanced by intelligence.</small></div>
        </Link>
      </div>

      <div className="navbar-right">
        <Link to="/create" className="nav-link nav-primary">
          <PlusIcon size={16} /> Create repository
        </Link>

        <Link to="/profile" className="nav-link nav-profile">
          <PersonIcon size={16} />
          Profile
        </Link>
        <button type="button" className="nav-link nav-logout" onClick={handleLogout} title="Sign out">
          <SignOutIcon size={16} />
        </button>
      </div>
    </nav>
  );
};

export default Navbar;