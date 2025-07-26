const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Configuration
const config = {
  // Use the MongoDB Atlas connection string from .env
  uri: process.env.DB_URI1,
  // Using 'test' as the default database name since that's what's available
  dbName: 'test', // Default database name
  backupDir: path.join(__dirname, '../../database_backups'),
  timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
};

console.log('Using database:', config.dbName);

// Create backup directory
const backupPath = path.join(config.backupDir, config.timestamp);
if (!fs.existsSync(backupPath)) {
  fs.mkdirSync(backupPath, { recursive: true });
  console.log(`Created backup directory: ${backupPath}`);
}

async function listDatabases(client) {
  const adminDb = client.db('admin');
  const result = await adminDb.admin().listDatabases();
  console.log('\nAvailable databases:');
  result.databases.forEach(db => console.log(`- ${db.name}`));
  return result.databases.map(db => db.name);
}

async function backupDatabase() {
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(config.uri, { 
    serverSelectionTimeoutMS: 10000, // 10 seconds timeout
    connectTimeoutMS: 10000 // 10 seconds timeout
  });

  try {
    // Connect to MongoDB
    await client.connect();
    console.log('Connected to MongoDB');
    
    // List all available databases
    const dbNames = await listDatabases(client);
    
    // Use the configured database name if it exists, otherwise use 'test'
    const dbNameToUse = dbNames.includes(config.dbName) 
      ? config.dbName 
      : dbNames.includes('test') ? 'test' : dbNames[0];
      
    console.log(`\nSelected database for backup: ${dbNameToUse}`);
    console.log(`\nUsing database: ${dbNameToUse}`);
    
    const db = client.db(dbNameToUse);
    const collections = await db.listCollections().toArray();
    
    console.log(`Starting backup of database: ${config.dbName}`);
    console.log(`Found ${collections.length} collections`);
    
    // Backup each collection
    for (const collection of collections) {
      const collectionName = collection.name;
      const filePath = path.join(backupPath, `${collectionName}.json`);
      
      console.log(`Backing up collection: ${collectionName}`);
      
      // Get all documents in the collection
      const documents = await db.collection(collectionName).find({}).toArray();
      
      // Write to file
      fs.writeFileSync(
        filePath,
        JSON.stringify(documents, null, 2),
        'utf8'
      );
      
      console.log(`  ↳ Saved ${documents.length} documents to ${filePath}`);
    }
    
    console.log('\nBackup completed successfully!');
    console.log(`Backup location: ${backupPath}`);
    
  } catch (error) {
    console.error('Backup failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run the backup
backupDatabase().catch(console.error);
