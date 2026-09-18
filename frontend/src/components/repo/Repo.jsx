import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon, GlobeIcon, LockIcon, PlusIcon, RepoIcon, SparkleFillIcon } from "@primer/octicons-react";
import api from "../../api";
import Navbar from "../Navbar";
import "./repo.css";

const initialForm = { name: "", description: "", visibility: true };
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_TOTAL_BYTES = 250 * 1024 * 1024;
const IMPORT_EXCLUDED_DIRECTORIES = new Map([
  ["node_modules", "dependency folder"], [".git", "Git metadata"], ["dist", "generated build output"],
  ["build", "generated build output"], ["coverage", "test coverage output"], [".next", "Next.js generated output"],
  [".vite", "Vite generated output"], [".cache", "cache folder"], [".parcel-cache", "Parcel cache"],
  [".turbo", "Turbo cache"], [".vercel", "Vercel generated output"], ["__pycache__", "Python cache"],
  [".pytest_cache", "pytest cache"], [".mypy_cache", "mypy cache"], ["target", "generated build output"],
]);

const getImportExclusion = (relativePath) => {
  const parts = relativePath.split("/");
  const excludedDirectory = parts.find((part) => IMPORT_EXCLUDED_DIRECTORIES.has(part.toLowerCase()));
  if (excludedDirectory) return IMPORT_EXCLUDED_DIRECTORIES.get(excludedDirectory.toLowerCase());
  const fileName = parts[parts.length - 1].toLowerCase();
  if (fileName === ".env" || fileName.startsWith(".env.")) return "environment secret file";
  return "";
};

function buildFileTree(files) {
  const root = { type: "folder", name: "", path: "", children: new Map() };
  files.forEach((file) => {
    let current = root;
    const parts = file.path.split("/");
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      if (!current.children.has(part)) current.children.set(part, isFile ? { type: "file", name: part, path, file } : { type: "folder", name: part, path, children: new Map() });
      current = current.children.get(part);
    });
  });
  return root;
}

function sortTreeChildren(children) {
  return [...children.values()].sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "folder" ? -1 : 1);
}

