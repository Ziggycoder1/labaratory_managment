const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const config = {
  uri: process.env.DB_URI1,
  dbName: 'test', // Default database name
};

console.log('🚀 Starting migration to catalogue-based system...');
console.log('Using database:', config.dbName);
console.log('Connection string:', process.env.DB_URI1 ? 
  process.env.DB_URI1.replace(/(mongodb\+srv:\/\/)[^:]+:[^@]+@/, '$1*****:*****@') : 
  'DB_URI1 not found in .env'
);

async function migrateToCatalogue() {
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 10000, // 10 seconds timeout
    connectTimeoutMS: 10000 // 10 seconds timeout
  });

  try {
    // Connect to MongoDB
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db(config.dbName);
    
    // Get all unique items
    console.log('🔍 Finding unique items to migrate...');
    const items = await db.collection('items').find({}).toArray();
    console.log(`✅ Found ${items.length} items to process`);
    
    if (items.length === 0) {
      console.log('ℹ️  No items found to migrate');
      return;
    }
    
    // Group items by name and type
    const itemsByType = {};
    items.forEach(item => {
      const key = `${item.name}_${item.type}`;
      if (!itemsByType[key]) {
        itemsByType[key] = {
          name: item.name,
          type: item.type,
          description: item.description || `Auto-generated ${item.name}`,
          unit: item.unit || 'pcs',
          min_quantity: item.min_quantity || 1,
          category: item.category || 'general',
          code: generateUniqueCode(item.name),
          is_active: true,
          created_by: 'system',
          updated_by: 'system',
          created_at: new Date(),
          updated_at: new Date(),
          count: 0
        };
      }
      itemsByType[key].count++;
    });
    
    const catalogueItems = Object.values(itemsByType);
    console.log(`📝 Prepared ${catalogueItems.length} unique catalogue items`);
    
    if (catalogueItems.length === 0) {
      console.log('ℹ️  No new catalogue items to create');
      return;
    }
    
    // Insert catalogue items
    console.log('💾 Saving catalogue items...');
    const catalogueCollection = db.collection('catalogueitems');
    const result = await catalogueCollection.insertMany(catalogueItems);
    console.log(`✅ Created ${result.insertedCount} catalogue items`);
    
    // Update items with catalogue references
    console.log('🔄 Updating items with catalogue references...');
    for (const [key, catalogueItem] of Object.entries(itemsByType)) {
      const item = await catalogueCollection.findOne({ 
        name: catalogueItem.name, 
        type: catalogueItem.type 
      });
      
      if (item) {
        const updateResult = await db.collection('items').updateMany(
          { name: catalogueItem.name, type: catalogueItem.type },
          { 
            $set: { 
              catalogue_item_id: item._id,
              updated_by: 'system',
              updated_at: new Date()
            } 
          }
        );
        
        console.log(`   ✅ Updated ${updateResult.modifiedCount} items for ${catalogueItem.name} (${catalogueItem.type})`);
      }
    }
    
    console.log('\n🎉 Migration completed successfully!');
    console.log(`   - Created ${catalogueItems.length} catalogue items`);
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Error details:', error);
    throw error;
  } finally {
    await client.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

function generateUniqueCode(name) {
  const prefix = name.substring(0, 3).toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${random}`;
}

// Run the migration
migrateToCatalogue().catch(console.error);
