// Single shared pg Pool used by both Better Auth and Drizzle so there is one
// connection and one source of truth.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalForDb = globalThis;

export const pool =
  globalForDb.__taprinoPool ?? new Pool({ connectionString: process.env.DATABASE_URL });

if (!globalForDb.__taprinoPool) {
  globalForDb.__taprinoPool = pool;
}

export const db = drizzle(pool, { schema });