function RepositoryFileExplorer({ files, history }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const [selectedPath, setSelectedPath] = useState("");
  const tree = buildFileTree(files);
  const matchingFiles = files.filter((file) => file.path.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedFile = files.find((file) => file.path === selectedPath);
  const toggleFolder = (path) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const renderNode = (node, depth = 0) => node.type === "file"
    ? <button type="button" className={`repo-tree-row ${selectedPath === node.path ? "active" : ""}`} style={{ paddingLeft: `${16 + depth * 18}px` }} onClick={() => setSelectedPath(node.path)}>📄 <span>{node.name}</span></button>
    : <div key={node.path || "root"}><button type="button" className="repo-tree-row" style={{ paddingLeft: `${16 + depth * 18}px` }} onClick={() => toggleFolder(node.path)}>📁 <span>{node.name}</span></button>{(expanded.has(node.path) || search) && sortTreeChildren(node.children).map((child) => renderNode(child, depth + 1))}</div>;
  return <div className="repo-explorer"><div className="repo-explorer-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files and folders" /></div>{!files.length ? <p className="repo-explorer-empty">This repository is empty.</p> : <div className="repo-explorer-layout"><nav className="repo-tree" aria-label="Repository files">{search && !matchingFiles.length ? <p className="repo-explorer-empty">No matching files.</p> : sortTreeChildren(tree.children).map((node) => renderNode(node))}</nav><div className="repo-file-viewer">{selectedFile ? <><div className="repo-breadcrumb"><span>Repository</span>{selectedFile.path.split("/").map((part, index, parts) => { const folderPath = parts.slice(0, index + 1).join("/"); return <span key={folderPath}>/ <button type="button" onClick={() => { if (index < parts.length - 1) setExpanded((current) => new Set([...current, folderPath])); if (index === parts.length - 1) setSelectedPath(selectedFile.path); }}>{part}</button></span>; })}</div><h3>{selectedFile.path.split("/").pop()}</h3>{selectedFile.content.includes("\0") ? <p className="repo-explorer-empty">This file cannot be displayed as text.</p> : <pre>{selectedFile.content}</pre>}</> : <p className="repo-explorer-empty">Select a file to view its contents.</p>}</div></div>}{history.length > 0 && <div className="repo-history"><h3>History</h3>{history.map((commit) => <p key={commit.id}>{commit.message} <small>{new Date(commit.date).toLocaleString()}</small></p>)}</div>}</div>;
}

function BranchPanel({ repoId, currentBranch, onBranchChange }) {
  const [branches, setBranches] = useState([]);
  const [newBranch, setNewBranch] = useState("");
  const [error, setError] = useState("");
  const loadBranches = () => api.get(`/repo/${repoId}/branches`).then((response) => setBranches(response.data || [])).catch((err) => setError(err.response?.data?.error || "Could not load branches."));
  useEffect(loadBranches, [repoId]);
  const create = async (event) => {
    event.preventDefault();
    try { await api.post(`/repo/${repoId}/branches/${encodeURIComponent(newBranch.trim())}`, { from: currentBranch }); setNewBranch(""); setError(""); await loadBranches(); } catch (err) { setError(err.response?.data?.error || "Could not create branch."); }
  };
  const remove = async (name) => {
    if (!window.confirm(`Delete branch ${name}?`)) return;
    try { await api.delete(`/repo/${repoId}/branches/${encodeURIComponent(name)}`, { data: { currentBranch } }); setError(""); await loadBranches(); } catch (err) { setError(err.response?.data?.error || "Could not delete branch."); }
  };
  return <section className="branch-panel"><div className="section-heading"><div><p className="eyebrow">BRANCHES</p><h2>Branches</h2></div><strong>Current branch: {currentBranch}</strong></div>{error && <div className="repo-message error">{error}</div>}<div className="branch-list">{branches.map((branch) => <div className={`branch-row ${branch.name === currentBranch ? "active" : ""}`} key={branch.name}><button type="button" onClick={() => onBranchChange(branch.name)}>{branch.name}</button><small>{branch.commits} commits</small>{branch.name !== "main" && <button type="button" className="branch-delete" onClick={() => remove(branch.name)}>Delete</button>}</div>)}</div><form className="branch-create" onSubmit={create}><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="feature-login" /><button className="button button-secondary" disabled={!newBranch.trim()}>Create branch</button></form></section>;
}

function CommitHistoryPanel({ repoId, branch }) {
  const [commits, setCommits] = useState([]);
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/repo/${repoId}/commits`, { params: { branch } }).then((response) => setCommits(response.data || [])).catch((err) => setError(err.response?.data?.error || "Could not load commit history."));
  }, [repoId, branch]);

  const selectCommit = async (commitId) => {
    setSelectedFile(null); setDiff(null); setError("");
    try { const response = await api.get(`/repo/${repoId}/commits/${commitId}`, { params: { branch } }); setSelectedCommit(response.data); } catch (err) { setError(err.response?.data?.error || "Could not load commit details."); }
  };

  const selectFile = async (file) => {
    setSelectedFile(file); setDiff(null); setError("");
    try { const response = await api.get(`/repo/${repoId}/commits/${selectedCommit.id}/diff`, { params: { path: file.path, branch } }); setDiff(response.data); } catch (err) { setError(err.response?.data?.error || "Could not load file diff."); }
  };

  return <section className="commit-history-panel"><div className="section-heading"><div><p className="eyebrow">HISTORY</p><h2>Commits</h2></div></div>{error && <div className="repo-message error">{error}</div>}{!commits.length ? <p className="repo-explorer-empty">No commits in this repository.</p> : <div className="commit-history-list">{commits.map((commit) => <button type="button" className={`commit-history-item ${selectedCommit?.id === commit.id ? "active" : ""}`} key={commit.id} onClick={() => selectCommit(commit.id)}><strong>{commit.id.slice(0, 7)}</strong><span>{commit.message}</span><small>{commit.author || "Author unavailable"} · {commit.changedFiles} changed files · {commit.date ? new Date(commit.date).toLocaleString() : "Timestamp unavailable"}</small></button>)}</div>}{selectedCommit && <div className="commit-detail"><button type="button" className="button button-secondary" onClick={() => { setSelectedCommit(null); setSelectedFile(null); setDiff(null); }}>Back to history</button><h3>{selectedCommit.message}</h3><p className="commit-full-id">{selectedCommit.id}</p><p>{selectedCommit.author || "Author unavailable"} · {selectedCommit.date ? new Date(selectedCommit.date).toLocaleString() : "Timestamp unavailable"}</p><div className="changed-files">{selectedCommit.files.length ? selectedCommit.files.map((file) => <button type="button" className={`changed-file ${selectedFile?.path === file.path ? "active" : ""}`} key={file.path} onClick={() => selectFile(file)}><span className={`file-status ${file.status.toLowerCase()}`}>{file.status}</span>{file.path}</button>) : <p>No changed files recorded.</p>}</div>{diff && <div className="diff-viewer"><h4>{diff.path}</h4>{diff.binary ? <p>Binary file cannot be displayed as text.</p> : diff.lines.map((line, index) => <div className={`diff-line ${line.type}`} key={`${line.type}-${index}`}><span>{line.type === "added" ? "+" : line.type === "deleted" ? "-" : " "}</span>{line.text}</div>)}</div>}</div>}</section>;
}

function PullRequestPanel({ repoId, currentBranch }) {
  const [pullRequests, setPullRequests] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [diff, setDiff] = useState(null);
  const [form, setForm] = useState({ title: "", description: "", sourceBranch: currentBranch, targetBranch: "main" });
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [aiReview, setAiReview] = useState({ loading: false, error: "", data: null });

  const load = () => Promise.all([api.get(`/repo/${repoId}/pulls`), api.get(`/repo/${repoId}/branches`)]).then(([prs, branchResponse]) => { setPullRequests(prs.data || []); setBranches(branchResponse.data || []); }).catch((err) => setError(err.response?.data?.error || "Could not load pull requests."));
  useEffect(load, [repoId]);
  useEffect(() => setForm((current) => ({ ...current, sourceBranch: currentBranch })), [currentBranch]);

  const create = async (event) => { event.preventDefault(); try { await api.post(`/repo/${repoId}/pulls`, form); setForm({ title: "", description: "", sourceBranch: currentBranch, targetBranch: "main" }); setError(""); await load(); } catch (err) { setError(err.response?.data?.error || "Could not create pull request."); } };
  const open = async (pullRequest) => { try { setSelected((await api.get(`/repo/${repoId}/pulls/${pullRequest.id}`)).data); setDiff(null); setAiReview({ loading: false, error: "", data: null }); setError(""); } catch (err) { setError(err.response?.data?.error || "Could not load pull request."); } };
  const showDiff = async (file) => { try { setDiff((await api.get(`/repo/${repoId}/pulls/${selected.id}/diff`, { params: { path: file.path } })).data); } catch (err) { setError(err.response?.data?.error || "Could not load pull request diff."); } };
  const updateStatus = async (action) => { try { const response = await api({ method: action === "merge" ? "post" : "patch", url: `/repo/${repoId}/pulls/${selected.id}/${action}` }); setSelected(response.data); await load(); } catch (err) { setError(err.response?.data?.error || `Could not ${action} pull request.`); } };
  const addComment = async (event) => { event.preventDefault(); try { await api.post(`/repo/${repoId}/pulls/${selected.id}/comments`, { text: comment }); setComment(""); await open(selected); } catch (err) { setError(err.response?.data?.error || "Could not add comment."); } };

  const runAiReview = async () => {
    if (aiReview.loading || !selected) return;
    setAiReview({ loading: true, error: "", data: null });
    try {
      const response = await api.post(`/repo/${repoId}/pulls/${selected.id}/ai-review`);
      setAiReview({ loading: false, error: "", data: response.data });
    } catch (err) {
      setAiReview({
        loading: false,
        error: err.response?.data?.error || "Could not generate AI review. Please try again.",
        data: null,
      });
    }
  };

  const issues = (aiReview.data?.findings || []).filter((f) => f.severity !== "INFO");
  const suggestions = (aiReview.data?.findings || []).filter((f) => f.severity === "INFO");
  const positiveFindings = aiReview.data?.positiveFindings || [];

  const severityIcon = (sev) => {
    switch (sev) {
      case "CRITICAL":
      case "HIGH":
        return "🔴";
      case "MEDIUM":
        return "🟠";
      case "LOW":
        return "🟡";
      default:
        return "💡";
    }
  };

  return (
    <section className="pull-request-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">COLLABORATION</p>
          <h2>Pull Requests</h2>
        </div>
      </div>
      {error && <div className="repo-message error">{error}</div>}
      {selected ? (
        <div className="pull-request-detail">
          <button type="button" className="button button-secondary" onClick={() => { setSelected(null); setDiff(null); setAiReview({ loading: false, error: "", data: null }); }}>
            Back to pull requests
          </button>
          <h3>#{selected.number} {selected.title}</h3>
          <p>{selected.sourceBranch} → {selected.targetBranch}</p>
          <p>{selected.description || "No description."}</p>
          <p>{selected.status} · {selected.files?.length || 0} files changed · {selected.commits?.length || 0} commits</p>
          {selected.conflicts?.length > 0 && <div className="repo-message error">CONFLICTS DETECTED: {selected.conflicts.join(", ")}</div>}
          <div className="pull-request-files">
            {(selected.files || []).map((file) => (
              <button type="button" key={file.path} onClick={() => showDiff(file)}>
                <span>{file.status[0]}</span>{file.path}
              </button>
            ))}
          </div>
          {diff && (
            <div className="diff-viewer">
              <h4>{diff.path}</h4>
              {diff.binary ? (
                <p>Binary file cannot be displayed as text.</p>
              ) : (
                diff.lines.map((line, index) => (
                  <div className={`diff-line ${line.type}`} key={`${line.type}-${index}`}>
                    <span>{line.type === "added" ? "+" : line.type === "deleted" ? "-" : " "}</span>{line.text}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="pull-request-actions">
            {selected.status === "OPEN" && (
              <>
                <button className="button button-secondary" onClick={() => updateStatus("close")}>Close Pull Request</button>
                <button className="button button-primary" disabled={Boolean(selected.conflicts?.length)} onClick={() => window.confirm("Merge this pull request?") && updateStatus("merge")}>Merge Pull Request</button>
              </>
            )}
            <button
              type="button"
              className="button button-secondary pr-ai-btn"
              disabled={aiReview.loading}
              onClick={runAiReview}
            >
              <SparkleFillIcon size={14} />
              {aiReview.loading ? "Analyzing PR diff with Gemini..." : "AI Code Review"}
            </button>
          </div>

          {aiReview.error && (
            <div className="ai-output error-state" style={{ marginTop: "16px" }}>
              <p>{aiReview.error}</p>
              <button type="button" className="button button-secondary" onClick={runAiReview}>
                Retry AI Review
              </button>
            </div>
          )}

          {aiReview.loading && (
            <div className="pr-ai-loading" style={{ marginTop: "16px", padding: "16px", background: "#151c2e", borderRadius: "8px", border: "1px solid #27324a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#8b5cf6" }}>
                <SparkleFillIcon size={18} />
                <strong>Gemini is analyzing the changed files in this PR...</strong>
              </div>
              <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: "13px" }}>
                Checking for bugs, security vulnerabilities, edge cases, error handling, and performance.
              </p>
            </div>
          )}

          {aiReview.data && (
            <div className="pr-ai-review-card" style={{ marginTop: "20px" }}>
              <div className="pr-ai-card-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <SparkleFillIcon size={18} style={{ color: "#8b5cf6" }} />
                  <h4>AI Code Review</h4>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" className="button button-secondary" onClick={runAiReview} disabled={aiReview.loading}>
                    Re-run
                  </button>
                  <button type="button" className="button button-secondary" onClick={() => setAiReview({ loading: false, error: "", data: null })}>
                    Dismiss
                  </button>
                </div>
              </div>

              <div className="pr-ai-section">
                <h5>Summary</h5>
                <p className="pr-ai-summary">{aiReview.data.summary}</p>
              </div>

              <div className="pr-ai-section">
                <h5>Issues Found</h5>
                {issues.length === 0 ? (
                  <p className="pr-ai-none">No critical, high, or medium issues detected in this pull request.</p>
                ) : (
                  <div className="pr-ai-issues-list">
                    {issues.map((issue, idx) => (
                      <div className={`pr-ai-issue-item sev-${issue.severity.toLowerCase()}`} key={`issue-${idx}`}>
                        <div className="pr-ai-issue-header">
                          <span className="pr-ai-sev-tag">
                            {severityIcon(issue.severity)} {issue.severity}
                          </span>
                          {issue.file && (
                            <span className="pr-ai-file-tag">
                              📄 {issue.file}{issue.line ? ` : line ${issue.line}` : ""}
                            </span>
                          )}
                        </div>
                        <div className="pr-ai-issue-title">{issue.title}</div>
                        <p className="pr-ai-issue-desc">{issue.description}</p>
                        {issue.suggestion && (
                          <div className="pr-ai-fix-box">
                            <strong>💡 Suggested fix:</strong>
                            <p>{issue.suggestion}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {suggestions.length > 0 && (
                <div className="pr-ai-section">
                  <h5>Suggestions</h5>
                  <div className="pr-ai-suggestions-list">
                    {suggestions.map((sug, idx) => (
                      <div className="pr-ai-suggestion-item" key={`sug-${idx}`}>
                        <div className="pr-ai-issue-header">
                          <span className="pr-ai-sev-tag">💡 INFO</span>
                          {sug.file && (
                            <span className="pr-ai-file-tag">
                              📄 {sug.file}{sug.line ? ` : line ${sug.line}` : ""}
                            </span>
                          )}
                        </div>
                        <div className="pr-ai-issue-title">{sug.title}</div>
                        <p className="pr-ai-issue-desc">{sug.description}</p>
                        {sug.suggestion && (
                          <div className="pr-ai-fix-box">
                            <strong>💡 Recommended approach:</strong>
                            <p>{sug.suggestion}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {positiveFindings.length > 0 && (
                <div className="pr-ai-section">
                  <h5>Positive Findings</h5>
                  <ul className="pr-ai-positive-list">
                    {positiveFindings.map((finding, idx) => (
                      <li key={`pos-${idx}`}>
                        <span className="pr-ai-check">✓</span>
                        <span>{finding}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="pull-request-comments">
            <h4>Comments</h4>
            {(selected.comments || []).map((item) => (
              <p key={item._id}>{item.author?.username || "User"}: {item.text} <small>{new Date(item.createdAt).toLocaleString()}</small></p>
            ))}
            <form onSubmit={addComment}>
              <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Leave a comment" />
              <button className="button button-secondary" disabled={!comment.trim()}>Comment</button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <form className="pull-request-create" onSubmit={create}>
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Pull request title" required />
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Description (optional)" />
            <select value={form.targetBranch} onChange={(event) => setForm({ ...form, targetBranch: event.target.value })}>
              {branches.map((branch) => <option key={branch.name}>{branch.name}</option>)}
            </select>
            <select value={form.sourceBranch} onChange={(event) => setForm({ ...form, sourceBranch: event.target.value })}>
              {branches.map((branch) => <option key={branch.name}>{branch.name}</option>)}
            </select>
            <button className="button button-primary" disabled={!form.title.trim() || form.sourceBranch === form.targetBranch}>New Pull Request</button>
          </form>
          <div className="pull-request-list">
            {pullRequests.map((pullRequest) => (
              <button type="button" key={pullRequest.id} onClick={() => open(pullRequest)}>
                <strong>{pullRequest.status}</strong>
                <span>#{pullRequest.number} {pullRequest.title}</span>
                <small>{pullRequest.sourceBranch} → {pullRequest.targetBranch}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const Repo = () => {
  const { repoId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [repo, setRepo] = useState(null);
  const [currentBranch, setCurrentBranch] = useState("main");
  const [repositoryFiles, setRepositoryFiles] = useState([]);
  const [repositoryHistory, setRepositoryHistory] = useState([]);
  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(Boolean(repoId));
  const [submitting, setSubmitting] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [selectedImportFiles, setSelectedImportFiles] = useState([]);
  const [importFiles, setImportFiles] = useState([]);
  const [excludedImportFiles, setExcludedImportFiles] = useState([]);
  const [importSizeError, setImportSizeError] = useState("");
  const importInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [downloading, setDownloading] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [copiedCloneUrl, setCopiedCloneUrl] = useState(false);
  const [ai, setAi] = useState({ loading: "", error: "", commitMessage: "", review: null });
  const userId = localStorage.getItem("userId");

  useEffect(() => {
    const load = async () => {
      try {
        const repos = await api.get(`/repo/user/${userId}`);
        setRepositories(repos.data?.repositories || []);
      } catch (err) {
        if (err.response?.status !== 404) setMessage({ type: "error", text: "Could not load your repositories." });
      }
    };
    if (userId) load();
  }, [userId]);

  useEffect(() => {
    if (!repoId) return;
    Promise.all([api.get(`/repo/${repoId}`), api.get(`/repo/${repoId}/files`, { params: { branch: currentBranch } })]).then(([repoResponse, filesResponse]) => {
      setRepo(repoResponse.data);
      setRepositoryFiles(filesResponse.data?.files || []);
      setRepositoryHistory(filesResponse.data?.commits || []);
    }).catch(() => setMessage({ type: "error", text: "Repository not found." })).finally(() => setLoading(false));
  }, [repoId, currentBranch]);

  const handleCreate = async (event) => {
    event.preventDefault();
    const name = form.name.normalize("NFKC").trim().replace(/\s+/g, "-");
    if (!name) return setMessage({ type: "error", text: "Repository name is required." });
    if (!/^[\p{L}\p{N}._-]+$/u.test(name)) return setMessage({ type: "error", text: "Use only letters, numbers, dots, hyphens, and underscores." });
    try {
      setSubmitting(true); setMessage({ type: "", text: "" });
      const response = await api.post("/repo/create", { owner: userId, name, description: form.description.trim(), visibility: form.visibility, content: [], issues: [] });
      navigate(`/repo/${response.data.repositoryID}`);
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || err.response?.data?.message || "Could not create repository." });
    } finally { setSubmitting(false); }
  };

  const handleImport = async (event) => {
    event.preventDefault();
    const name = form.name.normalize("NFKC").trim().replace(/\s+/g, "-");
    if (!name) return setMessage({ type: "error", text: "Repository name is required." });
    if (!/^[\p{L}\p{N}._-]+$/u.test(name)) return setMessage({ type: "error", text: "Use only letters, numbers, dots, hyphens, and underscores." });
    if (!importFiles.length) return setMessage({ type: "error", text: "Select at least one project file." });
    if (importSizeError) return setMessage({ type: "error", text: importSizeError });
    const totalBytes = importFiles.reduce((total, entry) => total + entry.file.size, 0);
    if (totalBytes > MAX_IMPORT_TOTAL_BYTES) return setMessage({ type: "error", text: "The project exceeds the 250 MiB total size limit." });
    const data = new FormData();
    data.append("name", name);
    data.append("description", form.description);
    data.append("visibility", String(form.visibility));
    data.append("paths", JSON.stringify(importFiles.map((entry) => entry.path)));
    importFiles.forEach((entry) => data.append("files", entry.file, entry.file.name));
    try {
      setImporting(true); setMessage({ type: "", text: "" });
      const response = await api.post("/repo/import", data);
      setMessage({ type: "success", text: "Project imported successfully." });
      setTimeout(() => navigate(`/repo/${response.data.repositoryID}`), 500);
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Could not import project." });
    } finally { setImporting(false); }
  };

  const downloadZip = async () => {
    try {
      setDownloading(true); setMessage({ type: "", text: "" });
      const response = await api.get(`/repo/${repoId}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url; link.download = `${repo.name}.zip`; link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const responseData = error.response?.data;
      let errorMessage = "Could not download repository.";
      if (responseData instanceof Blob) errorMessage = (await responseData.text()).replace(/^\{"error":"|"\}$/g, "") || errorMessage;
      else errorMessage = responseData?.error || errorMessage;
      setMessage({ type: "error", text: errorMessage });
    } finally { setDownloading(false); }
  };

  const cloneUrl = `${window.location.origin}/repo/${repoId}`;
  const copyCloneUrl = async () => {
    await navigator.clipboard.writeText(cloneUrl);
    setCopiedCloneUrl(true);
    setTimeout(() => setCopiedCloneUrl(false), 1800);
  };

  const runAi = async (kind) => {
    setAi((current) => ({ ...current, loading: kind, error: "" }));
    try {
      const response = await api.post(`/ai/repositories/${repoId}/${kind === "commit" ? "commit-message" : "review"}`);
      setAi((current) => ({ ...current, loading: "", [kind === "commit" ? "commitMessage" : "review"]: kind === "commit" ? response.data.message : response.data }));
    } catch (error) {
      setAi((current) => ({ ...current, loading: "", error: error.response?.data?.error || "AI service is unavailable. Please try again later." }));
    }
  };

  if (repoId) return <><Navbar /><main className="repo-page"><Link className="back-link" to="/"><ArrowLeftIcon size={15} /> Back to workspace</Link>{loading ? <div className="state-card">Loading repository...</div> : repo ? <section className="repo-detail-view"><div className="repo-hero"><div><p className="eyebrow">REPOSITORY</p><h1>{repo.name}</h1><p>{repo.description || "No description yet."}</p></div><span className={`badge ${repo.visibility ? "badge-public" : "badge-private"}`}>{repo.visibility ? "Public" : "Private"}</span></div><div className="repo-tabs"><span className="active">Code</span><Link to={`/repo/${repo._id}/issues`}>Issues <b>{repo.issues?.length || 0}</b></Link><span>Commits</span><span>Activity</span><button className="button button-secondary" onClick={downloadZip} disabled={downloading}>{downloading ? "Preparing ZIP..." : "Download ZIP"}</button><button className="button button-secondary" onClick={() => setCloneOpen((current) => !current)}>Clone</button></div>{cloneOpen && <div className="clone-panel"><strong>Repository URL</strong><div className="clone-url"><input readOnly value={cloneUrl} /><button className="button button-secondary" onClick={copyCloneUrl}>{copiedCloneUrl ? "Copied" : "Copy"}</button></div><p>CodeVault AI does not provide a native Git clone command. Copy the URL to share this repository, or use Download ZIP to get the current files locally.</p></div>}<BranchPanel repoId={repoId} currentBranch={currentBranch} onBranchChange={setCurrentBranch} /><RepositoryFileExplorer files={repositoryFiles} history={repositoryHistory} /><CommitHistoryPanel repoId={repoId} branch={currentBranch} /><PullRequestPanel repoId={repoId} currentBranch={currentBranch} /><section className="ai-panel"><div className="ai-panel-heading"><div><p className="eyebrow">CODEVAULT AI</p><h2>Review your changes</h2></div><SparkleFillIcon size={22} /></div><div className="ai-actions"><button className="button button-secondary" onClick={() => runAi("commit")} disabled={Boolean(ai.loading)}><SparkleFillIcon size={15} />{ai.loading === "commit" ? "Generating..." : "Generate commit message"}</button><button className="button button-secondary" onClick={() => runAi("review")} disabled={Boolean(ai.loading)}><SparkleFillIcon size={15} />{ai.loading === "review" ? "Reviewing..." : "Review changes"}</button>{(ai.commitMessage || ai.review || ai.error) && <button className="button button-secondary" onClick={() => setAi({ loading: "", error: "", commitMessage: "", review: null })}>Clear</button>}</div>{ai.error && <div className="ai-output error-state">{ai.error}<button className="button button-secondary" onClick={() => runAi(ai.commitMessage ? "commit" : "review")}>Retry</button></div>}{ai.commitMessage && <div className="ai-output"><strong>Suggested commit message</strong><input value={ai.commitMessage} onChange={(event) => setAi((current) => ({ ...current, commitMessage: event.target.value }))} /></div>}{ai.review && <div className="ai-output"><strong>Review findings</strong>{ai.review.findings.length === 0 ? <p>No findings were returned for the staged changes.</p> : ai.review.findings.map((finding, index) => <div className="ai-finding" key={`${finding.title}-${index}`}><span className={`badge badge-${finding.severity === "suggestion" ? "private" : "public"}`}>{finding.severity}</span><strong>{finding.title}</strong><p>{finding.description}</p><small>{finding.file || "Relevant changed section"} · {finding.certainty || "potential concern"}</small></div>)}</div>}</section></section> : <div className="state-card error-state">Repository not found.</div>}</main></>;

  return <><Navbar /><main className="repo-page"><Link className="back-link" to="/"><ArrowLeftIcon size={15} /> Back to workspace</Link><div className="create-layout"><section><p className="eyebrow">NEW PROJECT</p><h1>Create a repository</h1><p className="page-lead">A focused home for your source, history, and next release.</p><button type="button" className="button button-secondary" onClick={() => setImportMode((current) => !current)}>Import Existing Project</button>{importMode && <form className="repo-form-card" onSubmit={handleImport}><label>Project files<input ref={importInputRef} type="file" multiple webkitdirectory="true" directory="true" onChange={(event) => { const selected = Array.from(event.target.files || []).map((file) => ({ file, path: (file.webkitRelativePath || file.name).replace(/\\/g, "/") })); const excluded = selected.map((entry) => ({ ...entry, reason: getImportExclusion(entry.path) })).filter((entry) => entry.reason); const included = selected.filter((entry) => !getImportExclusion(entry.path)); const oversized = included.find(({ file }) => file.size > MAX_IMPORT_FILE_BYTES); setSelectedImportFiles(selected); setExcludedImportFiles(excluded); setImportFiles(included); setImportSizeError(oversized ? `${oversized.path} is too large (${oversized.file.size.toLocaleString()} bytes). The maximum is 5 MB per file.` : included.reduce((total, entry) => total + entry.file.size, 0) > MAX_IMPORT_TOTAL_BYTES ? "The project exceeds the 250 MiB total size limit." : ""); }} /></label>{!form.name.trim() && <div className="repo-message error">Repository name is required.</div>}{form.name.trim() && !/^[\p{L}\p{N}._-]+$/u.test(form.name.trim().replace(/\s+/g, "-")) && <div className="repo-message error">Use only letters, numbers, dots, hyphens, and underscores.</div>}{!importFiles.length && <div className="repo-message error">Select at least one project file.</div>}{selectedImportFiles.length > 0 && <div><strong>{selectedImportFiles.length} files selected</strong> <span>{excludedImportFiles.length} excluded</span><button type="button" className="button button-secondary" onClick={() => { setSelectedImportFiles([]); setImportFiles([]); setExcludedImportFiles([]); setImportSizeError(""); importInputRef.current.value = ""; }}>Change files</button><div style={{ maxHeight: "120px", overflowY: "auto", marginTop: "8px" }}><strong>Files to upload ({importFiles.length})</strong>{importFiles.slice(0, 20).map((entry) => <div key={entry.path}>{entry.path}</div>)}{importFiles.length > 20 && <small>...and {importFiles.length - 20} more files</small>}{excludedImportFiles.length > 0 && <><strong>Excluded files</strong>{excludedImportFiles.slice(0, 10).map((entry) => <div key={entry.path}>{entry.path} ({entry.reason})</div>)}{excludedImportFiles.length > 10 && <small>...and {excludedImportFiles.length - 10} more excluded files</small>}</>}</div></div>}{importSizeError && <div className="repo-message error">{importSizeError}</div>}<button className="button button-primary" disabled={importing || Boolean(importSizeError) || !form.name.trim() || !/^[\p{L}\p{N}._-]+$/u.test(form.name.trim().replace(/\s+/g, "-")) || !importFiles.length}>{importing ? "Importing..." : "Import project"}</button></form>}<form className="repo-form-card" onSubmit={handleCreate}><label>Repository name <span>*</span><input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="project-name" /></label><label>Description <small>optional</small><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What are you building?" rows="4" /></label><fieldset><legend>Visibility</legend><label className="visibility-option"><input type="radio" checked={form.visibility} onChange={() => setForm({ ...form, visibility: true })} /><GlobeIcon size={17} /><span><strong>Public</strong><small>Visible to everyone</small></span></label><label className="visibility-option"><input type="radio" checked={!form.visibility} onChange={() => setForm({ ...form, visibility: false })} /><LockIcon size={17} /><span><strong>Private</strong><small>Visible only to you</small></span></label></fieldset>{message.text && <div className={`repo-message ${message.type}`}>{message.text}</div>}<button className="button button-primary" disabled={submitting}><PlusIcon size={16} />{submitting ? "Creating..." : "Create repository"}</button></form></section><aside className="repo-sidebar"><div className="sidebar-heading"><RepoIcon size={17} /><h2>Your repositories</h2></div>{repositories.length ? repositories.map((item) => <Link className="repo-sidebar-item" to={`/repo/${item._id}`} key={item._id}><strong>{item.name}</strong><span>{item.visibility ? "Public" : "Private"}</span></Link>) : <p className="muted">No repositories yet.</p>}</aside></div></main></>;
};

export default Repo;