import pg from 'pg';

const { Pool } = pg;

// Reserved for future persistence features. Objective 1 does not query the database.
export function createDatabasePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({ connectionString: process.env.DATABASE_URL });
}

