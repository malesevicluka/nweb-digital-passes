import { createStore } from './store.js';
import { createApp } from './app.js';

const required = [
  'BASE_URL', 'DATABASE_URL', 'AUTH0_ISSUER_BASE_URL',
  'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_AUDIENCE', 'SESSION_SECRET'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters');
}

const config = {
  baseURL: process.env.BASE_URL.replace(/\/$/, ''),
  issuer: process.env.AUTH0_ISSUER_BASE_URL,
  clientID: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  audience: process.env.AUTH0_AUDIENCE,
  sessionSecret: process.env.SESSION_SECRET
};

const store = createStore(process.env.DATABASE_URL);
await store.init();

const app = createApp({ store, config });
const server = app.listen(process.env.PORT || 3000, function () {
  console.log('Pass application started');
});

function shutdown() {
  server.close(async function () {
    await store.close();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
