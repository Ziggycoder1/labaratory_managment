const pool = require('../config/database');

// Get all fields with their associated labs
const getAllFields = async (req, res) => {
    try {
        const query = `
            SELECT 
                f.*,
                GROUP_CONCAT(DISTINCT l.id) as lab_ids,
                GROUP_CONCAT(DISTINCT l.name) as lab_names,
                GROUP_CONCAT(DISTINCT l.code) as lab_codes
            FROM fields f
            LEFT JOIN lab_fields lf ON f.id = lf.field_id
            LEFT JOIN labs l ON lf.lab_id = l.id AND l.is_active = true
            GROUP BY f.id
            ORDER BY f.name
        `;

        const [fields] = await pool.query(query);

        // Process the results to format lab information
        const formattedFields = fields.map(field => ({
            id: field.id,
            name: field.name,
            code: field.code,
            description: field.description,
            available_labs: field.lab_ids ? field.lab_ids.split(',').map((id, index) => ({
                id: parseInt(id),
                name: field.lab_names.split(',')[index],
                code: field.lab_codes.split(',')[index]
            })) : []
        }));

        res.json({
            success: true,
            data: formattedFields
        });
    } catch (error) {
        console.error('Error in getAllFields:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving fields'
        });
    }
};

// Create a new field
const createField = async (req, res) => {
    const { name, code, description } = req.body;

    try {
        // Check if field code already exists
        const [existingField] = await pool.query(
            'SELECT id FROM fields WHERE code = ?',
            [code]
        );

        if (existingField.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Field code already exists'
            });
        }

        // Insert new field
        const [result] = await pool.query(
            'INSERT INTO fields (name, code, description) VALUES (?, ?, ?)',
            [name, code, description]
        );

        res.status(201).json({
            success: true,
            message: 'Field created successfully',
            data: {
                id: result.insertId,
                name,
                code,
                description
            }
        });
    } catch (error) {
        console.error('Error in createField:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating field'
        });
    }
};

module.exports = {
    getAllFields,
    createField
}; 