const Item = require('../models/Item');
const { validationResult } = require('express-validator');

// Get all items with filtering and pagination
exports.getAllItems = async (req, res) => {
    try {
        const {
            lab_id,
            type,
            low_stock,
            expiring_soon,
            page = 1,
            limit = 20
        } = req.query;
        let filterLabId = lab_id;
        // Department admin: only items for labs in their department
        if (req.user && req.user.role === 'department_admin') {
            const labs = await require('../models/Lab').find({ department: req.user.department._id }).select('_id');
            const labIds = labs.map(l => l._id);
            filterLabId = labIds.length > 0 ? labIds : null;
        }
        const result = await Item.findAll({
            lab_id: filterLabId,
            type,
            low_stock: low_stock === 'true',
            expiring_soon: expiring_soon === 'true',
            page: parseInt(page),
            limit: parseInt(limit)
        });
        res.json({
            success: true,
            data: result
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
        const item = await Item.findByIdWithDetails(req.params.id);
        
        if (!item) {
            return res.status(404).json({
                success: false,
                message: 'Item not found'
            });
        }

        res.json({
            success: true,
            data: item
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
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const result = await Item.createItem(req.body);
        
        res.status(201).json({
            success: true,
            message: 'Item added successfully',
            data: result
        });
    } catch (error) {
        console.error('Error creating item:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating item',
            error: error.message
        });
    }
};

// Update item information
exports.updateItem = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const success = await Item.updateItem(req.params.id, req.body);
        
        if (!success) {
            return res.status(404).json({
                success: false,
                message: 'Item not found'
            });
        }

        res.json({
            success: true,
            message: 'Item updated successfully'
        });
    } catch (error) {
        console.error('Error updating item:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating item',
            error: error.message
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

// Note: getAlerts method is not implemented in the new Item model. You may want to implement it if needed. 