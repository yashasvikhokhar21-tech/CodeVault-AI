import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { connectToSocket } from "./controllers/socketManager.js";
import cors from "cors";
import userRoutes from "./routes/users.routes.js";

const app = express();
const server = createServer(app);
const io = connectToSocket(server);

app.set("port", (process.env.PORT || 8000))
app.use(cors());
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));
app.use("/api/v1/users", userRoutes);

const start = async () => {
    const mongoUri = process.env.MONGO_URL || "mongodb+srv://yashasvikhokhar654_db_user:yashasvi%40123@videocall.ncryup5.mongodb.net/?appName=VideoCall";
    const connectionDb = await mongoose.connect(
        mongoUri,
        {
            family: 4,
            serverSelectionTimeoutMS: 30000,
            connectTimeoutMS: 30000,
        }
    );
    console.log(`MONGO Connected DB Host: ${connectionDb.connection.host}`)
    server.listen(app.get("port"), () => {
        console.log("LISTENING ON PORT 8000")
    });
}

start();