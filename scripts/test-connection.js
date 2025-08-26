const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

async function testConnection() {
    try {
        // Try both DB_URI and DB_URI1
        const mongoUri = process.env.DB_URI || process.env.DB_URI1;
        if (!mongoUri) {
            throw new Error('Neither DB_URI nor DB_URI1 found in .env');
        }

        console.log('Testing MongoDB connection...');
        console.log('Connection string:', mongoUri.replace(/:[^:]*@/, ':*****@')); // Hide password

        const conn = await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });

        console.log('✅ Successfully connected to MongoDB');
        console.log('Database name:', conn.connection.db.databaseName);
        
        // List all collections
        const collections = await conn.connection.db.listCollections().toArray();
        console.log('\nCollections:');
        collections.forEach(c => console.log(`- ${c.name}`));
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
        process.exit(1);
    }
}

testConnection();
