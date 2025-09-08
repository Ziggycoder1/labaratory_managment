const mongoose = require('mongoose');
const Item = require('../models/Item');
const Lab = require('../models/Lab');
const { validationResult } = require('express-validator');

// Get all items with filtering and pagination
exports.getAllItems = async (req, res) => {
    try {
        console.log('=== GET /api/items ===');
        console.log('Query params:', JSON.stringify(req.query, null, 2));
        console.log('User:', req.user ? {
            id: req.user._id,
            role: req.user.role,
            department: req.user.department
        } : 'No user');

        const {
            lab_id,
            type,
            low_stock,
            expiring_soon,
            page = 1,
            limit = 1000, // Increased default limit
            include = 'active' // Default to only active items
        } = req.query;

        let filterLabId = lab_id;

        // Department admin: only items for labs in their department
        if (req.user && req.user.role === 'department_admin') {
            console.log('Department admin detected, filtering by department labs');
            const labs = await require('../models/Lab')
                .find({ department: req.user.department._id })
                .select('_id');
            const labIds = labs.map(l => l._id);
            filterLabId = labIds.length > 0 ? labIds : null;
            console.log(`Filtering by department labs:`, labIds);
        }

        console.log('Fetching items with filters:', {
            lab_id: filterLabId,
            type,
            low_stock: low_stock === 'true',
            expiring_soon: expiring_soon === 'true',
            page: parseInt(page),
            limit: parseInt(limit)
        });

        const result = await Item.findAll({
            lab_id: filterLabId,
            type,
            low_stock: low_stock === 'true',
            expiring_soon: expiring_soon === 'true',
            include,
            page: parseInt(page),
            limit: parseInt(limit)
        });

        // Format the items to include catalogue details
        const formattedItems = result.items.map(item => {
            const itemObj = item.toObject();
            
            // If we have a populated catalogue_item_id, merge its fields
            if (itemObj.catalogue_item_id) {
                const { _id, __v, ...catalogueFields } = itemObj.catalogue_item_id;
                return {
                    ...itemObj,
                    ...catalogueFields,
                    catalogue_item_id: _id // Keep the ID reference
                };
            }
            
            return itemObj;
        });

        res.json({
            success: true,
            data: formattedItems,
            pagination: result.pagination
        });
    } catch (error) {
        console.error('Error fetching items:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching items',
            error: error.message
        });
    }
};

// Get specific item details
exports.getItemById = async (req, res) => {
    try {
        const item = await Item.findById(req.params.id)
            .populate('catalogue_item_id')
            .populate('lab', 'name code')
            .populate('created_by', 'name email');

        if (!item) {
            return res.status(404).json({
                success: false,
                message: 'Item not found'
            });
        }

        // Format the item to include catalogue details
        const itemObj = item.toObject();
        
        // If we have a populated catalogue_item_id, merge its fields
        if (itemObj.catalogue_item_id) {
            const { _id, __v, ...catalogueFields } = itemObj.catalogue_item_id;
            const formattedItem = {
                ...itemObj,
                ...catalogueFields,
                catalogue_item_id: _id // Keep the ID reference
            };
            
            return res.json({
                success: true,
                data: formattedItem
            });
        }

        res.json({
            success: true,
            data: itemObj
        });
    } catch (error) {
        console.error('Error fetching item:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching item',
            error: error.message
        });
    }
};

