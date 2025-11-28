const { Pool } = require('pg');
require('dotenv').config();

// Build connection string when DATABASE_URL is not explicitly set.
const connectionString = process.env.DATABASE_URL || (function () {
	const user = process.env.DB_USER || 'postgres';
	const password = process.env.DB_PASSWORD || '';
	const host = process.env.DB_HOST || 'localhost';
	const port = process.env.DB_PORT || 5432;
	const database = process.env.DB_NAME || 'drive_db';
	// Safely encode the DB name because user might have spaces
	const safeDb = encodeURIComponent(database);
	if (password) return `postgresql://${user}:${password}@${host}:${port}/${safeDb}`;
	return `postgresql://${user}@${host}:${port}/${safeDb}`;
})();

const pool = new Pool({ connectionString });

module.exports = pool;