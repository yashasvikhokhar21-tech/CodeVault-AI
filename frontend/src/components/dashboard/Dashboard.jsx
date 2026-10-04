import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PlusIcon, RepoIcon, SearchIcon, SparkleFillIcon } from "@primer/octicons-react";
import api from "../../api";
import Navbar from "../Navbar";
import { useAuth } from "../../useAuth";
import "./Dashboard.css";

const Dashboard = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [repositories, setRepositories] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("there");
  const [question, setQuestion] = useState("");
  const [assistant, setAssistant] = useState({ loading: false, error: "", messages: [] });
  const assistantPending = useRef(false);
  const userId = currentUser;
  const isValidUserId = (value) => typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value);

  useEffect(() => {
    const load = async () => {
      const [repoResult, userResult] = await Promise.allSettled([
        api.get(`/repo/user/${userId}`),
        api.get(`/userprofile/${userId}`),
      ]);

      if (repoResult.status === "fulfilled") {
        setRepositories(repoResult.value.data?.repositories || []);
      } else {
        if (repoResult.reason.response?.status !== 404) setError("We could not load your workspace.");
        setRepositories([]);
      }

      if (userResult.status === "fulfilled") {
        setUsername(userResult.value.data?.username || "there");
      } else {
        setError("We could not load your profile.");
      }

      setLoading(false);
    };
    if (userId && isValidUserId(userId)) load();
    else setLoading(false);
  }, [userId]);

  const askAssistant = async (event) => {
    event?.preventDefault();
    const prompt = question.trim();
    if (!prompt || assistantPending.current) return;
    assistantPending.current = true;
    const history = assistant.messages.slice(-10);
    setAssistant((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await api.post("/ai/chat", { prompt, history });
      setAssistant((current) => ({
        loading: false,
        error: "",
        messages: [...current.messages, { role: "user", content: prompt }, { role: "assistant", content: response.data.response }],
      }));
      setQuestion("");
    } catch (err) {
      const status = err.response?.status;
      const error = status === 401
        ? "Session expired. Please log in again."
        : status === 403
          ? "You are not authorized to use the AI Assistant."
          : err.response?.data?.error || "AI service is unavailable. Please try again later.";
      setAssistant((current) => ({ ...current, loading: false, error }));
    } finally {
      assistantPending.current = false;
    }
  };

  const filteredRepositories = repositories.filter((repo) =>
    `${repo.name} ${repo.description || ""}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <Navbar />
      <main className="dashboard-page">
        <section className="welcome-panel"><div><p className="eyebrow">WORKSPACE / OVERVIEW</p><h1>Good to see you, {username}.</h1><p>Keep your work moving with a clear view of every repository and release.</p></div><div className="welcome-actions"><Link className="button button-primary" to="/create"><PlusIcon size={16} /> New repository</Link><Link className="button button-secondary" to="/create?import=1">Import project</Link></div></section>
        <section className="quick-actions"><Link to="/create" className="action-tile"><PlusIcon size={18} /><span><strong>Create Repository</strong><small>Start a new project</small></span></Link><Link to="/create?import=1" className="action-tile"><RepoIcon size={18} /><span><strong>Import Project</strong><small>Bring an existing app into CodeVault</small></span></Link><Link to="/" className="action-tile"><RepoIcon size={18} /><span><strong>Repositories</strong><small>{repositories.length} in your workspace</small></span></Link><a href="#ai-assistant" className="action-tile"><SparkleFillIcon size={18} /><span><strong>AI Assistant</strong><small>Ask a developer question</small></span></a></section>
        <section id="ai-assistant" className="ai-panel dashboard-ai">
          <div className="ai-panel-heading"><div><p className="eyebrow">CODEVAULT AI</p><h2>AI Assistant</h2></div><SparkleFillIcon size={22} /></div>
          <form className="assistant-form" onSubmit={askAssistant}>
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about an error, repository, or change..." />
            <button className="button button-primary" disabled={assistant.loading || !question.trim()}>{assistant.loading ? "Thinking..." : "Ask assistant"}</button>
          </form>
          {assistant.error && <div className="ai-output error-state" role="alert">{assistant.error}<button type="button" className="button button-secondary" onClick={askAssistant} disabled={assistant.loading}>Retry</button></div>}
          {assistant.messages.length > 0 && <div className="ai-output">
            <div className="assistant-transcript" aria-live="polite">
              {assistant.messages.map((message, index) => <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}><strong>{message.role === "user" ? "You" : "CodeVault AI"}</strong><p>{message.content}</p></div>)}
            </div>
            <button type="button" className="button button-secondary" onClick={() => setAssistant({ loading: false, error: "", messages: [] })}>Clear conversation</button>
          </div>}
        </section>
        <section className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">YOUR WORK</p><h2>Repositories</h2></div><div className="search-box"><SearchIcon size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories" /></div></div>{error && <div className="state-card error-state">{error}</div>}{loading ? <div className="state-card">Loading repositories...</div> : filteredRepositories.length === 0 ? <div className="state-card empty-state"><RepoIcon size={28} /><h3>{query ? "No matches found" : "Your workspace is ready"}</h3><p>{query ? "Try a different name or description." : "Create a repository to give your next idea a home."}</p>{!query && <div className="empty-state-actions"><Link className="button button-primary" to="/create">Create your first repository</Link><Link className="button button-secondary" to="/create?import=1">Import existing project</Link></div>}</div> : <div className="repository-grid">{filteredRepositories.map((repo) => <button className="repository-card" key={repo._id} onClick={() => navigate(`/repo/${repo._id}`)}><div className="repo-card-icon"><RepoIcon size={18} /></div><div><div className="repo-card-title"><h3>{repo.name}</h3><span className={`badge ${repo.visibility ? "badge-public" : "badge-private"}`}>{repo.visibility ? "Public" : "Private"}</span></div><p>{repo.description || "No description yet."}</p><small>Updated {new Date(repo.updatedAt || repo.createdAt).toLocaleDateString()}</small></div></button>)}</div>}</section>
      </main>
    </>
  );
};

export default Dashboard;
