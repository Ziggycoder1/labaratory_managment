const Field = require('../models/Field');
const Lab = require('../models/Lab');

// Get all fields with their associated labs
const getAllFields = async (req, res) => {
    try {
        const fields = await Field.find().lean();
        // Populate labs for each field using the virtual
        const populatedFields = await Promise.all(fields.map(async field => {
            const labs = await Lab.find({ fields: field._id }).select('name code').lean();
            return {
                id: field._id,
                name: field.name,
                code: field.code,
                description: field.description,
                available_labs: labs.map(lab => ({
                    id: lab._id,
                    name: lab.name,
                    code: lab.code
                }))
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

// Create a new field
const createField = async (req, res) => {
    const { name, code, description } = req.body;
    try {
        const existingField = await Field.findOne({ code });
        if (existingField) {
            return res.status(400).json({
                success: false,
                message: 'Field code already exists'
            });
        }
        const field = await Field.create({ name, code, description });
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

module.exports = {
    getAllFields,
    createField
}; 