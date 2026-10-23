/**
 * MongoDB connection and collection setup, shared by the CLI tools and the
 * Next.js server. One client per process (cached on globalThis so Next's
 * dev-mode hot reload doesn't open a new pool on every edit).
 *
 * Collections:
 *   reviews      one document per review, _id = content fingerprint
 *   properties   one per hotel: Booking.com headline score/count, last collection time
 *   scrape_runs  one per property per collection run: counts, warnings, errors
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGODB_DB || 'azzurro_reviews';

const cache = globalThis.__azzurroMongo || (globalThis.__azzurroMongo = { client: null, promise: null, indexed: false });

export async function getDb() {
  if (!cache.promise) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    cache.promise = client.connect().then((c) => {
      cache.client = c;
      return c;
    }).catch((err) => {
      cache.promise = null;
      throw new Error(`Could not connect to MongoDB at ${uri.replace(/\/\/[^@]*@/, '//***@')} (${err.message}). Is it running? See README "Setup".`);
    });
  }
  const client = await cache.promise;
  const db = client.db(dbName);
  if (!cache.indexed) {
    await ensureIndexes(db);
    cache.indexed = true;
  }
  return db;
}

export async function closeDb() {
  if (cache.client) await cache.client.close();
  cache.client = null;
  cache.promise = null;
  cache.indexed = false;
}

async function ensureIndexes(db) {
  await Promise.all([
    db.collection('reviews').createIndexes([
      { key: { property: 1, reviewDate: -1 } },
      { key: { reviewDate: -1 } },
      { key: { 'topics.complaints': 1, reviewDate: -1 } },
      { key: { property: 1, reviewerKey: 1, stayMonth: 1, reviewDate: 1 } },
    ]),
    db.collection('scrape_runs').createIndexes([{ key: { startedAt: -1 } }, { key: { property: 1, startedAt: -1 } }]),
  ]);
}
