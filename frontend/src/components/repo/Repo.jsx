import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  GitBranchIcon,
  GlobeIcon,
  LockIcon,
  PlusIcon,
  RepoIcon,
  SparkleFillIcon,
  TerminalIcon,
  TrashIcon,
} from "@primer/octicons-react";
import api from "../../api";
import Navbar from "../Navbar";
import "./repo.css";

const isAuthError = (err) => err?.response?.status === 401;

const formatApiError = (err, fallbackMessage) => {
  if (!err) return fallbackMessage;
  if (!err.response) {
    return "Network error. Unable to connect to server. Please check your connection.";
  }
  const status = err.response.status;
  if (status === 401) {
    return err.response.data?.error || err.response.data?.message || "Invalid or expired authentication token. Please sign in again.";
  }
  if (status === 403) {
    return err.response.data?.error || err.response.data?.message || "Access denied. You do not have permission for this action.";
  }
  if (status === 404) {
    return err.response.data?.error || err.response.data?.message || "Requested resource was not found.";
  }
  if (status >= 500) {
    return err.response.data?.error || err.response.data?.message || "Server error occurred. Please try again later.";
  }
  return err.response.data?.error || err.response.data?.message || fallbackMessage;
};

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

function BranchPanel({ repoId, currentBranch, onBranchChange, onAuthError }) {
  const [branches, setBranches] = useState([]);
  const [newBranch, setNewBranch] = useState("");
  const [panelError, setPanelError] = useState("");
  const [createError, setCreateError] = useState("");

  const loadBranches = () => api.get(`/repo/${repoId}/branches`)
    .then((response) => {
      setBranches(response.data || []);
      setPanelError("");
    })
    .catch((err) => {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setPanelError(formatApiError(err, "Could not load branches."));
      }
    });

  useEffect(() => {
    loadBranches();
  }, [repoId]);

  const handleBranchInput = (event) => {
    setNewBranch(event.target.value);
    if (createError) setCreateError("");
  };

  const create = async (event) => {
    event.preventDefault();
    const trimmed = newBranch.trim();
    if (!trimmed) {
      setCreateError("Branch name is required.");
      return;
    }
    if (trimmed === "main") {
      setCreateError("Cannot create a branch named 'main'.");
      return;
    }
    if (!/^(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(trimmed)) {
      setCreateError("Branch name must start with an alphanumeric character and use only letters, numbers, dots, hyphens, or underscores.");
      return;
    }

    try {
      setCreateError("");
      await api.post(`/repo/${repoId}/branches/${encodeURIComponent(trimmed)}`, { from: currentBranch });
      setNewBranch("");
      await loadBranches();
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setCreateError(formatApiError(err, "Could not create branch."));
      }
    }
  };

  const remove = async (name) => {
    if (!window.confirm(`Delete branch ${name}?`)) return;
    try {
      setPanelError("");
      await api.delete(`/repo/${repoId}/branches/${encodeURIComponent(name)}`, { data: { currentBranch } });
      await loadBranches();
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setPanelError(formatApiError(err, "Could not delete branch."));
      }
    }
  };

  return (
    <section className="branch-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">BRANCHES</p>
          <h2>Branches</h2>
        </div>
        <strong>Current branch: {currentBranch}</strong>
      </div>
      {panelError && (
        <div className="repo-message error" role="alert">
          <AlertIcon size={16} className="error-icon" />
          <span>{panelError}</span>
        </div>
      )}
      <div className="branch-list">
        {branches.map((branch) => (
          <div className={`branch-row ${branch.name === currentBranch ? "active" : ""}`} key={branch.name}>
            <button type="button" className="branch-name-btn" onClick={() => onBranchChange(branch.name)}>
              <GitBranchIcon size={14} className="branch-icon" />
              <span>{branch.name}</span>
            </button>
            <span className="branch-commit-badge">{branch.commits} {branch.commits === 1 ? "commit" : "commits"}</span>
            {branch.name !== "main" && (
              <button
                type="button"
                className="branch-delete"
                onClick={() => remove(branch.name)}
                title={`Delete branch ${branch.name}`}
              >
                <TrashIcon size={12} />
                <span>Delete</span>
              </button>
            )}
          </div>
        ))}
      </div>
      <form className="branch-create" onSubmit={create}>
        <div className="branch-input-wrapper">
          <GitBranchIcon size={14} className="branch-input-icon" />
          <input
            value={newBranch}
            onChange={handleBranchInput}
            placeholder="feature-login"
            aria-label="New branch name"
          />
        </div>
        <button type="submit" className="button button-secondary branch-create-btn">
          <PlusIcon size={14} />
          <span>Create branch</span>
        </button>
      </form>
      {createError && (
        <div className="repo-message error branch-create-error" role="alert">
          <AlertIcon size={16} className="error-icon" />
          <span>{createError}</span>
        </div>
      )}
    </section>
  );
}

