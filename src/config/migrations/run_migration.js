const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

async function runMigration() {
    let connection;
    try {
        // Create connection
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'laboratory_db',
            multipleStatements: true // Allow multiple statements
        });

        console.log('Connected to database');

        // Read migration file
        const migrationPath = path.join(__dirname, 'update_items_table.sql');
        const migrationSQL = await fs.readFile(migrationPath, 'utf8');

        // Run migration
        console.log('Running migration...');
        await connection.query(migrationSQL);
        console.log('Migration completed successfully');

    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
            console.log('Database connection closed');
        }
    }
}

// Run the migration
runMigration().catch(console.error); 