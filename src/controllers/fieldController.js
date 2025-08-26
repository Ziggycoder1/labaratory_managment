const Field = require('../models/Field');
const Lab = require('../models/Lab');
const { isValidObjectId } = require('mongoose');

// Get all fields with their associated labs
const getAllFields = async (req, res) => {
    try {
        const { search } = req.query;
        const query = {};
        
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { code: { $regex: search, $options: 'i' } }
            ];
        }

        // Find all fields and sort by name
        const fields = await Field.find(query).sort({ name: 1 });
        
        // Populate labs for each field
        const populatedFields = await Promise.all(fields.map(async field => {
            const labs = await Lab.find({ fields: field._id, is_active: true })
                .select('name code')
                .lean();
                
            return {
                id: field._id,
                name: field.name,
                code: field.code,
                description: field.description,
                createdAt: field.createdAt,
                updatedAt: field.updatedAt,
                available_labs: labs.map(lab => ({
                    id: lab._id,
                    name: lab.name,
                    code: lab.code
                })),
                labs_count: labs.length
            };
        }));

        res.json({
            success: true,
            data: populatedFields
        });
    } catch (error) {
        console.error('Error in getAllFields:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving fields',
            errors: [error.message]
        });
    }
};

// Get a single field by ID
const getFieldById = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid field ID'
            });
        }

        const field = await Field.findById(id).lean();
        
        if (!field) {
            return res.status(404).json({
                success: false,
                message: 'Field not found'
            });
        }

        // Get associated labs
        const labs = await Lab.find({ fields: field._id, is_active: true })
            .select('name code department capacity location')
            .populate('department', 'name')
            .lean();

        res.json({
            success: true,
            data: {
                ...field,
                available_labs: labs,
                labs_count: labs.length
            }
        });
    } catch (error) {
        console.error('Error in getFieldById:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving field',
            errors: [error.message]
        });
    }
};

// Create a new field
const createField = async (req, res) => {
    const { name, code, description } = req.body;
    
    // Validation
    if (!name || !code) {
        return res.status(400).json({
            success: false,
            message: 'Name and code are required',
            errors: []
        });
    }

    try {
        // Check if field with same code exists
        const existingField = await Field.findOne({ 
            $or: [
                { code },
                { name: { $regex: new RegExp(`^${name}$`, 'i') } }
            ]
        });

        if (existingField) {
            return res.status(409).json({
                success: false,
                message: 'Field with this code or name already exists',
                field: existingField.code === code ? 'code' : 'name'
            });
        }

        const field = await Field.create({ 
            name: name.trim(),
            code: code.trim().toUpperCase(),
            description: description?.trim()
        });

        res.status(201).json({
            success: true,
            message: 'Field created successfully',
            data: field
        });
    } catch (error) {
        console.error('Error in createField:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating field',
            errors: [error.message]
        });
    }
};

// Update a field
const updateField = async (req, res) => {
    const { id } = req.params;
    const { name, code, description } = req.body;

    if (!isValidObjectId(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid field ID'
        });
    }

    try {
        const field = await Field.findById(id);
        
        if (!field) {
            return res.status(404).json({
                success: false,
                message: 'Field not found'
            });
        }

        // Check for duplicate code or name
        if (code || name) {
            const existingField = await Field.findOne({
                _id: { $ne: id },
                $or: [
                    code && { code: code.trim().toUpperCase() },
                    name && { name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } }
                ].filter(Boolean)
            });

            if (existingField) {
                return res.status(409).json({
                    success: false,
                    message: 'Another field with this code or name already exists',
                    field: existingField.code === code?.toUpperCase() ? 'code' : 'name'
                });
            }
        }


        // Update fields
        if (name) field.name = name.trim();
        if (code) field.code = code.trim().toUpperCase();
        if (description !== undefined) field.description = description?.trim() || '';
        
        await field.save();

        res.json({
            success: true,
            message: 'Field updated successfully',
            data: field
        });
    } catch (error) {
        console.error('Error in updateField:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating field',
            errors: [error.message]
        });
    }
};

// Delete a field
const deleteField = async (req, res) => {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid field ID'
        });
    }

    try {
        // Check if field is used in any labs
        const labsUsingField = await Lab.countDocuments({ fields: id });
        
        if (labsUsingField > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete field as it is being used by one or more labs',
                labs_count: labsUsingField
            });
        }

        const result = await Field.findByIdAndDelete(id);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Field not found'
            });
        }

        res.json({
            success: true,
            message: 'Field deleted successfully'
        });
    } catch (error) {
        console.error('Error in deleteField:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting field',
            errors: [error.message]
        });
    }
};

// Search fields
const searchFields = async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Search query must be at least 2 characters long'
            });
        }

        const searchRegex = new RegExp(query, 'i');
        
        const fields = await Field.find({
            $or: [
                { name: searchRegex },
                { code: searchRegex },
                { description: searchRegex }
            ]
        })
        .limit(10)
        .select('name code')
        .lean();

        res.json({
            success: true,
            data: fields
        });
    } catch (error) {
        console.error('Error in searchFields:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching fields',
            errors: [error.message]
        });
    }
};

module.exports = {
    getAllFields,
    getFieldById,
    createField,
    updateField,
    deleteField,
    searchFields
};