import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon, PencilIcon, RepoIcon, XIcon } from "@primer/octicons-react";
import api from "../../api";
import Navbar from "../Navbar";
import { useAuth } from "../../useAuth";
import "./profile.css";

const emptyProfile = { username: "", email: "", fullName: "", bio: "", location: "", company: "" };

const Profile = () => {
  const [profile, setProfile] = useState(emptyProfile);
  const [draft, setDraft] = useState(emptyProfile);
  const [repositories, setRepositories] = useState([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const { logout, currentUser } = useAuth();
  const userId = currentUser;

  useEffect(() => {
    const load = async () => {
      try {
        const [userResponse, repoResponse] = await Promise.all([api.get(`/userprofile/${userId}`), api.get(`/repo/user/${userId}`)]);
        const user = { ...emptyProfile, ...userResponse.data, fullName: userResponse.data.fullName || userResponse.data.username };
        setProfile(user); setDraft(user); setRepositories(repoResponse.data?.repositories || []);
      } catch (err) {
        setMessage({ type: "error", text: err.response?.data?.message || "Could not load your profile." });
      } finally { setLoading(false); }
    };
    if (userId) load();
  }, [userId]);

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!draft.email.trim() || !/^\S+@\S+\.\S+$/.test(draft.email)) return setMessage({ type: "error", text: "Enter a valid email address." });
    try {
      setSaving(true); setMessage({ type: "", text: "" });
      const response = await api.put(`/updateProfile/${userId}`, { email: draft.email.trim(), fullName: draft.fullName.trim(), bio: draft.bio.trim(), location: draft.location.trim(), company: draft.company.trim() });
      const updated = { ...draft, ...response.data }; setProfile(updated); setDraft(updated); setEditing(false); setMessage({ type: "success", text: "Profile updated." });
    } catch (err) {
      const status = err.response?.status;
      const text = status === 401
        ? "Session expired. Please log in again."
        : status === 403
          ? "You are not authorized to update this profile."
          : err.response?.data?.message || "Could not save your profile.";
      setMessage({ type: "error", text });
    } finally { setSaving(false); }
  };

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const initials = (profile.fullName || profile.username || "CV").slice(0, 2).toUpperCase();

  return <><Navbar /><main className="profile-page"><section className="profile-hero"><div className="avatar">{initials}</div><div><p className="eyebrow">YOUR IDENTITY</p><h1>{loading ? "Loading profile..." : profile.fullName}</h1><p className="profile-username">@{profile.username}</p><p className="profile-bio">{profile.bio || "Add a short bio to tell your team what you are building."}</p></div><div className="profile-actions">{!editing ? <button className="button button-secondary" onClick={() => { setDraft(profile); setEditing(true); }}><PencilIcon size={15} /> Edit profile</button> : <button className="icon-button" onClick={() => setEditing(false)} title="Cancel"><XIcon size={17} /></button>}</div></section>{message.text && <div className={`profile-message ${message.type}`}>{message.type === "success" && <CheckIcon size={15} />}{message.text}</div>}{editing && <form className="profile-edit-card" onSubmit={saveProfile}><div className="profile-form-grid">{[["fullName", "Full name"], ["email", "Email"], ["location", "Location"], ["company", "Company"]].map(([field, label]) => <label key={field}>{label}<input value={draft[field]} onChange={(e) => updateDraft(field, e.target.value)} /></label>)}</div><label>Bio<textarea rows="4" value={draft.bio} onChange={(e) => updateDraft("bio", e.target.value)} /></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button></div></form>}<section className="profile-content"><div className="profile-card"><div className="section-heading"><div><p className="eyebrow">WORKSPACE</p><h2>Repositories</h2></div><Link className="button button-secondary" to="/create"><RepoIcon size={15} /> New</Link></div>{repositories.length ? <div className="profile-repo-list">{repositories.map((repo) => <Link className="profile-repo-item" to={`/repo/${repo._id}`} key={repo._id}><span className="repo-dot" /><span><strong>{repo.name}</strong><small>{repo.description || "No description yet."}</small></span><em>{repo.visibility ? "Public" : "Private"}</em></Link>)}</div> : <div className="state-card empty-state"><RepoIcon size={24} /><p>No repositories yet.</p><Link to="/create" className="button button-secondary">Create a repository</Link></div>}</div><aside className="profile-card account-card"><p className="eyebrow">ACCOUNT</p><h2>{profile.email}</h2><p>Member profile and workspace access.</p><button className="button button-danger" onClick={() => { logout(); window.location.href = "/auth"; }}>Sign out</button></aside></section></main></>;
};

export default Profile;