require('dotenv').config({ path: '../../.env' });
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Item = require('../src/models/Item');
const CatalogueItem = require('../src/models/CatalogueItem');

// Connect to database
const connectDB = async () => {
    try {
        // Force using the online database
        const DB_URI = process.env.DB_URI1;
        
        if (!DB_URI) {
            throw new Error('DB_URI1 is not defined in .env file');
        }
        
        console.log('Connecting to MongoDB Atlas...');
        console.log('Using connection string:', DB_URI.replace(/(mongodb\+srv:\/\/)[^:]+:[^@]+@/, '$1*****:*****@'));
        
        await mongoose.connect(DB_URI, {
            serverSelectionTimeoutMS: 10000, // 10 seconds timeout
            socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
            family: 4, // Use IPv4, skip trying IPv6
            retryWrites: true,
            w: 'majority'
        });
        
        console.log('✅ MongoDB Atlas connected successfully');
        console.log('Database name:', mongoose.connection.db.databaseName);
        
        // Verify connection by listing collections
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log(`\nFound ${collections.length} collections in the database`);
        
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        console.error('Error details:', error);
        console.error('\nTroubleshooting steps:');
        console.error('1. Check your internet connection');
        console.error('2. Verify your MongoDB Atlas IP whitelist');
        console.error('3. Check if your MongoDB Atlas cluster is running');
        console.error('4. Verify your database credentials in .env');
        process.exit(1);
    }
};

// Generate a unique code for catalogue items
const generateUniqueCode = (name) => {
    const prefix = name.substring(0, 3).toUpperCase();
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${random}`;
};

// Main migration function
const migrateToCatalogue = async () => {
    console.log('🚀 Starting migration to catalogue-based system...');
    const session = await mongoose.startSession();
    
    try {
        await session.startTransaction();
        console.log('✅ Transaction started');
        
        // Get all unique items based on name and type
        console.log('🔍 Finding unique items to migrate...');
        const uniqueItems = await Item.aggregate([
            { $match: { catalogue_item_id: { $exists: false } } },
            { $group: { 
                _id: { name: '$name', type: '$type' },
                count: { $sum: 1 },
                firstItem: { $first: '$$ROOT' }
            }}
        ]).session(session);

        console.log(`✅ Found ${uniqueItems.length} unique items to migrate`);
        
        if (uniqueItems.length === 0) {
            console.log('ℹ️  No items need migration. Exiting...');
            await session.endSession();
            return;
        }
        
        const catalogueItemMap = new Map();
        const catalogueItemsToCreate = [];
        let processedItems = 0;
        
        // Prepare catalogue items for creation
        console.log('🔄 Preparing catalogue items...');
        for (const item of uniqueItems) {
            const { _id, firstItem, count } = item;
            const { name, type, description, unit, min_quantity, category } = firstItem;
            
            console.log(`\n📝 Processing item: ${name} (${type})`);
            console.log(`   - Description: ${description || 'N/A'}`);
            console.log(`   - Unit: ${unit || 'pcs'}`);
            console.log(`   - Min Quantity: ${min_quantity || 1}`);
            console.log(`   - Category: ${category || 'general'}`);
            
            // Create a new catalogue item
            const catalogueItem = new CatalogueItem({
                name,
                type,
                description: description || `Auto-generated ${name}`,
                unit: unit || 'pcs',
                min_quantity: min_quantity || 1,
                category: category || 'general',
                code: generateUniqueCode(name),
                is_active: true,
                created_by: 'system',
                updated_by: 'system'
            });
            
            catalogueItemsToCreate.push(catalogueItem);
            catalogueItemMap.set(`${name}_${type}`, catalogueItem);
            processedItems++;
            
            console.log(`   ✅ Prepared for creation (${processedItems}/${uniqueItems.length})`);
        }
        
        // Save all catalogue items
        console.log('\n💾 Saving catalogue items to database...');
        const createdCatalogueItems = await CatalogueItem.insertMany(
            catalogueItemsToCreate,
            { session }
        );
        
        console.log(`✅ Created ${createdCatalogueItems.length} catalogue items`);
        
        // Update all items to reference their catalogue items
        console.log('\n🔄 Updating items with catalogue references...');
        for (const item of uniqueItems) {
            const { _id, firstItem, count } = item;
            const catalogueItem = catalogueItemMap.get(`${firstItem.name}_${firstItem.type}`);
            
            console.log(`   🔄 Updating items for: ${firstItem.name} (${firstItem.type})`);
            
            const result = await Item.updateMany(
                { name: firstItem.name, type: firstItem.type },
                { 
                    $set: { 
                        catalogue_item_id: catalogueItem._id,
                        updated_by: 'system',
                        updated_at: new Date()
                    } 
                },
                { session }
            );
            
            console.log(`   ✅ Updated ${result.modifiedCount} items`);
        }
        
        await session.commitTransaction();
        console.log('\n🎉 Migration completed successfully!');
        console.log(`   - Created ${createdCatalogueItems.length} catalogue items`);
        console.log(`   - Updated ${uniqueItems.length} item types`);
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        if (session.inTransaction()) {
            console.log('⏳ Rolling back changes...');
            await session.abortTransaction();
        }
        throw error;
    } finally {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }
        await session.endSession();
        console.log('🔚 Session ended');
        await mongoose.disconnect();
    }
};

// Run the migration
connectDB()
    .then(() => migrateToCatalogue())
    .then(() => process.exit(0))
    .catch(error => {
        console.error('Migration error:', error);
        process.exit(1);
    });
