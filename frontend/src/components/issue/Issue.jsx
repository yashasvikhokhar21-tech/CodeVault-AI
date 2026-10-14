import { useEffect, useState } from "react";
import api from "../../api";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../Navbar";
import "./issue.css";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  IssueOpenedIcon,
  PlusIcon,
  TrashIcon,
  SparkleFillIcon,
} from "@primer/octicons-react";

const Issue = () => {
  const { repoId, issueId } = useParams();
  const navigate = useNavigate();

  const [repository, setRepository] = useState(null);
  const [issues, setIssues] = useState([]);
  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "open",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState({ issueId: "", loading: false, error: "", result: null });

  const loadIssues = async () => {
    if (!repoId) return;

    try {
      const response = await api.get(`/repo/${repoId}/issues`);
      setIssues(response.data || []);
    } catch (err) {
      console.error("Failed to load issues:", err);
      setIssues([]);
    }
  };

  useEffect(() => {
    if (repoId) {
      Promise.all([api.get(`/repo/${repoId}`), api.get(`/repo/${repoId}/issues`)]).then(([repositoryResponse, issuesResponse]) => {
        setRepository(repositoryResponse.data);
        setIssues(issuesResponse.data || []);
      }).catch(() => {
        setRepository(null);
        setIssues([]);
      });
    }

    if (issueId) {
      const loadSingleIssue = async () => {
        try {
          const response = await api.get(`/issue/${issueId}`);
          setForm({
            title: response.data?.title || "",
            description: response.data?.description || "",
            status: response.data?.status || "open",
          });
        } catch (err) {
          console.error("Failed to load issue:", err);
        }
      };

      loadSingleIssue();
    }
  }, [repoId, issueId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!repoId) {
      setError("Repository is required.");
      return;
    }

    if (!form.title.trim()) {
      setError("Issue title is required.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      await api.post(`/repo/${repoId}/issues`, {
        title: form.title.trim(),
        description: form.description.trim(),
        status: form.status,
      });

      setForm({ title: "", description: "", status: "open" });
      await loadIssues();
    } catch (err) {
      console.error("Failed to create issue:", err);
      setError(err?.response?.data?.error || (!err?.response ? "Network error. Unable to connect to server." : "Failed to create issue."));
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (issueIdValue, nextStatus) => {
    try {
      await api.put(`/issue/${issueIdValue}`, {
        status: nextStatus,
      });

      await loadIssues();
    } catch (err) {
      console.error("Failed to update issue status:", err);
    }
  };

  const handleDelete = async (issueIdValue) => {
    try {
      await api.delete(`/issue/${issueIdValue}`);
      await loadIssues();
    } catch (err) {
      console.error("Failed to delete issue:", err);
    }
  };

  const analyzeIssue = async (issueIdValue) => {
    setAnalysis({ issueId: issueIdValue, loading: true, error: "", result: null });
    try {
      const response = await api.post(`/ai/issues/${issueIdValue}/analyze`);
      setAnalysis({ issueId: issueIdValue, loading: false, error: "", result: response.data });
    } catch (err) {
      setAnalysis({ issueId: issueIdValue, loading: false, error: err.response?.data?.error || "AI service is unavailable. Please try again later.", result: null });
    }
  };

  return (
    <>
      <Navbar />

      <section className="issue-page">
        <div className="issue-shell">
          <div className="issue-header-row">
            <button
              type="button"
              className="back-btn"
              onClick={() => navigate(`/repo/${repoId || ""}`)}
            >
              <ArrowLeftIcon size={16} />
              Back to repository
            </button>

            <div className="issue-heading-wrap">
              <p className="issue-kicker">Repository</p>
              <h1>{repository?.name || "Issues"}</h1>
            </div>
          </div>

          <div className="issue-layout">
            <form className="issue-form-card" onSubmit={handleSubmit}>
              <div className="issue-form-header">
                <IssueOpenedIcon size={18} />
                <h2>New issue</h2>
              </div>

              <label className="issue-field">
                <span>Title</span>
                <input
                  type="text"
                  name="title"
                  placeholder="Add a clear and descriptive title"
                  value={form.title}
                  onChange={handleChange}
                />
              </label>

              <label className="issue-field">
                <span>Description</span>
                <textarea
                  name="description"
                  rows="5"
                  placeholder="Write a short description of the issue"
                  value={form.description}
                  onChange={handleChange}
                />
              </label>

              <label className="issue-field">
                <span>Status</span>
                <select name="status" value={form.status} onChange={handleChange}>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </label>

              {error && (
                <div className="issue-message error" role="alert">
                  <AlertIcon size={16} className="error-icon" />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="primary-btn" disabled={loading}>
                <PlusIcon size={16} />
                {loading ? "Creating..." : "Create issue"}
              </button>
            </form>

            <div className="issue-list-card">
              <div className="issue-list-header">
                <h2>Issues</h2>
                <span>{issues.length}</span>
              </div>

              {issues.length === 0 ? (
                <div className="issue-empty-state">
                  No issues yet for this repository.
                </div>
              ) : (
                issues.map((item) => (
                  <div key={item._id} className="issue-item">
                    <div className="issue-item-main">
                      <div className="issue-item-title-row">
                        <IssueOpenedIcon size={16} />
                        <h3>{item.title}</h3>
                      </div>

                      <p>{item.description || "No description provided."}</p>
                    </div>

                    <div className="issue-item-actions">
                      <span className={`issue-badge ${item.status === "closed" ? "closed" : "open"}`}>
                        {item.status}
                      </span>

                      <button
                        type="button"
                        className="small-btn"
                        onClick={() =>
                          handleStatusChange(
                            item._id,
                            item.status === "open" ? "closed" : "open"
                          )
                        }
                      >
                        <CheckIcon size={14} />
                        {item.status === "open" ? "Close" : "Reopen"}
                      </button>

                      <button type="button" className="small-btn" onClick={() => analyzeIssue(item._id)} disabled={analysis.loading}>
                        <SparkleFillIcon size={14} />
                        {analysis.loading && analysis.issueId === item._id ? "Analyzing..." : "Analyze"}
                      </button>

                      <button
                        type="button"
                        className="small-btn danger"
                        onClick={() => handleDelete(item._id)}
                      >
                        <TrashIcon size={14} />
                        Delete
                      </button>
                    </div>
                    {analysis.issueId === item._id && (analysis.error || analysis.result) && <div className="issue-ai-output">{analysis.error ? <><p>{analysis.error}</p><button type="button" className="small-btn" onClick={() => analyzeIssue(item._id)}>Retry</button></> : <><strong>AI analysis</strong><p><b>Summary:</b> {analysis.result.summary}</p><p><b>Likely cause:</b> {analysis.result.likelyCause}</p><p><b>Suggested approach:</b> {analysis.result.suggestedApproach}</p><p><b>Suggested fix:</b> {analysis.result.suggestedFix}</p><p><b>Testing:</b> {analysis.result.testingSuggestions}</p><button type="button" className="small-btn" onClick={() => setAnalysis({ issueId: "", loading: false, error: "", result: null })}>Clear</button></>}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Issue;
