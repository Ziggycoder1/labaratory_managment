const pool = require('../config/database');

// Add a field to a lab
const addFieldToLab = async (req, res) => {
    const { lab_id, field_id } = req.body;

    try {
        // Check if lab exists and is active
        const [lab] = await pool.query(
            'SELECT id FROM labs WHERE id = ? AND is_active = true',
            [lab_id]
        );

        if (lab.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Lab not found or inactive'
            });
        }

        // Check if field exists
        const [field] = await pool.query(
            'SELECT id FROM fields WHERE id = ?',
            [field_id]
        );

        if (field.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Field not found'
            });
        }

        // Check if relationship already exists
        const [existing] = await pool.query(
            'SELECT * FROM lab_fields WHERE lab_id = ? AND field_id = ?',
            [lab_id, field_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'This field is already associated with the lab'
            });
        }

        // Add the relationship
        await pool.query(
            'INSERT INTO lab_fields (lab_id, field_id) VALUES (?, ?)',
            [lab_id, field_id]
        );

        res.status(201).json({
            success: true,
            message: 'Field successfully added to lab',
            data: {
                lab_id,
                field_id
            }
        });
    } catch (error) {
        console.error('Error in addFieldToLab:', error);
        res.status(500).json({
            success: false,
            message: 'Error adding field to lab'
        });
    }
};

// Remove a field from a lab
const removeFieldFromLab = async (req, res) => {
    const { lab_id, field_id } = req.params;

    try {
        // Check if relationship exists
        const [existing] = await pool.query(
            'SELECT * FROM lab_fields WHERE lab_id = ? AND field_id = ?',
            [lab_id, field_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Field is not associated with this lab'
            });
        }

        // Remove the relationship
        await pool.query(
            'DELETE FROM lab_fields WHERE lab_id = ? AND field_id = ?',
            [lab_id, field_id]
        );

        res.json({
            success: true,
            message: 'Field successfully removed from lab'
        });
    } catch (error) {
        console.error('Error in removeFieldFromLab:', error);
        res.status(500).json({
            success: false,
            message: 'Error removing field from lab'
        });
    }
};

// Get all fields for a lab
const getLabFields = async (req, res) => {
    const { lab_id } = req.params;

    try {
        const [fields] = await pool.query(
            `SELECT f.* 
             FROM fields f
             JOIN lab_fields lf ON f.id = lf.field_id
             WHERE lf.lab_id = ?
             ORDER BY f.name`,
            [lab_id]
        );

        res.json({
            success: true,
            data: fields
        });
    } catch (error) {
        console.error('Error in getLabFields:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving lab fields'
        });
    }
};

// Get all labs for a field
const getFieldLabs = async (req, res) => {
    const { field_id } = req.params;

    try {
        const [labs] = await pool.query(
            `SELECT l.* 
             FROM labs l
             JOIN lab_fields lf ON l.id = lf.lab_id
             WHERE lf.field_id = ? AND l.is_active = true
             ORDER BY l.name`,
            [field_id]
        );

        res.json({
            success: true,
            data: labs
        });
    } catch (error) {
        console.error('Error in getFieldLabs:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving field labs'
        });
    }
};

module.exports = {
    addFieldToLab,
    removeFieldFromLab,
    getLabFields,
    getFieldLabs
}; 