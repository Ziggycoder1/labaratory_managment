require('dotenv').config({ path: '../../.env' });
const mongoose = require('mongoose');

async function testAtlasConnection() {
    try {
        // Get the connection string from environment variables
        const DB_URI = process.env.DB_URI1;
        
        if (!DB_URI) {
            throw new Error('DB_URI1 is not defined in .env file');
        }
        
        console.log('Testing MongoDB Atlas connection...');
        console.log('Connection string (sensitive info hidden):', 
            DB_URI.replace(/(mongodb\+srv:\/\/)[^:]+:[^@]+@/, '$1*****:*****@')
        );
        
        // Try to connect with a short timeout
        console.log('\nAttempting to connect...');
        await mongoose.connect(DB_URI, {
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 10000,
            family: 4,
            retryWrites: true,
            w: 'majority'
        });
        
        console.log('✅ Successfully connected to MongoDB Atlas!');
        console.log('Database name:', mongoose.connection.db.databaseName);
        
        // List all collections
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log(`\nFound ${collections.length} collections in the database:`);
        collections.forEach((col, index) => {
            console.log(`${index + 1}. ${col.name}`);
        });
        
        // Check if the items collection exists
        const itemsCollection = collections.find(col => col.name === 'items');
        if (itemsCollection) {
            const itemCount = await mongoose.connection.db.collection('items').countDocuments();
            console.log(`\nFound ${itemCount} items in the 'items' collection`);
        } else {
            console.log("\n'items' collection not found in the database");
        }
        
    } catch (error) {
        console.error('\n❌ Connection failed:', error.message);
        console.error('\nError details:', error);
        
        // Provide specific troubleshooting tips
        console.log('\nTroubleshooting steps:');
        console.log('1. Check your internet connection');
        console.log('2. Verify your MongoDB Atlas IP whitelist');
        console.log('   - Go to MongoDB Atlas → Network Access');
        console.log('   - Add your current IP address or 0.0.0.0/0 (not recommended for production)');
        console.log('3. Check if your MongoDB Atlas cluster is running');
        console.log('4. Verify your database credentials in .env');
        console.log('5. Try connecting with MongoDB Compass to verify credentials');
        
        process.exit(1);
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            console.log('\nDisconnected from MongoDB Atlas');
        }
        process.exit(0);
    }
}

// Run the test
testAtlasConnection();
