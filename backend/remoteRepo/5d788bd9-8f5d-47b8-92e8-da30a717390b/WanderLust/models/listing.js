const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const Review = require("./review.js");

const listingSchema = new Schema({
    title: {
        type: String,
        required: true,
        index: true
    },
    description: String,

    image: {
        filename: { 
            type: String,
            default: "listingimage",
        },

        url: {
            type: String,
            
            default: "https://unsplash.com/photos/a-view-of-rolling-hills-with-trees-in-the-foreground-cs-fGIqlKQs",
            set: (v) => 
             v ==="" ?
             "https://unsplash.com/photos/a-view-of-rolling-hills-with-trees-in-the-foreground-cs-fGIqlKQs"
             : v
        }
    },
    price: Number,
    location: {
        type: String,
        index: true
    },
    country: String,
    category: {
        type: String,
        enum: ["Trending", "Rooms", "Arctic", "Camping", "Iconic Cities", "Mountains", "Pools"],
        default: "Trending"
    },
    reviews: [{
        type: Schema.Types.ObjectId,
        ref: "Review"
    }],
    bookings: [{
        type: Schema.Types.ObjectId,
        ref: "Booking"
    }],
    owner: {
        type: Schema.Types.ObjectId,
        ref: "User"
    }
});

listingSchema.post("findOneAndDelete", async (listing) => {
    if(listing){
        await Review.deleteMany({_id : { $in: listing.reviews } });
        // remove any bookings associated with the listing as well
        const Booking = require('./booking');
        await Booking.deleteMany({_id: { $in: listing.bookings }});
    }
    
});    


const Listing = mongoose.model("Listing", listingSchema);
module.exports = Listing; 