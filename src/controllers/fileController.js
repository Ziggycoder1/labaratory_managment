const File = require('../models/File');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');

// POST /api/files/upload
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const { type, reference_id, reference_type } = req.body;
    const file = await File.create({
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      file_path: req.file.path.replace(/\\/g, '/'),
      reference_type,
      reference_id,
      uploaded_by: req.user._id
    });
    await file.populate('uploaded_by', 'full_name');
    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        id: file._id,
        filename: file.filename,
        original_name: file.original_name,
        file_size: file.file_size,
        mime_type: file.mime_type,
        file_path: file.file_path,
        download_url: `/api/files/download/${file._id}`,
        uploaded_by: {
          id: file.uploaded_by._id,
          name: file.uploaded_by.full_name
        },
        uploaded_at: file.uploaded_at.toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error uploading file', error: error.message });
  }
};

// GET /api/files/:id
exports.getFileInfo = async (req, res) => {
  try {
    const file = await File.findById(req.params.id).populate('uploaded_by', 'full_name');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });
    res.json({
      success: true,
      data: {
        id: file._id,
        filename: file.filename,
        original_name: file.original_name,
        file_size: file.file_size,
        mime_type: file.mime_type,
        reference_type: file.reference_type,
        reference_id: file.reference_id,
        uploaded_by: {
          id: file.uploaded_by._id,
          name: file.uploaded_by.full_name
        },
        uploaded_at: file.uploaded_at.toISOString(),
        download_count: file.download_count,
        is_public: file.is_public
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching file info', error: error.message });
  }
};

// GET /api/files/download/:id
exports.downloadFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });
    file.download_count = (file.download_count || 0) + 1;
    await file.save();
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    return res.sendFile(path.resolve(file.file_path));
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error downloading file', error: error.message });
  }
}; 