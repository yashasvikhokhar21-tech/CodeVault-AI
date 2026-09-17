require("dotenv").config();


const express = require("express");
const app = express();
const mongoose = require("mongoose");
//const MONGO_URl = "mongodb://127.0.0.1:27017/wanderlust" ;
const dbUrl = process.env.ATLASDB_URL;

// Validate database URL
if (!dbUrl) {
    console.error("ERROR: ATLASDB_URL environment variable is not set!");
    console.error("Please set ATLASDB_URL in your .env file");
    process.exit(1);
}

// Track connection state
let dbConnected = false;

// Monitor mongoose connection
mongoose.connection.on('connected', () => {
    console.log('Mongoose connected to MongoDB');
    dbConnected = true;
});

mongoose.connection.on('disconnected', () => {
    console.warn('Mongoose disconnected from MongoDB');
    dbConnected = false;
});

mongoose.connection.on('error', (err) => {
    console.error('Mongoose connection error:', err);
    dbConnected = false;
});


const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const ExpressError = require("./utils/ExpressError.js");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user.js");


const listingRouter = require("./routes/listing.js");
const reviewRouter = require("./routes/review.js");
const bookingRouter = require("./routes/booking.js");
const userRouter = require("./routes/user.js");
const chatRouter = require("./routes/chat.js");



// register ejs-mate as the engine for .ejs files
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({extended: true}));
// Parse JSON bodies for API endpoints (chat uses application/json)
app.use(express.json());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));
// serve the uploads directory on a named path so we do not accidentally
// conflict with other root-level routes
app.use('/uploads', express.static(path.join(__dirname, "uploads"))); // Serve uploaded files


app.use((req, res, next) => {
    console.log("req.user =>", req.user);
    next();
});

// Health check endpoint - always available
app.get("/health", (req, res) => {
    res.json({ status: "ok", dbConnected });
});

const store = MongoStore.create({
    mongoUrl: dbUrl,
    
    crypto: {
        secret: process.env.SECRET,
    },
    touchAfter: 24 * 60 * 60 // time period in seconds
});

store.on("error", function(e){
    console.log("Session store error", e);
});

const sessionOptions = {
    store,
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
    cookie : {
        expires: Date.now() + 1000 * 60 * 60 * 24 *7,
        maxAge: 1000 * 60 * 60 * 24 *7,
        httpOnly: true,
    }
};

const Listing = require("./models/listing.js");

app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

// Check database connection before processing requests (except health)
app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/check") {
        return next();
    }
    if (!dbConnected) {
        return res.status(503).json({ error: "Database connection not established. Please try again." });
    }
    next();
});

app.get("/check", (req, res) => {
    res.send(req.user);
});

app.use((req , res , next) =>{
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.currentUser = req.user || null;
    next();
});

app.use("/listings", listingRouter);
app.use("/listings/:id/review", reviewRouter);
app.use("/listings/:id/bookings", bookingRouter);
app.use("/", userRouter);
app.use('/chat', chatRouter);

passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());




app.get("/" , async (req , res) =>{
    try{
        // show a few listings on the homepage
        const listings = await Listing.find({}).limit(6);
        res.render("home", { listings });
    } catch (e) {
        console.error(e);
        res.render("home", { listings: [] });
    }
});





async function main(){
    await mongoose.connect(dbUrl, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
    });
}

main().then(() => {
    console.log("Connected to database");
    dbConnected = true;

    // Start server AFTER database is connected
    app.listen(8080, () => {
        console.log("Server is running on port 8080");
    });
}).catch(err => {
    console.error("Database connection failed:", err);
    console.error("Make sure Atlas IP whitelist includes this machine and ATLASDB_URL is correct.");
    console.error("Database URL:", dbUrl.replace(/([\w.]+:[\w.-]+@)/, '***:***@'));
    process.exit(1);
});

app.get("/demoUser", async (req, res) => {
    let fakeUser = new User({
        email : "student@gmail.com",
        username: "demoUser"
        
    });

    let registeredUser = await User.register(fakeUser, "helloworld");
    res.send(registeredUser);
});








app.use((err, req, res, next) =>{
    let {statusCode=500, message="Something went wrong"} = err;
    res.status(statusCode).render("Error.ejs", {message});
    // res.status(statusCode).send(message);
    
});