function CommitHistoryPanel({ repoId, branch, onAuthError }) {
  const [commits, setCommits] = useState([]);
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/repo/${repoId}/commits`, { params: { branch } })
      .then((response) => {
        setCommits(response.data || []);
        setError("");
      })
      .catch((err) => {
        if (isAuthError(err)) {
          onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
        } else {
          setError(formatApiError(err, "Could not load commit history."));
        }
      });
  }, [repoId, branch]);

  const selectCommit = async (commitId) => {
    setSelectedFile(null);
    setDiff(null);
    setError("");
    try {
      const response = await api.get(`/repo/${repoId}/commits/${commitId}`, { params: { branch } });
      setSelectedCommit(response.data);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setError(formatApiError(err, "Could not load commit details."));
      }
    }
  };

  const selectFile = async (file) => {
    setSelectedFile(file);
    setDiff(null);
    setError("");
    try {
      const response = await api.get(`/repo/${repoId}/commits/${selectedCommit.id}/diff`, { params: { path: file.path, branch } });
      setDiff(response.data);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setError(formatApiError(err, "Could not load file diff."));
      }
    }
  };

  return (
    <section className="commit-history-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h2>Commits</h2>
        </div>
      </div>
      {error && (
        <div className="repo-message error" role="alert">
          <AlertIcon size={16} className="error-icon" />
          <span>{error}</span>
        </div>
      )}
      {!commits.length ? (
        <p className="repo-explorer-empty">No commits in this repository.</p>
      ) : (
        <div className="commit-history-list">
          {commits.map((commit) => (
            <button
              type="button"
              className={`commit-history-item ${selectedCommit?.id === commit.id ? "active" : ""}`}
              key={commit.id}
              onClick={() => selectCommit(commit.id)}
            >
              <strong>{commit.id.slice(0, 7)}</strong>
              <span>{commit.message}</span>
              <small>{commit.author || "Author unavailable"} · {commit.changedFiles} changed files · {commit.date ? new Date(commit.date).toLocaleString() : "Timestamp unavailable"}</small>
            </button>
          ))}
        </div>
      )}
      {selectedCommit && (
        <div className="commit-detail">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => { setSelectedCommit(null); setSelectedFile(null); setDiff(null); }}
          >
            Back to history
          </button>
          <h3>{selectedCommit.message}</h3>
          <p className="commit-full-id">{selectedCommit.id}</p>
          <p>{selectedCommit.author || "Author unavailable"} · {selectedCommit.date ? new Date(selectedCommit.date).toLocaleString() : "Timestamp unavailable"}</p>
          <div className="changed-files">
            {selectedCommit.files.length ? selectedCommit.files.map((file) => (
              <button
                type="button"
                className={`changed-file ${selectedFile?.path === file.path ? "active" : ""}`}
                key={file.path}
                onClick={() => selectFile(file)}
              >
                <span className={`file-status ${file.status.toLowerCase()}`}>{file.status}</span>
                {file.path}
              </button>
            )) : <p>No changed files recorded.</p>}
          </div>
          {diff && (
            <div className="diff-viewer">
              <h4>{diff.path}</h4>
              {diff.binary ? (
                <p>Binary file cannot be displayed as text.</p>
              ) : (
                diff.lines.map((line, index) => (
                  <div className={`diff-line ${line.type}`} key={`${line.type}-${index}`}>
                    <span>{line.type === "added" ? "+" : line.type === "deleted" ? "-" : " "}</span>
                    {line.text}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PullRequestPanel({ repoId, currentBranch, onAuthError }) {
  const [pullRequests, setPullRequests] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [diff, setDiff] = useState(null);
  const [form, setForm] = useState({ title: "", description: "", sourceBranch: currentBranch, targetBranch: "main" });
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [aiReview, setAiReview] = useState({ loading: false, error: "", data: null });

  const load = () => Promise.all([api.get(`/repo/${repoId}/pulls`), api.get(`/repo/${repoId}/branches`)])
    .then(([prs, branchResponse]) => {
      setPullRequests(prs.data || []);
      setBranches(branchResponse.data || []);
      setError("");
    })
    .catch((err) => {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setError(formatApiError(err, "Could not load pull requests."));
      }
    });

  useEffect(() => {
    load();
  }, [repoId]);
  useEffect(() => {
    setForm((current) => ({ ...current, sourceBranch: currentBranch }));
  }, [currentBranch]);

  const create = async (event) => {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setError("Pull request title is required.");
      return;
    }
    if (form.sourceBranch === form.targetBranch) {
      setError("Source and target branches must be different.");
      return;
    }
    try {
      await api.post(`/repo/${repoId}/pulls`, { ...form, title, description: form.description.trim() });
      setForm({ title: "", description: "", sourceBranch: currentBranch, targetBranch: "main" });
      setError("");
      await load();
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setError(formatApiError(err, "Could not create pull request."));
      }
    }
  };
  const open = async (pullRequest) => {
    try {
      setSelected((await api.get(`/repo/${repoId}/pulls/${pullRequest.id}`)).data);
      setDiff(null);
      setAiReview({ loading: false, error: "", data: null });
      setError("");
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setError(formatApiError(err, "Could not load pull request."));
      }
    }
  };
  const showDiff = async (file) => {
    try {
      setDiff((await api.get(`/repo/${repoId}/pulls/${selected.id}/diff`, { params: { path: file.path } })).data);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setError(formatApiError(err, "Could not load pull request diff."));
      }
    }
  };
  const updateStatus = async (action) => {
    try {
      const response = await api({ method: action === "merge" ? "post" : "patch", url: `/repo/${repoId}/pulls/${selected.id}/${action}` });
      setSelected(response.data);
      await load();
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setError(formatApiError(err, `Could not ${action} pull request.`));
      }
    }
  };
  const addComment = async (event) => {
    event.preventDefault();
    if (!comment.trim()) {
      setError("Comment text cannot be empty.");
      return;
    }
    try {
      await api.post(`/repo/${repoId}/pulls/${selected.id}/comments`, { text: comment.trim() });
      setComment("");
      await open(selected);
    } catch (err) {
      if (isAuthError(err)) {
        onAuthError?.(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
      } else {
        setError(formatApiError(err, "Could not add comment."));
      }
    }
  };

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
      {error && (
        <div className="repo-message error" role="alert">
          <AlertIcon size={16} className="error-icon" />
          <span>{error}</span>
        </div>
      )}
      {selected ? (
        <div className="pull-request-detail">
          <button type="button" className="button button-secondary" onClick={() => { setSelected(null); setDiff(null); setAiReview({ loading: false, error: "", data: null }); }}>
            Back to pull requests
          </button>
          <h3>#{selected.number} {selected.title}</h3>
          <p>{selected.sourceBranch} → {selected.targetBranch}</p>
          <p>{selected.description || "No description."}</p>
          <p>{selected.status} · {selected.files?.length || 0} files changed · {selected.commits?.length || 0} commits</p>
          {selected.conflicts?.length > 0 && (
            <div className="repo-message error" role="alert">
              <AlertIcon size={16} className="error-icon" />
              <span>CONFLICTS DETECTED: {selected.conflicts.join(", ")}</span>
            </div>
          )}
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
            <input
              value={form.title}
              onChange={(event) => {
                setForm({ ...form, title: event.target.value });
                if (error) setError("");
              }}
              placeholder="Pull request title"
              required
            />
            <textarea
              value={form.description}
              onChange={(event) => {
                setForm({ ...form, description: event.target.value });
                if (error) setError("");
              }}
              placeholder="Description (optional)"
            />
            <label>Source Branch
              <select
                value={form.sourceBranch}
                onChange={(event) => {
                  setForm({ ...form, sourceBranch: event.target.value });
                  if (error) setError("");
                }}
              >
                {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
              </select>
            </label>
            <label>Target Branch
              <select
                value={form.targetBranch}
                onChange={(event) => {
                  setForm({ ...form, targetBranch: event.target.value });
                  if (error) setError("");
                }}
              >
                {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
              </select>
            </label>
            <button className="button button-primary" disabled={!form.title.trim()}>New Pull Request</button>
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
  const [importError, setImportError] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!repoId && new URLSearchParams(window.location.search).get("import") === "1") {
      setImportMode(true);
    }
  }, [repoId]);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [downloading, setDownloading] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [copiedCloneUrl, setCopiedCloneUrl] = useState(false);
  const [ai, setAi] = useState({ loading: "", error: "", errorKind: "", commitMessage: "", review: null });
  const [branchChanges, setBranchChanges] = useState(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [selectedCommitForReview, setSelectedCommitForReview] = useState(null);
  const aiRequestInProgress = useRef(false);
  const userId = localStorage.getItem("userId");
  const isValidUserId = (value) => typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value);

  useEffect(() => {
    const load = async () => {
      try {
        const repos = await api.get(`/repo/user/${userId}`);
        setRepositories(repos.data?.repositories || []);
      } catch (err) {
        if (err.response?.status !== 404) setMessage({ type: "error", text: "Could not load your repositories." });
      }
    };
    if (userId && isValidUserId(userId)) load();
    else setRepositories([]);
  }, [userId]);

  useEffect(() => {
    if (!repoId) return;
    Promise.all([api.get(`/repo/${repoId}`), api.get(`/repo/${repoId}/files`, { params: { branch: currentBranch } })]).then(([repoResponse, filesResponse]) => {
      setRepo(repoResponse.data);
      setRepositoryFiles(filesResponse.data?.files || []);
      setRepositoryHistory(filesResponse.data?.commits || []);
    }).catch(() => setMessage({ type: "error", text: "Repository not found." })).finally(() => setLoading(false));
  }, [repoId, currentBranch]);

  useEffect(() => {
    setAi({ loading: "", error: "", errorKind: "", commitMessage: "", review: null });
    setSelectedCommitForReview(null);
  }, [repoId, currentBranch]);

  useEffect(() => {
    if (!repoId) return;
    let isCancelled = false;
    setChangesLoading(true);
    api.get(`/repo/${repoId}/changes`, {
      params: {
        branch: currentBranch,
        ...(selectedCommitForReview ? { commit: selectedCommitForReview } : {}),
      },
    })
      .then((response) => {
        if (!isCancelled) setBranchChanges(response.data);
      })
      .catch((err) => {
        if (!isCancelled) {
          if (isAuthError(err)) {
            setAuthError(formatApiError(err, "Invalid or expired authentication token. Please sign in again."));
          } else {
            setBranchChanges({
              hasChanges: false,
              reason: formatApiError(err, "Could not load changes for this branch."),
              comparison: `Branch ${currentBranch}`,
              changedFiles: [],
              totalFilesChanged: 0,
            });
          }
        }
      })
      .finally(() => {
        if (!isCancelled) setChangesLoading(false);
      });

    return () => { isCancelled = true; };
  }, [repoId, currentBranch, selectedCommitForReview]);

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
      setMessage({ type: "error", text: formatApiError(err, "Could not create repository.") });
    } finally { setSubmitting(false); }
  };

  const handleImport = async (event) => {
    event.preventDefault();
    const name = form.name.normalize("NFKC").trim().replace(/\s+/g, "-");
    if (!name) return setImportError("Repository name is required.");
    if (!/^[\p{L}\p{N}._-]+$/u.test(name)) return setImportError("Use only letters, numbers, dots, hyphens, and underscores.");
    if (!importFiles.length) return setImportError("Select at least one project file.");
    if (importSizeError) return setImportError(importSizeError);
    const totalBytes = importFiles.reduce((total, entry) => total + entry.file.size, 0);
    if (totalBytes > MAX_IMPORT_TOTAL_BYTES) return setImportError("The project exceeds the 250 MiB total size limit.");
    const data = new FormData();
    data.append("name", name);
    data.append("description", form.description.trim());
    data.append("visibility", String(form.visibility));
    data.append("paths", JSON.stringify(importFiles.map((entry) => entry.path)));
    importFiles.forEach((entry) => data.append("files", entry.file, entry.file.name));
    try {
      setImporting(true); setImportError("");
      const response = await api.post("/repo/import", data);
      setMessage({ type: "success", text: "Project imported successfully." });
      setTimeout(() => navigate(`/repo/${response.data.repositoryID}`), 500);
    } catch (err) {
      setImportError(formatApiError(err, "Could not import project."));
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
      if (isAuthError(error)) {
        setAuthError(formatApiError(error, "Invalid or expired authentication token. Please sign in again."));
        return;
      }
      const responseData = error.response?.data;
      let errorMessage = "Could not download repository.";
      if (responseData instanceof Blob) {
        try {
          const text = await responseData.text();
          const parsed = JSON.parse(text);
          errorMessage = parsed.error || errorMessage;
        } catch {
          errorMessage = "Could not download repository.";
        }
      } else {
        errorMessage = formatApiError(error, "Could not download repository.");
      }
      setMessage({ type: "error", text: errorMessage });
    } finally { setDownloading(false); }
  };

  const cloneUrl = `${window.location.origin}/repo/${repoId}`;
  const copyCloneUrl = async () => {
    await navigator.clipboard.writeText(cloneUrl);
    setCopiedCloneUrl(true);
    setTimeout(() => setCopiedCloneUrl(false), 1800);
  };

  const runAi = async (requestedKind) => {
    const kind = requestedKind;
    if (aiRequestInProgress.current) return;
    aiRequestInProgress.current = true;
    const resultKey = kind === "commit" ? "commitMessage" : "review";
    setAi((current) => ({ ...current, loading: kind, error: "", errorKind: "", [resultKey]: kind === "commit" ? "" : null }));
    try {
      const payload = {
        branch: currentBranch,
        ...(selectedCommitForReview ? { commit: selectedCommitForReview } : {}),
      };
      const response = await api.post(`/ai/repositories/${repoId}/${kind === "commit" ? "commit-message" : "review"}`, payload);
      setAi((current) => ({ ...current, loading: "", error: "", errorKind: "", [resultKey]: kind === "commit" ? response.data.message : response.data }));
    } catch (error) {
      if (isAuthError(error)) {
        setAuthError(formatApiError(error, "Invalid or expired authentication token. Please sign in again."));
        setAi((current) => ({ ...current, loading: "", errorKind: kind }));
        return;
      }
      setAi((current) => ({ ...current, loading: "error", errorKind: kind, [resultKey]: kind === "commit" ? "" : null, error: formatApiError(error, "AI service is unavailable. Please try again later.") }));
    } finally {
      aiRequestInProgress.current = false;
    }
  };

  if (repoId) return (
    <>
      <Navbar />
      <main className="repo-page">
        <Link className="back-link" to="/"><ArrowLeftIcon size={15} /> Back to workspace</Link>
        {loading ? (
          <div className="state-card">Loading repository...</div>
        ) : repo ? (
          <section className="repo-detail-view">
            <div className="repo-hero">
              <div className="repo-hero-info">
                <p className="eyebrow">REPOSITORY</p>
                <h1>{repo.name}</h1>
                <p>{repo.description || "No description yet."}</p>
              </div>
              <span className={`repo-visibility-badge ${repo.visibility ? "repo-badge-public" : "repo-badge-private"}`}>
                {repo.visibility ? (
                  <>
                    <GlobeIcon size={12} className="repo-badge-icon" />
                    <span>Public</span>
                  </>
                ) : (
                  <>
                    <LockIcon size={12} className="repo-badge-icon" />
                    <span>Private</span>
                  </>
                )}
              </span>
            </div>
            <div className="repo-tabs">
              <nav className="repo-tabs-nav" aria-label="Repository navigation">
                <span className="repo-tab active">
                  <CodeIcon size={14} className="repo-tab-icon" />
                  <span>Code</span>
                </span>
                <Link to={`/repo/${repo._id}/issues`} className="repo-tab">
                  <AlertIcon size={14} className="repo-tab-icon" />
                  <span>Issues</span>
                  <span className="repo-tab-badge">{repo.issues?.length || 0}</span>
                </Link>
                <button
                  type="button"
                  className="repo-tab"
                  onClick={() => {
                    const el = document.querySelector(".commit-history-panel");
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  <GitBranchIcon size={14} className="repo-tab-icon" />
                  <span>Commits</span>
                </button>
                <button
                  type="button"
                  className="repo-tab"
                  onClick={() => {
                    const el = document.querySelector(".pull-request-panel");
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  <span>Activity</span>
                </button>
              </nav>
              <div className="repo-header-actions">
                <button
                  type="button"
                  className="repo-action-btn repo-action-download"
                  onClick={downloadZip}
                  disabled={downloading}
                >
                  <DownloadIcon size={14} className="repo-action-icon" />
                  <span>{downloading ? "Preparing ZIP..." : "Download ZIP"}</span>
                </button>
                <button
                  type="button"
                  className={`repo-action-btn repo-action-clone ${cloneOpen ? "active" : ""}`}
                  onClick={() => setCloneOpen((current) => !current)}
                  aria-expanded={cloneOpen}
                >
                  <TerminalIcon size={14} className="repo-action-icon" />
                  <span>Clone</span>
                </button>
              </div>
            </div>
            {authError && (
              <div className="repo-message error repo-auth-banner" role="alert">
                <div className="repo-auth-banner-left">
                  <AlertIcon size={16} className="error-icon" />
                  <div>
                    <strong>Authentication required: </strong>
                    <span>{authError}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="button button-secondary button-sm auth-signin-btn"
                  onClick={() => {
                    localStorage.removeItem("token");
                    localStorage.removeItem("userId");
                    navigate("/auth");
                  }}
                >
                  Sign in
                </button>
              </div>
            )}
            {message.text && (
              <div className={`repo-message ${message.type}`} role="alert" style={{ margin: "14px 25px" }}>
                {message.type === "error" ? <AlertIcon size={16} className="error-icon" /> : <CheckIcon size={16} />}
                <span>{message.text}</span>
              </div>
            )}
            {cloneOpen && (
              <div className="clone-panel">
                <strong>Repository URL</strong>
                <div className="clone-url">
                  <input readOnly value={cloneUrl} aria-label="Repository clone URL" />
                  <button type="button" className="button button-secondary clone-copy-btn" onClick={copyCloneUrl}>
                    {copiedCloneUrl ? (
                      <>
                        <CheckIcon size={14} />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon size={14} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <p>CodeVault AI does not provide a native Git clone command. Copy the URL to share this repository, or use Download ZIP to get the current files locally.</p>
              </div>
            )}
            <BranchPanel repoId={repoId} currentBranch={currentBranch} onBranchChange={setCurrentBranch} onAuthError={setAuthError} />
            <RepositoryFileExplorer files={repositoryFiles} history={repositoryHistory} />
            <CommitHistoryPanel repoId={repoId} branch={currentBranch} onAuthError={setAuthError} />
            <PullRequestPanel repoId={repoId} currentBranch={currentBranch} onAuthError={setAuthError} />
            <section className="ai-panel">
              <div className="ai-panel-heading">
                <div>
                  <p className="eyebrow">CODEVAULT AI</p>
                  <h2>Review your changes</h2>
                </div>
                <SparkleFillIcon size={22} />
              </div>

              {changesLoading ? (
                <div className="ai-status-banner">
                  <span>Analyzing changes on branch <strong>{currentBranch}</strong>...</span>
                </div>
              ) : branchChanges ? (
                <div className="ai-branch-comparison">
                  <div className="ai-comparison-header">
                    <span className="ai-comparison-tag">
                      Comparing: <strong>{branchChanges.comparison || currentBranch}</strong>
                    </span>
                    {branchChanges.hasChanges ? (
                      <span className="badge badge-public">
                        {branchChanges.totalFilesChanged} {branchChanges.totalFilesChanged === 1 ? "file" : "files"} changed
                      </span>
                    ) : (
                      <span className="badge badge-private">No file changes</span>
                    )}
                  </div>

                  {branchChanges.hasChanges ? (
                    <div className="ai-changed-files-box">
                      <div className="ai-changed-files-summary">
                        <span>Changed files available for review:</span>
                        {selectedCommitForReview && (
                          <button
                            type="button"
                            className="button button-secondary button-sm"
                            onClick={() => setSelectedCommitForReview(null)}
                          >
                            Reset to branch HEAD
                          </button>
                        )}
                      </div>
                      <div className="ai-changed-files-list">
                        {branchChanges.changedFiles.map((file) => (
                          <div className="ai-changed-file-row" key={file.path}>
                            <span className={`file-status ${file.status.toLowerCase()}`}>
                              {file.status}
                            </span>
                            <span className="ai-file-path">{file.path}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="ai-no-changes-box">
                      <p>{branchChanges.reason || "No changed files were found on this branch to review."}</p>
                      {branchChanges.latestCommitWithChanges && (
                        <div className="ai-earlier-commit-hint">
                          <span>
                            Latest commit with changes: <code>{branchChanges.latestCommitWithChanges.id.slice(0, 8)}</code>
                            {" "}(&ldquo;{branchChanges.latestCommitWithChanges.message}&rdquo; &middot; {branchChanges.latestCommitWithChanges.changedCount} files)
                          </span>
                          <button
                            type="button"
                            className="button button-secondary button-sm"
                            onClick={() => setSelectedCommitForReview(branchChanges.latestCommitWithChanges.id)}
                          >
                            Select this commit to review
                          </button>
                        </div>
                      )}
                      {selectedCommitForReview && (
                        <button
                          type="button"
                          className="button button-secondary button-sm"
                          style={{ marginTop: "10px" }}
                          onClick={() => setSelectedCommitForReview(null)}
                        >
                          Reset to branch HEAD
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="ai-actions">
                <button
                  className="button button-secondary"
                  onClick={() => runAi("commit")}
                  disabled={Boolean(ai.loading) || changesLoading || !branchChanges?.hasChanges}
                  title={!branchChanges?.hasChanges ? "No changed files available on this branch to generate a commit message." : ""}
                >
                  <SparkleFillIcon size={15} />
                  {ai.loading === "commit" ? "Generating..." : "Generate commit message"}
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => runAi("review")}
                  disabled={Boolean(ai.loading) || changesLoading || !branchChanges?.hasChanges}
                  title={!branchChanges?.hasChanges ? "No changed files available on this branch to review." : ""}
                >
                  <SparkleFillIcon size={15} />
                  {ai.loading === "review" ? "Reviewing..." : "Review changes"}
                </button>
                {(ai.commitMessage || ai.review || ai.error) && (
                  <button className="button button-secondary" onClick={() => setAi({ loading: "", error: "", errorKind: "", commitMessage: "", review: null })}>
                    Clear
                  </button>
                )}
              </div>

              {ai.error && (
                <div className="ai-output error-state">
                  <div className="ai-error-text">{ai.error}</div>
                  <button className="button button-secondary" onClick={() => runAi(ai.errorKind || "review")}>
                    Retry
                  </button>
                </div>
              )}
              {ai.commitMessage && (
                <div className="ai-output">
                  <strong>Suggested commit message</strong>
                  <input value={ai.commitMessage} onChange={(event) => setAi((current) => ({ ...current, commitMessage: event.target.value }))} />
                </div>
              )}
              {ai.review && (
                <div className="ai-output">
                  <strong>Review findings</strong>
                  {(!ai.review.findings || ai.review.findings.length === 0) ? (
                    <p>No findings were returned for the reviewed changes.</p>
                  ) : (
                    ai.review.findings.map((finding, index) => (
                      <div className="ai-finding" key={`${finding.title}-${index}`}>
                        <span className={`badge badge-${finding.severity?.toLowerCase() === "suggestion" || finding.severity?.toLowerCase() === "info" ? "private" : "public"}`}>{finding.severity || "Info"}</span>
                        <strong>{finding.title}</strong>
                        <p>{finding.description}</p>
                        <small>{finding.file || "Relevant changed section"}{finding.line ? ` : line ${finding.line}` : ""} &middot; {finding.certainty || "potential concern"}</small>
                        {finding.recommendation && (
                          <div className="pr-ai-fix-box">
                            <strong>💡 Recommendation:</strong>
                            <p>{finding.recommendation}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          </section>
        ) : (
          <div className="state-card error-state">Repository not found.</div>
        )}
      </main>
    </>
  );

  return (
    <>
      <Navbar />
      <main className="repo-page">
        <Link className="back-link" to="/"><ArrowLeftIcon size={15} /> Back to workspace</Link>
        <div className="create-layout">
          <section>
            <p className="eyebrow">NEW PROJECT</p>
            <h1>Create a repository</h1>
            <p className="page-lead">A focused home for your source, history, and next release.</p>
            <button type="button" className="button button-secondary" onClick={() => { setImportMode((current) => !current); setImportError(""); }}>
              {importMode ? "Cancel Import" : "Import Existing Project"}
            </button>
            {importMode && (
              <form className="repo-form-card" onSubmit={handleImport}>
                <label>
                  Project files
                  <input
                    ref={importInputRef}
                    type="file"
                    multiple
                    webkitdirectory="true"
                    directory="true"
                    onChange={(event) => {
                      setImportError("");
                      const selected = Array.from(event.target.files || []).map((file) => ({
                        file,
                        path: (file.webkitRelativePath || file.name).replace(/\\/g, "/")
                      }));
                      const excluded = selected.map((entry) => ({ ...entry, reason: getImportExclusion(entry.path) })).filter((entry) => entry.reason);
                      const included = selected.filter((entry) => !getImportExclusion(entry.path));
                      const oversized = included.find(({ file }) => file.size > MAX_IMPORT_FILE_BYTES);
                      setSelectedImportFiles(selected);
                      setExcludedImportFiles(excluded);
                      setImportFiles(included);
                      setImportSizeError(oversized ? `${oversized.path} is too large (${oversized.file.size.toLocaleString()} bytes). The maximum is 5 MB per file.` : included.reduce((total, entry) => total + entry.file.size, 0) > MAX_IMPORT_TOTAL_BYTES ? "The project exceeds the 250 MiB total size limit." : "");
                    }}
                  />
                </label>
                {selectedImportFiles.length > 0 && (
                  <div>
                    <strong>{selectedImportFiles.length} files selected</strong> <span>{excludedImportFiles.length} excluded</span>
                    <button type="button" className="button button-secondary" onClick={() => { setSelectedImportFiles([]); setImportFiles([]); setExcludedImportFiles([]); setImportSizeError(""); setImportError(""); importInputRef.current.value = ""; }}>
                      Change files
                    </button>
                    <div style={{ maxHeight: "120px", overflowY: "auto", marginTop: "8px" }}>
                      <strong>Files to upload ({importFiles.length})</strong>
                      {importFiles.slice(0, 20).map((entry) => <div key={entry.path}>{entry.path}</div>)}
                      {importFiles.length > 20 && <small>...and {importFiles.length - 20} more files</small>}
                      {excludedImportFiles.length > 0 && (
                        <>
                          <strong>Excluded files</strong>
                          {excludedImportFiles.slice(0, 10).map((entry) => <div key={entry.path}>{entry.path} ({entry.reason})</div>)}
                          {excludedImportFiles.length > 10 && <small>...and {excludedImportFiles.length - 10} more excluded files</small>}
                        </>
                      )}
                    </div>
                  </div>
                )}
                {importSizeError && (
                  <div className="repo-message error" role="alert">
                    <AlertIcon size={16} className="error-icon" />
                    <span>{importSizeError}</span>
                  </div>
                )}
                {importError && (
                  <div className="repo-message error" role="alert">
                    <AlertIcon size={16} className="error-icon" />
                    <span>{importError}</span>
                  </div>
                )}
                <button className="button button-primary" disabled={importing}>
                  {importing ? "Importing..." : "Import project"}
                </button>
              </form>
            )}
            <form className="repo-form-card" onSubmit={handleCreate}>
              <label>
                Repository name <span>*</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => {
                    setForm({ ...form, name: e.target.value });
                    if (message.text) setMessage({ type: "", text: "" });
                    if (importError) setImportError("");
                  }}
                  placeholder="project-name"
                />
              </label>
              <label>
                Description <small>optional</small>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What are you building?"
                  rows="4"
                />
              </label>
              <fieldset>
                <legend>Visibility</legend>
                <label className="visibility-option">
                  <input type="radio" checked={form.visibility} onChange={() => setForm({ ...form, visibility: true })} />
                  <GlobeIcon size={17} />
                  <span><strong>Public</strong><small>Visible to everyone</small></span>
                </label>
                <label className="visibility-option">
                  <input type="radio" checked={!form.visibility} onChange={() => setForm({ ...form, visibility: false })} />
                  <LockIcon size={17} />
                  <span><strong>Private</strong><small>Visible only to you</small></span>
                </label>
              </fieldset>
              {message.text && (
                <div className={`repo-message ${message.type}`} role="alert">
                  {message.type === "error" ? <AlertIcon size={16} className="error-icon" /> : <CheckIcon size={16} />}
                  <span>{message.text}</span>
                </div>
              )}
              <button className="button button-primary" disabled={submitting}>
                <PlusIcon size={16} />{submitting ? "Creating..." : "Create repository"}
              </button>
            </form>
          </section>
          <aside className="repo-sidebar">
            <div className="sidebar-heading">
              <RepoIcon size={17} />
              <h2>Your repositories</h2>
            </div>
            {repositories.length ? repositories.map((item) => (
              <Link className="repo-sidebar-item" to={`/repo/${item._id}`} key={item._id}>
                <strong>{item.name}</strong>
                <span>{item.visibility ? "Public" : "Private"}</span>
              </Link>
            )) : <p className="muted">No repositories yet.</p>}
          </aside>
        </div>
      </main>
    </>
  );
};

export default Repo;