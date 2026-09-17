const express = require("express");
const issueController = require("../controllers/issue.js");

const issueRouter = express.Router();

issueRouter.post("/repo/:repoId/issues", issueController.createIssue);
issueRouter.get("/repo/:repoId/issues", issueController.getAllIssues);
issueRouter.get("/issue/:id", issueController.getIssueById);
issueRouter.put("/issue/:id", issueController.updateIssueById);
issueRouter.delete("/issue/:id", issueController.deleteIssueById);

issueRouter.post("/issue/create", issueController.createIssue);
issueRouter.get("/issue/all", issueController.getAllIssues);
issueRouter.put("/issue/update/:id", issueController.updateIssueById);
issueRouter.delete("/issue/delete/:id", issueController.deleteIssueById);

module.exports = issueRouter;