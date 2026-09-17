const Listing = require("../models/listing");

module.exports.index = async(req , res) =>{
    try {
        // Support optional location search via query string: /listings?location=Paris
        const { location } = req.query;
        const filter = {};
        let locationQuery = null;
        if(location && location.trim().length){
            // Escape user input for safe regex
            const escaped = location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(escaped, 'i');
            filter.location = regex;
            locationQuery = location;
        }
        // Use lean() for better performance on find operations
        const allListings = await Listing.find(filter).lean();
        res.render("listings/index.ejs", {allListings, locationQuery});
    } catch (err) {
        console.error("Error fetching listings:", err);
        res.status(500).render("Error.ejs", { message: "Failed to load listings. Please try again." });
    }
}

module.exports.renderNewForm = (req , res) =>{
    if(!req.isAuthenticated()){
        req.flash("error", "You must be signed in first!");
        return res.redirect("/login");
    }
    res.render("listings/new.ejs");
}

module.exports.showListing  = async(req , res) =>{
    let {id} = req.params;
    const listing = await Listing.findById(id)
    .populate({
        path : "reviews",
        populate : {
            path : "author"
        }
    })
    .populate("owner")
    .populate({
        path: 'bookings',
        populate: {
            path: 'user'
        }
    });

    if(!listing){
        req.flash("error", "Cannot find that listing!");
        return res.redirect("/listings");
    }
    console.log(listing);
    res.render("listings/show.ejs", {listing});

}

module.exports.createListing = async(req , res) =>{
        try {
            let listingData = req.body.listing;
            // debug info
            console.log('body:', req.body);
            console.log('file:', req.file);

            // Joi validation has already run in middleware

            // Normalize simple string url into object form
            if(typeof listingData.image === 'string'){
                listingData.image = { url: listingData.image || '' };
            }

            // If a file was uploaded, it takes precedence over any url value
            if(req.file){
                // multer-storage-cloudinary attaches `path` or `secure_url`;
                // disk storage uses filename+uploads prefix.
                const url = req.file.path || req.file.secure_url || "/uploads/" + req.file.filename;
                listingData.image = { 
                    filename: req.file.filename,
                    url
                };
            } else {
                // make sure url property exists on object even if empty
                listingData.image = listingData.image || {};
            }

            const newListing = new Listing(listingData);
            newListing.owner = req.user._id;
            await newListing.save();
            req.flash("success", "Successfully made a new listing!");
            res.redirect("/listings");
            console.log(newListing);
        } catch (err) {
            console.error("Error creating listing:", err);
            req.flash("error", "Failed to create listing: " + err.message);
            res.redirect("/listings/new");
        }
}

module.exports.renderEditForm  = async(req , res) =>{
    let {id} = req.params;
    const listing = await Listing.findById(id);
    if(!listing){
        req.flash("error", "Cannot find that listing!");
        return res.redirect("/listings");
    }
    res.render("listings/edit.ejs", {listing});
}

module.exports.updateListing  = async (req, res) => {

    const { id } = req.params;
    const listingData = req.body.listing;
    console.log('update body:', req.body);
    console.log('update file:', req.file);

    // Get current listing to check if it exists
    const currentListing = await Listing.findById(id);
    if (!currentListing) {
        req.flash("error", "Listing not found.");
        return res.redirect("/listings");
    }

    // normalize string url same as createListing
    if(typeof listingData.image === 'string'){
        listingData.image = { url: listingData.image || '' };
    }

    if(req.file){
        const url = req.file.path || req.file.secure_url || "/uploads/" + req.file.filename;
        listingData.image = {
            filename: req.file.filename,
            url
        };
    } else if (listingData.image && listingData.image.url && listingData.image.url.trim() !== '') {
        // Only update image if a valid URL is provided
        // Otherwise, remove from update data to preserve existing image
        // This handles cases where form sends empty image URL field
    } else {
        delete listingData.image;
    }

    await Listing.findByIdAndUpdate(id, listingData);
    req.flash("success", "Successfully updated the listing!");
    res.redirect(`/listings/${id}`);
}

module.exports.deleteListing = async(req , res) =>{
    let {id} = req.params;
    await Listing.findByIdAndDelete(id);
    req.flash("success", "Successfully deleted the listing!");
    res.redirect("/listings");
}
