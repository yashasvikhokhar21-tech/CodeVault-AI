const Listing = require("../models/listing");
const Review = require("../models/review");

module.exports.createReview = async(req , res) =>{
    console.log(req.params);
    let listing = await Listing.findById(req.params.id);
    // create review and attach current user as author before saving
    let review = new Review(req.body.review);
    review.author = req.user._id;
    let newReview = await review.save();
    // push the review id into the listing's reviews array
    listing.reviews.push(newReview._id);
    await listing.save();
    req.flash("success", "Created new review!");
    res.redirect(`/listings/${listing._id}`);
    
}

module.exports.deleteReview = async(req , res) =>{
    let {id , reviewId} = req.params;
    await Listing.findByIdAndUpdate(id , {$pull : {reviews : reviewId}});
    await Review.findByIdAndDelete(reviewId);
    req.flash("success", "Successfully deleted review!");
    res.redirect(`/listings/${id}`);
}
