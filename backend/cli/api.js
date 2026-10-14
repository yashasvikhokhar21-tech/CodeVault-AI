const { getGlobalConfig, getLocalConfig, DEFAULT_API_URL } = require("./core");

async function getApiContext(repoRoot = null) {
  const globalConfig = await getGlobalConfig();
  let localConfig = {};
  if (repoRoot) {
    localConfig = await getLocalConfig(repoRoot);
  }

  const apiUrl = localConfig.remoteUrl || globalConfig.apiUrl || DEFAULT_API_URL;
  const token = localConfig.token || globalConfig.token || null;
  const userId = localConfig.userId || globalConfig.userId || null;
  const repositoryId = localConfig.repositoryId || null;

  return { apiUrl, token, userId, repositoryId, localConfig, globalConfig };
}

async function apiRequest(endpoint, { method = "GET", body = null, token = null, apiUrl = DEFAULT_API_URL, headers: customHeaders = {} } = {}) {
  const url = `${apiUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
  const headers = { ...customHeaders };
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Network error: Unable to connect to CodeVault backend at ${apiUrl}. Please make sure the server is running.`);
  }

  let data;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    const errorMsg = (typeof data === "object" && data !== null && (data.error || data.message))
      ? (data.error || data.message)
      : `HTTP ${response.status}: ${response.statusText}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function resolveRemoteRepo(identifier, { token, apiUrl = DEFAULT_API_URL } = {}) {
  if (!identifier || typeof identifier !== "string") {
    throw new Error("Repository identifier is required. Please provide a repository ID or name.");
  }

  let cleanId = identifier.trim();
  const urlMatch = cleanId.match(/\/repo\/([a-fA-F0-9]{24})/);
  if (urlMatch) {
    cleanId = urlMatch[1];
  }

  const isObjectId = /^[0-9a-fA-F]{24}$/.test(cleanId);
  let repoData = null;

  if (isObjectId) {
    try {
      repoData = await apiRequest(`/repo/${cleanId}`, { token, apiUrl });
    } catch (err) {
      if (err.status === 404) {
        throw new Error(`Repository with ID '${cleanId}' was not found on remote.`);
      }
      throw err;
    }
  }

  if (!repoData) {
    let nameResults;
    try {
      nameResults = await apiRequest(`/repo/name/${encodeURIComponent(cleanId)}`, { token, apiUrl });
    } catch (err) {
      if (err.status === 404) {
        throw new Error(`Repository '${cleanId}' was not found on remote.`);
      }
      throw err;
    }

    if (Array.isArray(nameResults)) {
      if (nameResults.length === 0) {
        throw new Error(`Repository '${cleanId}' was not found on remote.`);
      }
      repoData = nameResults[0];
    } else if (nameResults && typeof nameResults === "object") {
      repoData = nameResults;
    }
  }

  if (!repoData || !repoData._id || !/^[0-9a-fA-F]{24}$/.test(String(repoData._id))) {
    throw new Error(`Could not resolve a valid CodeVault repository ID for '${identifier}'.`);
  }

  return {
    id: String(repoData._id),
    name: repoData.name || cleanId,
    description: repoData.description || "",
    visibility: repoData.visibility,
    owner: repoData.owner,
  };
}

module.exports = {
  getApiContext,
  apiRequest,
  resolveRemoteRepo,
};
