const User = require("../models/user.js");


module.exports.renderSignupForm = async (req , res, next) =>{
    try{
        let {username, email, password} = req.body;
        let newUser = new User({username, email});
        let registeredUser = await User.register(newUser, password);
        console.log(registeredUser);
       
        req.login(registeredUser, err =>{
            if(err) return next(err);
            req.flash("success", "Welcome to the App!");
            res.redirect(res.locals.redirectUrl || "/listings");
        });
    }catch(e){
        req.flash("error", e.message);
        res.redirect("/signup");
    }
   
}

module.exports.renderLoginForm = (req , res) =>{
    res.render("users/login.ejs");
}

module.exports.login = (req, res) => {
        req.flash("success", "Welcome back!");
        const redirectUrl = res.locals.redirectUrl || "/listings";
        delete req.session.returnTo;  // <--- optional but recommended
        res.redirect(redirectUrl);
    }

module.exports.logout = (req , res, next) =>{
    req.logout(function(err) {
        if (err) { return next(err); }
        req.flash("success", "Logged you out!");
        res.redirect("/listings");
      });
}    