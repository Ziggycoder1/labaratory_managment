const mongoose = require('mongoose');
const { connection } = require('../config/database');

module.exports.up = async function(next) {
    try {
        // Get the StockLog model
        const StockLog = connection.model('StockLog');
        
        // Get the collection
        const collection = StockLog.collection;
        
        // Add new fields with default values
        await collection.updateMany(
            {},
            [
                {
                    $set: {
                        lab: null,  // This will be set to the item's lab in the next step
                        notes: "",
                        type: "adjustment",
                        reference_id: null,
                        metadata: {}
                    }
                }
            ]
        );
        
        // Update existing transfer logs to have the correct type
        await collection.updateMany(
            { reason: { $regex: /transfer/i } },
            { $set: { 
                type: { 
                    $cond: {
                        if: { $regexMatch: { input: "$reason", regex: /transfer out|to lab/i } },
                        then: "transfer_out",
                        else: "transfer_in"
                    }
                }
            }}
        );
        
        // Set lab reference for existing logs
        const Item = connection.model('Item');
        const logs = await collection.find({}).toArray();
        
        for (const log of logs) {
            if (!log.lab && log.item) {
                const item = await Item.findById(log.item).select('lab');
                if (item && item.lab) {
                    await collection.updateOne(
                        { _id: log._id },
                        { $set: { lab: item.lab } }
                    );
                }
            }
        }
        
        // Create indexes
        await collection.createIndex({ type: 1 });
        await collection.createIndex({ lab: 1 });
        
        next();
    } catch (error) {
        next(error);
    }
};

module.exports.down = async function(next) {
    // This is a destructive operation - usually you wouldn't want to remove columns in production
    // But including it for completeness in development
    try {
        const StockLog = connection.model('StockLog');
        const collection = StockLog.collection;
        
        // Remove the new fields
        await collection.updateMany(
            {},
            {
                $unset: {
                    lab: "",
                    notes: "",
                    type: "",
                    reference_id: "",
                    metadata: ""
                }
            }
        );
        
        // Drop the indexes
        try {
            await collection.dropIndex('type_1');
            await collection.dropIndex('lab_1');
        } catch (e) {
            console.log('Indexes not found, skipping drop');
        }
        
        next();
    } catch (error) {
        next(error);
    }
};
