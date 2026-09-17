const express = require("express");
const userrouter = express.Router();
const userController = require("../controllers/user.js");
const { requireAuth } = require("../middlewares/authMiddleware.js");

userrouter.get('/Allusers', userController.getAllUsers);
userrouter.post('/signup', userController.signup);
userrouter.post('/login', userController.login);
userrouter.get('/userprofile/:id', requireAuth, userController.getUserProfile);
userrouter.put('/updateProfile/:id', requireAuth, userController.updateUserProfile);
userrouter.delete('/deleteProfile/:id', requireAuth, userController.deleteUserProfile);

module.exports = userrouter;