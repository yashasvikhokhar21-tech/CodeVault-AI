const express = require("express");
const router = express.Router();
const User = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const passport = require("passport");
const {saveRedirectUrl} = require("../middleware.js");

const usersController = require("../controllers/users.js");
const user = require("../models/user.js");


router.get("/signup", (req , res) =>{
    res.render("users/signup.ejs");
});

router.post("/signup", wrapAsync(usersController.renderSignupForm));


router.route("/login")
.get(usersController.renderLoginForm )
.post(
    saveRedirectUrl,   // <--- MUST come before passport.authenticate
    passport.authenticate("local", {
        failureFlash: true,
        failureRedirect: "/login"
    }),
    usersController.login
);


router.get("/logout", usersController.logout );


module.exports = router;