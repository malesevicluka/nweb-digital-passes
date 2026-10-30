import pg from 'pg';

export function createStore(connectionString) {
  const pool = new pg.Pool({ connectionString });
  const fields = 'id, name, document, issued_at AS "issuedAt", status';

  function validId(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS passes (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL,
          document TEXT NOT NULL,
          issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status TEXT NOT NULL DEFAULT 'ACTIVE'
            CHECK (status IN ('ACTIVE', 'CANCELLED'))
        )
      `);
    },

    async counts() {
      const result = await pool.query(`
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active
        FROM passes
      `);
      return result.rows[0];
    },

    async list() {
      const result = await pool.query(`SELECT ${fields} FROM passes ORDER BY issued_at DESC`);
      return result.rows;
    },

    async get(id) {
      if (!validId(id)) return null;
      const result = await pool.query(`SELECT ${fields} FROM passes WHERE id = $1`, [id]);
      return result.rows[0];
    },

    async create(id, name, document) {
      const result = await pool.query(`
        INSERT INTO passes (id, name, document) VALUES ($1, $2, $3)
        RETURNING ${fields}
      `, [id, name, document]);
      return result.rows[0];
    },

    async cancel(id) {
      if (!validId(id)) return false;
      const result = await pool.query(
        "UPDATE passes SET status = 'CANCELLED' WHERE id = $1", [id]
      );
      return result.rowCount > 0;
    },

    async delete(id) {
      if (!validId(id)) return false;
      const result = await pool.query('DELETE FROM passes WHERE id = $1', [id]);
      return result.rowCount > 0;
    },

    async close() {
      await pool.end();
    }
  };
}
