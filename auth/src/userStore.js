import pg from 'pg';

const { Pool } = pg;

export class UsernameTakenError extends Error {}

/** PostgreSQL-backed account storage. All queries are parameterized. */
export function createPostgresUserStore(connectionString) {
  const pool = new Pool({ connectionString });

  return {
    async init({ attempts = 30, delayMs = 1000 } = {}) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
              id            BIGSERIAL PRIMARY KEY,
              username      VARCHAR(20) NOT NULL,
              password_hash TEXT NOT NULL,
              created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
          await pool.query(
            'CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username))',
          );
          return;
        } catch (error) {
          if (attempt >= attempts) throw error;
          console.warn(`Database not ready (attempt ${attempt}): ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    },

    async create(username, passwordHash) {
      try {
        const { rows } = await pool.query(
          'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
          [username, passwordHash],
        );
        return rows[0];
      } catch (error) {
        if (error.code === '23505') throw new UsernameTakenError();
        throw error;
      }
    },

    async findByUsername(username) {
      const { rows } = await pool.query(
        'SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER($1)',
        [username],
      );
      return rows[0] ?? null;
    },

    async ping() {
      await pool.query('SELECT 1');
    },

    async close() {
      await pool.end();
    },
  };
}

/** In-memory store with the same interface, used by the automated tests. */
export function createMemoryUserStore() {
  const users = new Map();
  let nextId = 1;

  return {
    async init() {},
    async create(username, passwordHash) {
      const key = username.toLowerCase();
      if (users.has(key)) throw new UsernameTakenError();
      const user = { id: String(nextId++), username, password_hash: passwordHash };
      users.set(key, user);
      return { id: user.id, username };
    },
    async findByUsername(username) {
      return users.get(username.toLowerCase()) ?? null;
    },
    async ping() {},
    async close() {},
  };
}
