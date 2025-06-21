const Lab = require('../models/Lab');
const Field = require('../models/Field');

// Add a field to a lab
const addFieldToLab = async (req, res) => {
    const { lab_id, field_id } = req.body;
    try {
        const lab = await Lab.findById(lab_id);
        if (!lab || !lab.is_active) {
            return res.status(404).json({ success: false, message: 'Lab not found or inactive' });
        }
        const field = await Field.findById(field_id);
        if (!field) {
            return res.status(404).json({ success: false, message: 'Field not found' });
        }
        if (lab.fields.includes(field_id)) {
            return res.status(400).json({ success: false, message: 'This field is already associated with the lab' });
        }
        lab.fields.push(field_id);
        await lab.save();
        res.status(201).json({ success: true, message: 'Field successfully added to lab', data: { lab_id, field_id } });
    } catch (error) {
        console.error('Error in addFieldToLab:', error);
        res.status(500).json({ success: false, message: 'Error adding field to lab', errors: [error.message] });
    }
};

// Remove a field from a lab
const removeFieldFromLab = async (req, res) => {
    const { lab_id, field_id } = req.params;
    try {
        const lab = await Lab.findById(lab_id);
        if (!lab) {
            return res.status(404).json({ success: false, message: 'Lab not found' });
        }
        if (!lab.fields.includes(field_id)) {
            return res.status(404).json({ success: false, message: 'Field is not associated with this lab' });
        }
        lab.fields = lab.fields.filter(f => f.toString() !== field_id);
        await lab.save();
        res.json({ success: true, message: 'Field successfully removed from lab' });
    } catch (error) {
        console.error('Error in removeFieldFromLab:', error);
        res.status(500).json({ success: false, message: 'Error removing field from lab', errors: [error.message] });
    }
};

// Get all fields for a lab
const getLabFields = async (req, res) => {
    const { lab_id } = req.params;
    try {
        const lab = await Lab.findById(lab_id).populate('fields');
        if (!lab) {
            return res.status(404).json({ success: false, message: 'Lab not found' });
        }
        res.json({ success: true, data: lab.fields });
    } catch (error) {
        console.error('Error in getLabFields:', error);
        res.status(500).json({ success: false, message: 'Error retrieving lab fields', errors: [error.message] });
    }
};

// Get all labs for a field
const getFieldLabs = async (req, res) => {
    const { field_id } = req.params;
    try {
        const labs = await Lab.find({ fields: field_id, is_active: true }).select('name code');
        res.json({ success: true, data: labs });
    } catch (error) {
        console.error('Error in getFieldLabs:', error);
        res.status(500).json({ success: false, message: 'Error retrieving field labs', errors: [error.message] });
    }
};

module.exports = {
    addFieldToLab,
    removeFieldFromLab,
    getLabFields,
    getFieldLabs
}; 