const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const cors = require('cors');
const moongoose = require('mongoose');
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
const argv = yargs(hideBin(process.argv))
    .command('start', 'Start the application', {}, startApp)
    .command('init', 'Initialize a new repository', {}, initRepo)
    .command('add <filename>', 'Add file contents', (yargs) => {
        yargs.positional('filename', {
            describe: 'file adding to the staging area',
            type: 'string'
        });
    }, (argv) => {
        addRepo(argv.filename);
    })
    .command('commits <message>', 'Commit staged changes', (yargs) => {
        yargs.positional('message', {
            describe: 'commit message',
            type: 'string'
        });
    }, (argv) => {
        commitRepo(argv.message);
    })
    .command('push', 'Push changes to remote repository', {}, pushRepo)
    .command(
        'push',
        'Push commits to remote repository',
        () => {},
        () => {
            pushRepo();
        }
    )
    .command('pull', 'Pull latest changes from remote repository', {}, pullrepo)
    .command('revert <commitId>', 'Revert a commit', (yargs) => {
        yargs.positional('commitId', {
            describe: 'commit id to revert',
            type: 'string'
        });
    }, (argv) => {
        revertRepo(argv.commitId);
    })
    .help()
    .strict(false);

const cliArgs = hideBin(process.argv);
if (!cliArgs.length || cliArgs[0] === 'start') {
    startApp();
} else {
    argv.parse();
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

      // app.use(bodyParser.json());
       app.use(express.json());
        const mongoURI = process.env.MONGODB_URI;
        moongoose.connect(mongoURI).then(() => 
            console.log('Connected to MongoDB')).catch((err) => {
                console.error('Error connecting to MongoDB:', err);
            });
            app.use(cors({origin: '*'}));
            
            app.use('/', mainrouter);
         
            
            let user = "test";
            const httpServer = http.createServer(app);
            const io = new Server(httpServer, {
                cors: {
                    origin: '*',
                    methods: ['GET', 'POST']
                }
            });

            io.on('connection' , (socket) => {
               socket.on('joinRoom' , (useID) => {
                user = userID;
                console.log("=====");
                console.log(user);
                console.log("=====");
                socket.join(userID);
               });
            });

            const db = moongoose.connection;

            db.once('open' , async ()=> {
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
                console.log(`Server is running on port ${port}`);
            });
        }