// Add new item
exports.createItem = async (req, res) => {
    console.log('=== ITEM CREATION REQUEST ===');
    console.log('Headers:', {
        'content-type': req.headers['content-type'],
        'authorization': req.headers['authorization'] ? 'Bearer [token present]' : 'No token'
    });
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Validate request
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.error('Validation errors:', errors.array());
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const {
            catalogue_item_id,
            lab,
            storage_type = 'lab',
            quantity,
            ...itemData
        } = req.body;

        console.log('Parsed request data:', {
            catalogue_item_id,
            lab,
            storage_type,
            quantity,
            additional_data: itemData
        });

        // Validate required fields
        if (!catalogue_item_id || !lab || quantity === undefined) {
            const errorMsg = 'Missing required fields: ' +
                (!catalogue_item_id ? 'catalogue_item_id, ' : '') +
                (!lab ? 'lab, ' : '') +
                (quantity === undefined ? 'quantity' : '');

            console.error('Validation error:', errorMsg);
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: errorMsg
            });
        }

        // Get the catalogue item to ensure it exists
        const CatalogueItem = mongoose.model('CatalogueItem');
        const catalogueItem = await CatalogueItem.findById(catalogue_item_id).session(session);

        if (!catalogueItem) {
            const errorMsg = `Catalogue item with ID ${catalogue_item_id} not found`;
            console.error('Validation error:', errorMsg);
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: errorMsg
            });
        }

        // Check if lab exists
        const Lab = mongoose.model('Lab');
        const labExists = await Lab.findById(lab).session(session);
        if (!labExists) {
            const errorMsg = `Lab with ID ${lab} not found`;
            console.error('Validation error:', errorMsg);
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: errorMsg
            });
        }

        // Check for existing item in the same location
        const existingItem = await Item.findOne({
            catalogue_item_id,
            lab,
            storage_type,
            deleted_at: null
        }).session(session);

        let item;

        if (existingItem) {
            // Update existing item quantity
            existingItem.quantity += Number(quantity);
            existingItem.available_quantity += Number(quantity);
            item = await existingItem.save({ session });
        } else {
            // Create new item
            const newItem = new Item({
                catalogue_item_id,
                lab,
                storage_type,
                quantity: Number(quantity),
                available_quantity: Number(quantity),
                minimum_quantity: Number(itemData.minimum_quantity) || 1,
                expiry_date: itemData.expiry_date,
                status: 'available',
                created_by: req.user._id,
                asset_details: itemData.asset_details || {}
            });

            item = await newItem.save({ session });
        }

        // Create stock log
        const StockLog = mongoose.model('StockLog');
        await StockLog.create([{
            item: item._id,
            user: req.user._id,
            lab: lab,
            change_quantity: Number(quantity),
            reason: 'Initial stock',
            type: 'add',
            metadata: {
                storage_type,
                source: 'catalogue_import',
                catalogue_item_id
            }
        }], { session });

        await session.commitTransaction();
        session.endSession();

        // Populate the response with all necessary data
        const populatedItem = await Item.findById(item._id)
            .populate('catalogue_item_id')
            .populate('lab', 'name code')
            .populate('created_by', 'name email')
            .lean();

        console.log('Item created/updated successfully:', populatedItem);

        res.status(201).json({
            success: true,
            data: populatedItem
        });

    } catch (error) {
        console.error('Error in createItem:', error);
        await session.abortTransaction();
        session.endSession();

        res.status(500).json({
            success: false,
            message: 'Error creating item',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

// Adjust stock quantity
exports.adjustStock = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const result = await Item.adjustStock(req.params.id, {
            ...req.body,
            user_id: req.user.id // Assuming user is attached by auth middleware
        });

        res.json({
            success: true,
            message: 'Stock adjusted successfully',
            data: result
        });
    } catch (error) {
        console.error('Error adjusting stock:', error);
        res.status(500).json({
            success: false,
            message: 'Error adjusting stock',
            error: error.message
        });
    }
};

// Get stock alerts
exports.getAlerts = async (req, res) => {
    try {
        const { type, lab_id } = req.query;
        const filter = {};
        if (lab_id) filter.lab = lab_id;
        const now = new Date();
        const soon = new Date();
        soon.setDate(now.getDate() + 30);

        let alertTypeFilter = {};
        if (type === 'low_stock') {
            alertTypeFilter = { $expr: { $lte: ["$available_quantity", "$minimum_quantity"] } };
        } else if (type === 'expiring_soon') {
            alertTypeFilter = {
                expiry_date: { $ne: null, $lte: soon, $gte: now }
            };
        } else if (type === 'expired') {
            alertTypeFilter = {
                expiry_date: { $ne: null, $lt: now }
            };
        }
        const items = await Item.find({ ...filter, ...alertTypeFilter })
            .populate('lab', 'name')
            .lean();

        // Summary counts
        const [summary] = await Item.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    low_stock: {
                        $sum: { $cond: [{ $lte: ["$available_quantity", "$minimum_quantity"] }, 1, 0] }
                    },
                    expiring_soon: {
                        $sum: {
                            $cond: [
                                { $and: [
                                    { $ne: ["$expiry_date", null] },
                                    { $lte: ["$expiry_date", soon] },
                                    { $gte: ["$expiry_date", now] }
                                ] }, 1, 0
                            ]
                        }
                    },
                    expired: {
                        $sum: {
                            $cond: [
                                { $and: [
                                    { $ne: ["$expiry_date", null] },
                                    { $lt: ["$expiry_date", now] }
                                ] }, 1, 0
                            ]
                        }
                    }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                alerts: items,
                summary: summary || { low_stock: 0, expiring_soon: 0, expired: 0 }
            }
        });
    } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching alerts',
            error: error.message
        });
    }
};

