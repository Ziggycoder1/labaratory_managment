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

        const result = await Item.findAll({
            lab_id,
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
        const item = await Item.findById(req.params.id);
        
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

        const result = await Item.create(req.body);
        
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

        const success = await Item.update(req.params.id, req.body);
        
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
        
        const result = await Item.getAlerts({ type, lab_id });

        res.json({
            success: true,
            data: result
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