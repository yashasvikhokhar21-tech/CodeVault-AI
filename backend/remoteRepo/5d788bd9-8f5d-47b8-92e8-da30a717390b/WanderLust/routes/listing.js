const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync.js");

const Listing = require("../models/listing.js");
const { isLoggedIn, isOwner , validateListing} = require("../middleware.js");

const listingsController = require("../controllers/listings.js");
const multer = require("multer");
const { storage } = require("../cloudConfig.js");
const upload = multer({ storage });
const path = require("path");

// choose storage: prefer Cloudinary when credentials exist
// let upload;
// if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_KEY && process.env.CLOUDINARY_SECRET) {
//     try {
//         const { storage } = require("../cloudConfig.js");
//         upload = multer({ storage });
//     } catch (err) {
//         console.warn("cloudConfig init failed, falling back to disk:", err.message);
//     }
// }
// if (!upload) {
//     const diskStorage = multer.diskStorage({
//         destination: path.join(__dirname, "..", "uploads"),
//         filename: (req, file, cb) => {
//             const ext = path.extname(file.originalname);
//             cb(null, Date.now() + ext);
//         }
//     });
//     upload = multer({ storage: diskStorage });
// }

// Index Route and Create Route  combined
router.route("/")
.get( wrapAsync(listingsController.index))
.post(isLoggedIn, 
    upload.single("image"), 
    validateListing, 
    wrapAsync(listingsController.createListing)
);

// New Route 2a (must be before dynamic :id)
router.get("/new", isLoggedIn, listingsController.renderNewForm);

 //Show Route 1 and Update Route 3b and Delete route all combined
router.route("/:id")
.get(wrapAsync(listingsController.showListing))
.put(
    
    isLoggedIn, 
    isOwner,
    upload.single("image"),
    validateListing, 
    wrapAsync(listingsController.updateListing))
.delete(isLoggedIn, isOwner, wrapAsync(listingsController.deleteListing));    


// (duplicate new route removed)


//Edit Route  3a
router.get("/:id/edit", isLoggedIn, isOwner, wrapAsync(listingsController.renderEditForm));


module.exports = router;