// Search items with filters (matches CatalogueItem fields and applies lab filters)
exports.searchItems = async (req, res) => {
    try {
        const { q, name, type, lab_id, low_stock, expiring_soon, page = 1, limit = 10 } = req.query;

        // Normalize search term: support both q and name
        const queryText = q || name || '';

        // Base match: restrict to lab, active (not deleted)
        const matchStage = { };
        if (lab_id) {
            matchStage.lab = new mongoose.Types.ObjectId(lab_id);
        }
        // Exclude soft-deleted
        matchStage.$or = [
            { deleted_at: null },
            { deleted_at: { $exists: false } }
        ];

        // Optional stock/expiry filters
        if (low_stock === 'true') {
            matchStage.$expr = { $lte: [ '$available_quantity', '$minimum_quantity' ] };
        }
        if (expiring_soon === 'true') {
            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            matchStage.expiry_date = { $lte: thirtyDaysFromNow, $gte: new Date() };
        }

        // Build aggregation to join CatalogueItem, then filter on its fields
        const pipeline = [
            { $match: matchStage },
            {
                $lookup: {
                    from: 'catalogueitems',
                    localField: 'catalogue_item_id',
                    foreignField: '_id',
                    as: 'catalogue'
                }
            },
            { $unwind: '$catalogue' }
        ];

        // Type filter is on catalogue.type
        if (type) {
            pipeline.push({ $match: { 'catalogue.type': type } });
        }

        // Text/regex search on catalogue fields (partial, case-insensitive)
        if (queryText) {
            const regex = new RegExp(queryText, 'i');
            pipeline.push({
                $match: {
                    $or: [
                        { 'catalogue.name': { $regex: regex } },
                        { 'catalogue.description': { $regex: regex } },
                        { 'catalogue.code': { $regex: regex } }
                    ]
                }
            });
        }

        // Total count for pagination
        pipeline.push(
            {
                $facet: {
                    data: [
                        { $sort: { updatedAt: -1 } },
                        { $skip: (parseInt(page) - 1) * parseInt(limit) },
                        { $limit: parseInt(limit) },
                        {
                            $project: {
                                _id: 1,
                                lab: 1,
                                storage_type: 1,
                                quantity: 1,
                                available_quantity: 1,
                                minimum_quantity: 1,
                                expiry_date: 1,
                                status: 1,
                                created_by: 1,
                                catalogue_item_id: '$catalogue._id',
                                // Flatten catalogue fields expected by frontend
                                name: '$catalogue.name',
                                type: '$catalogue.type',
                                unit: '$catalogue.unit',
                                description: '$catalogue.description',
                                code: '$catalogue.code'
                            }
                        }
                    ],
                    totalCount: [ { $count: 'count' } ]
                }
            }
        );

        const result = await Item.aggregate(pipeline);
        const data = result[0]?.data || [];
        const total = result[0]?.totalCount?.[0]?.count || 0;

        return res.json({
            success: true,
            data,
            pagination: {
                current_page: parseInt(page),
                per_page: parseInt(limit),
                total_count: total,
                total_pages: Math.max(1, Math.ceil(total / parseInt(limit)))
            }
        });
    } catch (error) {
        console.error('Error searching items:', error);
        return res.status(500).json({
            success: false,
            message: 'Error searching items',
            error: error.message
        });
    }
};

