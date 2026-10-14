const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '.env') });
const dns = require('node:dns');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { initRepo } = require('./controllers/init');
const { addRepo } = require('./controllers/add');
const { commitRepo } = require('./controllers/commit');
const { pushRepo } = require('./controllers/push');
const { pullrepo } = require('./controllers/pull');
const { revertRepo } = require('./controllers/revert');
const mainrouter = require('./routes/main.routers');
const { parser: cliParser } = require('./cli');

const cliArgs = hideBin(process.argv);
if (!cliArgs.length || cliArgs[0] === 'start') {
    startApp();
} else {
    cliParser.parse();
}

function startApp() {
    const app = express();

    app.use((req, res, next) => {
        console.log("REQUEST:", req.method, req.url);
        next();
    });

    const port = process.env.PORT || 3000;

    app.use((req, res, next) => {
        console.log("METHOD:", req.method);
        console.log("URL:", req.url);
        console.log("CONTENT-TYPE:", req.headers["content-type"]);
        next();
    });

    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));

    const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/github-clone';
    const mongoDnsFallbackServers = (process.env.MONGODB_DNS_FALLBACK_SERVERS || '8.8.8.8,8.8.4.4')
        .split(',')
        .map((server) => server.trim())
        .filter(Boolean);
    const connectToMongo = async () => {
        let attempt = 0;
        while (mongoose.connection.readyState !== 1) {
            attempt += 1;
            try {
                await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 });
                console.log('Connected to MongoDB');
                return;
            } catch (error) {
                const code = error.code || error.cause?.code || 'unknown';
                const detail = String(error.message || 'No additional details.')
                    .replaceAll(mongoURI, '[REDACTED_MONGODB_URI]')
                    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[REDACTED_MONGODB_URI]')
                    .slice(0, 500);
                if (code === 'ECONNREFUSED' && /querySrv/i.test(error.message || '') && mongoDnsFallbackServers.length) {
                    dns.setServers([...new Set([...dns.getServers(), ...mongoDnsFallbackServers])]);
                    console.error('MongoDB SRV lookup refused by the system resolver; enabled process-local fallback resolvers.');
                }
                if (attempt === 1 || attempt % 5 === 0) {
                    console.error(`MongoDB connection attempt ${attempt} failed: ${error.name} (${code}): ${detail}; retrying`);
                }
                await mongoose.disconnect().catch(() => {});
                const delay = Math.min(1000 * (2 ** Math.min(attempt - 1, 5)), 30000);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    };
    void connectToMongo();

    app.use(cors({ origin: '*' }));
    app.use('/', mainrouter);

    app.use((err, req, res, next) => {
        if (err && (err.type === 'entity.too.large' || err.status === 413)) {
            return res.status(413).json({
                error: 'Payload Too Large: The commit payload exceeds the server limit of 50MB. Please commit fewer or smaller files.',
            });
        }
        next(err);
    });

    let user = 'test';
    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        socket.on('joinRoom', (userId) => {
            user = userId;
            console.log('=====');
            console.log(user);
            console.log('=====');
            socket.join(userId);
        });
    });

    const db = mongoose.connection;

    db.once('open', async () => {
        console.log('crud operations');
    });

    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use. The backend may already be running.`);
            return;
        }
        console.error('Backend server error:', error.message);
    });

    httpServer.listen(port, () => {
        console.log(`Server is running on port ${port}; MongoDB readiness: ${mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'}`);
    });
}