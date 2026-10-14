const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat');

router.post('/', chatController.chat);

module.exports = router;