// Get low stock items
exports.getLowStockItems = async (req, res) => {
    try {
        const { lab_id } = req.query;
        const query = {
            $expr: { $lte: ['$quantity', '$minimum_quantity'] }
        };

        if (lab_id) query.lab_id = lab_id;

        const items = await Item.find(query).populate('lab_id', 'name');

        res.json({
            success: true,
            data: items
        });
    } catch (error) {
        console.error('Error fetching low stock items:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching low stock items',
            error: error.message
        });
    }
};

// Get expiring items
exports.getExpiringItems = async (req, res) => {
    try {
        const { days = 30, lab_id } = req.query;
        const daysNum = parseInt(days);

        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + daysNum);

        const query = {
            expiry_date: {
                $lte: targetDate,
                $gte: new Date()
            }
        };

        if (lab_id) query.lab_id = lab_id;

        const items = await Item.find(query).populate('lab_id', 'name');

        res.json({
            success: true,
            data: items
        });
    } catch (error) {
        console.error('Error fetching expiring items:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching expiring items',
            error: error.message
        });
    }
};

// Soft delete item by setting deleted_at
exports.softDeleteItem = async (req, res) => {
    try {
        const { id } = req.params;

        // Soft delete by setting deleted_at
        const item = await Item.findByIdAndUpdate(
            id,
            { deleted_at: new Date() },
            { new: true }
        );

        if (!item) {
            return res.status(404).json({
                success: false,
                message: 'Item not found'
            });
        }

        res.json({
            success: true,
            message: 'Item moved to trash successfully',
            data: item
        });
    } catch (error) {
        console.error('Error soft deleting item:', error);
        res.status(500).json({
            success: false,
            message: 'Error moving item to trash',
            error: error.message
        });
    }
};

// Permanently delete item from database
exports.permanentDeleteItem = async (req, res) => {
    try {
        const { id } = req.params;

        // Permanently delete the item
        const item = await Item.findByIdAndDelete(id);

        if (!item) {
            return res.status(404).json({
                success: false,
                message: 'Item not found'
            });
        }

        // TODO: Consider deleting associated records (borrow logs, etc.)

        res.json({
            success: true,
            message: 'Item permanently deleted successfully',
            data: { id: item._id }
        });
    } catch (error) {
        console.error('Error permanently deleting item:', error);
        res.status(500).json({
            success: false,
            message: 'Error permanently deleting item',
            error: error.message
        });
    }
};

// For backward compatibility
exports.deleteItem = exports.softDeleteItem;

