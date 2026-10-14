const Listing = require("./models/listing");
const Review = require("./models/review");
const ExpressError = require("./utils/ExpressError");
const { listingSchema, reviewSchema } = require("./schema.js");
const { bookingSchema } = require("./schema.js");


module.exports.isLoggedIn = (req, res, next) => {
    if (!req.isAuthenticated()) {
        req.session.returnTo = req.originalUrl;   // <--- save the route!
        req.flash("error", "You must be signed in!");
        return res.redirect("/login");
    }
    next();
};

      

module.exports.saveRedirectUrl = (req, res, next) => {
    if (req.session.returnTo) {
        res.locals.redirectUrl = req.session.returnTo;
    } else {
        res.locals.redirectUrl = "/listings"; // default redirect
    }
    next();
};

module.exports.isOwner = async (req, res, next) => {
    const { id } = req.params;
    const listing = await Listing.findById(id);
    if (!listing) {
        req.flash("error", "Listing not found.");
        return res.redirect("/listings");
    }
    if (!listing.owner.equals(req.user._id)) {
        req.flash("error", "You do not have permission to do that!");
        return res.redirect(`/listings/${id}`);
    }
    next();
};        

module.exports.validateListing = (req , res , next) =>{
    let {error} = listingSchema.validate(req.body);

    if(error){
        let errMsg = error.details.map((el) => el.message).join(", ");
        throw new ExpressError(errMsg, 400);
    }else{
        next();
    }
};   

module.exports.validateReview = (req , res , next) =>{
    let {error} = reviewSchema.validate(req.body);

    if(error){
        let errMsg = error.details.map((el) => el.message).join(", ");
        throw new ExpressError(errMsg, 400);
    }else{
        next();
    }
};   

module.exports.isReviewAuthor = async (req, res, next) => {
    const {id, reviewId } = req.params;
    const review = await Review.findById(reviewId);
    if (!review) {
        req.flash("error", "Review not found.");
        return res.redirect(`/listings/${id}`);
    }
    // If review has no author or the current user is not the author, deny
    if (!review.author) {
        req.flash("error", "Review author not found.");
        return res.redirect(`/listings/${id}`);
    }
    if (!review.author.equals(req.user._id)) {
        req.flash("error", "You do not have permission to do that!");
        return res.redirect(`/listings/${id}`);
    }
    next();
};      

module.exports.validateBooking = (req, res, next) => {
    const { error } = bookingSchema.validate(req.body);
    if (error) {
        const msg = error.details.map(el => el.message).join(',');
        throw new ExpressError(msg, 400);
    }
    next();
};

module.exports.isBookingAuthor = async (req, res, next) => {
    const { id, bookingId } = req.params;
    const Booking = require('./models/booking');
    const booking = await Booking.findById(bookingId);
    if (!booking) {
        req.flash('error', 'Booking not found.');
        return res.redirect(`/listings/${id}`);
    }
    if (!booking.user || !booking.user.equals(req.user._id)) {
        req.flash('error', 'You do not have permission to do that!');
        return res.redirect(`/listings/${id}`);
    }
    next();
};