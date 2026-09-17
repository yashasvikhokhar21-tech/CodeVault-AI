const express = require("express");
const mainrouter = express.Router();
const userrouter = require("./user.router");
const repoRouter = require("./repo.routers");
const issueRouter = require("./issue.routers");
const aiRouter = require("./ai.routers");

   mainrouter.get('/', (req, res) => {
        res.send('Hello, World!');
  });

  mainrouter.use(userrouter);
  mainrouter.use(repoRouter);
  mainrouter.use(issueRouter);
      mainrouter.use(aiRouter);

  module.exports = mainrouter;
