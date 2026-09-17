const mongoose = require("mongoose");
const Repository = require("../models/repoModel.js");
const Issue = require("../models/issueModel.js");

async function createIssue(req, res) {
  const { repoId } = req.params;
  const { title, description, status } = req.body;

  try {
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Issue title is required!" });
    }

    const repository = await Repository.findById(repoId);

    if (!repository) {
      return res.status(404).json({ error: "Repository not found!" });
    }

    const issue = new Issue({
      title: title.trim(),
      description: description?.trim() || "",
      status: status || "open",
      repository: repoId,
    });

    const savedIssue = await issue.save();

    repository.issues.push(savedIssue._id);
    await repository.save();

    res.status(201).json(savedIssue);
  } catch (err) {
    console.error("Error during issue creation : ", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

async function updateIssueById(req, res) {
  const { id } = req.params;
  const { title, description, status } = req.body;

  try {
    const issue = await Issue.findById(id);

    if (!issue) {
      return res.status(404).json({ error: "Issue not found!" });
    }

    if (title !== undefined) issue.title = title.trim();
    if (description !== undefined) issue.description = description.trim();
    if (status !== undefined) issue.status = status;

    const updatedIssue = await issue.save();

    res.json({ message: "Issue updated", issue: updatedIssue });
  } catch (err) {
    console.error("Error during issue updation : ", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

async function deleteIssueById(req, res) {
  const { id } = req.params;

  try {
    const issue = await Issue.findByIdAndDelete(id);

    if (!issue) {
      return res.status(404).json({ error: "Issue not found!" });
    }

    await Repository.findByIdAndUpdate(issue.repository, {
      $pull: { issues: issue._id },
    });

    res.json({ message: "Issue deleted" });
  } catch (err) {
    console.error("Error during issue deletion : ", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

async function getAllIssues(req, res) {
  const { repoId } = req.params;

  try {
    const issues = await Issue.find({ repository: repoId }).sort({ createdAt: -1 });
    res.status(200).json(issues);
  } catch (err) {
    console.error("Error during issue fetching : ", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

async function getIssueById(req, res) {
  const { id } = req.params;

  try {
    const issue = await Issue.findById(id);

    if (!issue) {
      return res.status(404).json({ error: "Issue not found!" });
    }

    res.json(issue);
  } catch (err) {
    console.error("Error during issue lookup : ", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

module.exports = {
  createIssue,
  updateIssueById,
  deleteIssueById,
  getAllIssues,
  getIssueById,
};