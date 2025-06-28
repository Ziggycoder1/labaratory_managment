const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { auth } = require('../middleware/auth.middleware');
const fileController = require('../controllers/fileController');

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../../uploads/documents'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage });

router.post('/upload', auth, upload.single('file'), fileController.uploadFile);
router.get('/:id', auth, fileController.getFileInfo);
router.get('/download/:id', auth, fileController.downloadFile);

module.exports = router; 