// Update an existing item
exports.updateItem = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id } = req.params;
        const updates = req.body;
        const userId = req.user._id;

        // Find the item
        const item = await Item.findById(id).session(session);
        if (!item) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ message: 'Item not found' });
        }

        // If updating quantity, log the change
        if (updates.quantity !== undefined && updates.quantity !== item.quantity) {
            const adjustmentType = updates.quantity > item.quantity ? 'add' : 'remove';
            const quantityChanged = Math.abs(updates.quantity - item.quantity);

            // Create stock log
            await StockLog.create([{
                item: item._id,
                lab: item.lab,
                user: userId,
                type: adjustmentType === 'add' ? 'stock_in' : 'stock_out',
                quantity: quantityChanged,
                previous_quantity: item.quantity,
                new_quantity: updates.quantity,
                reason: `Manual update - ${adjustmentType}`,
                notes: `Item updated by user ${userId}`,
                reference_type: 'item_update',
                reference_id: item._id
            }], { session });
        }

        // Update the item
        Object.assign(item, updates);
        item.updated_by = userId;
        item.updated_at = new Date();
        await item.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.json({
            message: 'Item updated successfully',
            data: item
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error updating item:', error);
        res.status(500).json({
            message: 'Error updating item',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Transfer items between storage locations (lab to lab, lab to temp, temp to lab, etc.)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.transferItem = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const {
            item_id,
            from_lab_id,
            to_lab_id,
            from_storage_type = 'lab',
            to_storage_type = 'lab',
            quantity,
            reason = 'transfer',
            notes = ''
        } = req.body;

        // Validate required fields
        if (!item_id || !from_lab_id || !to_lab_id || !quantity || quantity <= 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'item_id, from_lab_id, to_lab_id, and positive quantity are required',
                fields: {
                    item_id: !item_id ? 'Required' : undefined,
                    from_lab_id: !from_lab_id ? 'Required' : undefined,
                    to_lab_id: !to_lab_id ? 'Required' : undefined,
                    quantity: !quantity ? 'Required' : (quantity <= 0 ? 'Must be positive' : undefined)
                }
            });
        }

        // Check if source and destination are the same
        if (from_lab_id === to_lab_id && from_storage_type === to_storage_type) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Source and destination cannot be the same'
            });
        }

        // Find source item
        const sourceItem = await Item.findOne({
            _id: item_id,
            lab: from_lab_id,
            storage_type: from_storage_type,
            deleted_at: null
        }).session(session);

        if (!sourceItem) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Source item not found or insufficient permissions'
            });
        }

        // Check available quantity
        if (sourceItem.available_quantity < quantity) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Insufficient quantity available for transfer',
                available: sourceItem.available_quantity,
                requested: quantity
            });
        }

        // Find or create destination item
        let destinationItem = await Item.findOne({
            catalogue_item_id: sourceItem.catalogue_item_id,
            lab: to_lab_id,
            storage_type: to_storage_type,
            deleted_at: null
        }).session(session);

        // Start transaction
        const StockLog = require('../models/StockLog');
        const now = new Date();

        // Update source item
        sourceItem.quantity -= quantity;
        sourceItem.available_quantity -= quantity;
        sourceItem.updated_at = now;
        await sourceItem.save({ session });

        // Create or update destination item
        if (destinationItem) {
            // Update existing item
            destinationItem.quantity += quantity;
            destinationItem.available_quantity += quantity;
        } else {
            // Create new item at destination using source item details
            const { _id, __v, updated_at, created_at, ...itemData } = sourceItem.toObject();
            destinationItem = new Item({
                ...itemData,
                lab: to_lab_id,
                storage_type: to_storage_type,
                quantity: quantity,
                available_quantity: quantity,
                created_by: req.user._id,
                created_at: now,
                updated_at: now
            });
        }
        await destinationItem.save({ session });

        // Create stock logs for both source and destination
        await StockLog.create([
            // Source log (removal)
            {
                item: sourceItem._id,
                user: req.user._id,
                lab: from_lab_id,
                change_quantity: -quantity,
                reason: `Transfer to ${to_lab_id} (${to_storage_type})`,
                type: 'transfer_out',
                metadata: {
                    from_storage_type,
                    to_lab_id,
                    to_storage_type,
                    notes
                }
            },
            // Destination log (addition)
            {
                item: destinationItem._id,
                user: req.user._id,
                lab: to_lab_id,
                change_quantity: quantity,
                reason: `Transfer from ${from_lab_id} (${from_storage_type})`,
                type: 'transfer_in',
                metadata: {
                    from_lab_id,
                    from_storage_type,
                    to_storage_type,
                    notes
                }
            }
        ], { session });

        await session.commitTransaction();
        session.endSession();

        // Prepare response
        const response = {
            success: true,
            message: 'Transfer completed successfully',
            data: {
                source: {
                    item_id: sourceItem._id,
                    remaining_quantity: sourceItem.quantity
                },
                destination: {
                    item_id: destinationItem._id,
                    new_quantity: destinationItem.quantity
                }
            }
        };

        res.json(response);

    } catch (error) {
        await session.abortTransaction();
        session.endSession();

        console.error('Error transferring item:', error);
        res.status(500).json({
            success: false,
            message: 'Error transferring item',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

/**
 * Move item between labs
 */
exports.moveItem = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { target_lab_id, quantity, reason, notes } = req.body;
        const { id: itemId } = req.params;
        const userId = req.user.id;

        // Validation
        if (!target_lab_id || !quantity || !reason) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Target lab, quantity, and reason are required'
            });
        }

        // Get source item with full lab and department population
        const sourceItem = await Item.findById(itemId)
            .populate({
                path: 'lab',
                select: 'name department',
                populate: {
                    path: 'department',
                    select: '_id name',
                    model: 'Department'
                },
                model: 'Lab'
            })
            .session(session);

        if (!sourceItem) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Source item not found'
            });
        }

        // Ensure source lab exists and has department
        if (!sourceItem.lab) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Source lab not found for this item'
            });
        }

        console.log('Source item with populated lab and department:', JSON.stringify({
            _id: sourceItem._id,
            name: sourceItem.name,
            lab: {
                _id: sourceItem.lab._id,
                name: sourceItem.lab.name,
                department: sourceItem.lab.department
            }
        }, null, 2));

        if (!sourceItem) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Source item not found'
            });
        }

        // Check if target lab exists        // Get target lab with department
        const targetLab = await Lab.findById(target_lab_id)
            .populate({
                path: 'department',
                select: '_id name',
                model: 'Department'
            })
            .select('name department')
            .session(session);

        console.log('Target lab with department:', JSON.stringify({
            _id: targetLab?._id,
            name: targetLab?.name,
            department: targetLab?.department
        }, null, 2));

        if (!targetLab) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Target lab not found'
            });
        }

        // Verify department information
        if (!sourceItem.lab.department) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Source lab is not assigned to any department. Please update the lab information.'
            });
        }

        if (!targetLab.department) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Target lab is not assigned to any department. Please update the lab information.'
            });
        }

        // Compare department IDs
        const sourceDeptId = sourceItem.lab.department._id || sourceItem.lab.department;
        const targetDeptId = targetLab.department._id || targetLab.department;

        if (sourceDeptId.toString() !== targetDeptId.toString()) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: `Cannot move items between different departments. Source department: ${sourceItem.lab.department.name}, Target department: ${targetLab.department.name}`
            });
        }

        // Check sufficient quantity
        if (sourceItem.available_quantity < quantity) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Insufficient quantity available'
            });
        }

        // Find or create item in target lab
        let targetItem = await Item.findOne({
            name: sourceItem.name,
            type: sourceItem.type,
            lab: target_lab_id,
            deleted_at: null
        }).session(session);

        // Update source item quantity
        sourceItem.quantity -= quantity;
        sourceItem.available_quantity = Math.max(0, sourceItem.available_quantity - quantity);
        await sourceItem.save({ session });

        // Create or update target item
        if (targetItem) {
            // Update existing item
            targetItem.quantity += quantity;
            targetItem.available_quantity += quantity;
            if (sourceItem.expiry_date && (!targetItem.expiry_date || sourceItem.expiry_date < targetItem.expiry_date)) {
                targetItem.expiry_date = sourceItem.expiry_date;
            }
        } else {
            // Create new item in target lab
            const newItemData = {
                ...sourceItem.toObject(),
                _id: new mongoose.Types.ObjectId(),
                lab: target_lab_id,
                quantity: quantity,
                available_quantity: quantity,
                created_at: new Date(),
                updated_at: new Date()
            };
            delete newItemData._id;
            targetItem = new Item(newItemData);
        }

        await targetItem.save({ session });

        // Log the movement
        const StockLog = require('../models/StockLog');

        // Log source item decrease
        const sourceStockLog = new StockLog({
            item: sourceItem._id,
            user: userId,
            change_quantity: -quantity,
            reason: `Transfer to lab: ${targetLab.name}. ${reason}`,
            notes: notes || '',
            type: 'transfer_out',
            lab: sourceItem.lab._id
        });
        await sourceStockLog.save({ session });

        // Log target item increase
        const targetStockLog = new StockLog({
            item: targetItem._id,
            user: userId,
            change_quantity: quantity,
            reason: `Transfer from lab: ${sourceItem.lab.name}. ${reason}`,
            notes: notes || '',
            type: 'transfer_in',
            lab: target_lab_id
        });
        await targetStockLog.save({ session });

        // Commit transaction
        await session.commitTransaction();
        session.endSession();

        // Populate lab names for response
        const sourceLab = await mongoose.model('Lab').findById(sourceItem.lab).select('name');
        const populatedTargetLab = await mongoose.model('Lab').findById(target_lab_id).select('name');

        res.json({
            success: true,
            message: 'Item moved successfully',
            data: {
                sourceItem: {
                    ...sourceItem.toObject(),
                    lab: sourceLab
                },
                targetItem: {
                    ...targetItem.toObject(),
                    lab: populatedTargetLab
                },
                transferLogs: {
                    source: sourceStockLog,
                    target: targetStockLog
                }
            }
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error moving item:', error);
        res.status(500).json({
            success: false,
            message: 'Error moving item',
            error: error.message
        });
    }
};

// Note: All required controller methods have been implemented.