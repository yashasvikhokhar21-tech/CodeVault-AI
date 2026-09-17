const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { MongoClient } = require("mongodb");
const dotenv = require('dotenv');
dotenv.config();
var ObjectId = require("mongodb").ObjectId;
const uri = process.env.MONGODB_URI;

let client;
async function connectClient(){
    if(!client){
        client = new MongoClient(uri);
        await client.connect();
    }
}


async function signup(req, res) {
    console.log("Signup request body:", req.body);
   const { username, password , email } = req.body;
   try{
    await connectClient();
    const db = client.db("gitHubclone");
    const usersCollection = db.collection("users");

    const existingUser = await usersCollection.findOne({ username });
    if(existingUser) {
        return res.status(400).json({ message: "User already exists" });
   }
   const salt = await bcrypt.genSalt(10);
   const hashedPassword = await bcrypt.hash(password, salt);
   const newUser = {
       username,
       password: hashedPassword,
       email,
       repositories : [],
       followedUsers : [],
       starRepo : [],
   }
   const result = await usersCollection.insertOne(newUser);
   const token = jwt.sign({ id: result.insertedId }, process.env.JWT_SECRET, { expiresIn: '1h' });
   res.json({token , userId: result.insertedId});
}catch(error){
    console.log("INSIDE CATCH");
    console.error(error);
    res.status(500).send("server err");
}
};


async function login(req, res) {
  const { email, password, fullName, bio, location, company } = req.body;
  try {
    await connectClient();
    const db = client.db("gitHubclone");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials!" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials!" });
    }

    const token = jwt.sign({ id: user._id },  process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({ token, userId: user._id });
  } catch (err) {
    console.error("Error during login : ", err.message);
    res.status(500).send("Server error!");
  }
}

async function getAllUsers(req, res) {
  try {
    await connectClient();
    const db = client.db("gitHubclone");
    const usersCollection = db.collection("users");

    const users = await usersCollection.find({}).toArray();
    res.json(users);
  } catch (err) {
    console.error("Error during fetching : ", err.message);
    res.status(500).send("Server error!");
  }
}

async function getUserProfile(req, res) {
  const currentID = req.user.id;

  try {
    await connectClient();
    const db = client.db("gitHubclone");
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({
      _id: new ObjectId(currentID),
    });

    if (!user) {
      return res.status(404).json({ message: "User not found!" });
    }

    res.send(user );
  } catch (err) {
    console.error("Error during fetching : ", err.message);
    res.status(500).send("Server error!");
  }
}

async function updateUserProfile(req, res) {
  const currentID = req.params.id;
  const { email, fullName, bio, location, company } = req.body;

  if (req.user.id !== currentID) {
    return res.status(403).json({ message: "You can only update your own profile." });
  }

  try {
    await connectClient();
    const db = client.db("gitHubclone");
    const usersCollection = db.collection("users");

    const updateFields = {};
    if (email !== undefined) updateFields.email = email.trim();
    for (const [key, value] of Object.entries({ fullName, bio, location, company })) {
      if (value !== undefined) updateFields[key] = typeof value === "string" ? value.trim() : value;
    }

    if (!Object.keys(updateFields).length) {
      return res.status(400).json({ message: "No profile changes were provided." });
    }

    await usersCollection.findOneAndUpdate(
      {
        _id: new ObjectId(currentID),
      },
      { $set: updateFields }
    );

    const updatedUser = await usersCollection.findOne({
      _id: new ObjectId(currentID),
    });

    res.json(updatedUser);

  } catch (err) {
    console.error("Error during updating : ", err.message);
    res.status(500).json({ message: "Could not update profile." });
  }
}


async function deleteUserProfile(req, res) {
  const currentID = req.params.id;

  try {
    await connectClient();
    const db = client.db("gitHubclone");
    const usersCollection = db.collection("users");

    const result = await usersCollection.deleteOne({
      _id: new ObjectId(currentID),
    });

    if (result.deleteCount == 0) {
      return res.status(404).json({ message: "User not found!" });
    }

    res.json({ message: "User Profile Deleted!" });
  } catch (err) {
    console.error("Error during updating : ", err.message);
    res.status(500).send("Server error!");
  }
}


module.exports = {
    
    signup,
    login,
    getAllUsers,
    getUserProfile,
    updateUserProfile,
    deleteUserProfile
};