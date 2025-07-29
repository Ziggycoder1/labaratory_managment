const CatalogueItem = require('../models/CatalogueItem');
const Item = require('../models/Item');
const { validationResult } = require('express-validator');

// Create a new catalogue item
exports.createCatalogueItem = async (req, res) => {
  try {
    console.log('=== CREATE CATALOGUE ITEM REQUEST ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, type, category, specifications } = req.body;
    console.log('Parsed fields:', { name, description, type, category });
    console.log('Specifications:', specifications);
    
    // Check if item with same name exists
    const existingItem = await CatalogueItem.findOne({ name });
    if (existingItem) {
      console.log('Item with this name already exists:', existingItem);
      return res.status(400).json({ 
        success: false, 
        message: 'A catalogue item with this name already exists' 
      });
    }

    const catalogueItem = new CatalogueItem({
      name,
      description,
      type,
      code: req.body.code, // Include code from request
      unit: req.body.unit, // Include unit from request
      min_quantity: req.body.min_quantity, // Include min_quantity from request
      category,
      specifications: {
        ...specifications,
        // Ensure required fields are set based on type
        unit: specifications.unit || req.body.unit || 'unit',
        default_minimum_quantity: specifications.default_minimum_quantity || req.body.min_quantity || 1
      },
      created_by: req.user.id
    });

    console.log('Catalogue item to be saved:', catalogueItem);
    await catalogueItem.save();
    
    console.log('Catalogue item created successfully:', catalogueItem);
    res.status(201).json({
      success: true,
      data: catalogueItem
    });
    
  } catch (error) {
    console.error('Error creating catalogue item:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      keyValue: error.keyValue
    });
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
};

// Get all catalogue items
exports.getCatalogueItems = async (req, res) => {
  try {
    const { type, category, search, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    
    const query = { is_active: true };
    
    if (type) query.type = type;
    if (category) query.category = category;
    if (search) {
      query.$text = { $search: search };
    }
    
    // Get total count for pagination
    const total = await CatalogueItem.countDocuments(query);
    
    // Get paginated results
    let itemsQuery = CatalogueItem.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limitNum);
    
    // If search is active, add text score to sort by relevance
    if (search) {
      itemsQuery = itemsQuery.sort({ score: { $meta: 'textScore' } });
    }
    
    const items = await itemsQuery.exec();
    const totalPages = Math.ceil(total / limitNum);
    
    res.json({
      success: true,
      data: items,
      pagination: {
        total,
        total_pages: totalPages,
        current_page: pageNum,
        per_page: limitNum,
        has_next_page: pageNum < totalPages,
        has_prev_page: pageNum > 1
      }
    });
    
  } catch (error) {
    console.error('Error fetching catalogue items:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
};

// Get single catalogue item
exports.getCatalogueItem = async (req, res) => {
  try {
    const item = await CatalogueItem.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Catalogue item not found'
      });
    }
    
    // Get inventory counts across labs
    const inventoryStats = await Item.aggregate([
      { $match: { catalogue_item_id: item._id } },
      {
        $group: {
          _id: null,
          total_quantity: { $sum: '$quantity' },
          total_available: { $sum: '$available_quantity' },
          lab_count: { $addToSet: '$lab' }
        }
      },
      {
        $project: {
          _id: 0,
          total_quantity: 1,
          total_available: 1,
          lab_count: { $size: '$lab_count' }
        }
      }
    ]);
    
    const result = {
      ...item.toObject(),
      inventory: inventoryStats[0] || { 
        total_quantity: 0, 
        total_available: 0, 
        lab_count: 0 
      }
    };
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Error fetching catalogue item:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
};

// Update catalogue item
exports.updateCatalogueItem = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { name, description, type, category, specifications, code, unit, min_quantity } = req.body;
    
    // Check if another item with the same name exists
    const existingItem = await CatalogueItem.findOne({ 
      name,
      _id: { $ne: req.params.id }
    });
    
    if (existingItem) {
      return res.status(400).json({ 
        success: false, 
        message: 'Another catalogue item with this name already exists' 
      });
    }
    
    const updateData = {
      name,
      description,
      type,
      code, // Include code from request
      unit, // Include unit from request
      min_quantity, // Include min_quantity from request
      category,
      specifications: {
        ...specifications,
        // Ensure required fields are set based on type
        unit: specifications?.unit || unit || 'unit',
        default_minimum_quantity: specifications?.default_minimum_quantity || min_quantity || 1
      },
      updated_at: Date.now()
    };
    
    console.log('Updating catalogue item with data:', updateData);
    
    const item = await CatalogueItem.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Catalogue item not found'
      });
    }
    
    res.json({
      success: true,
      data: item
    });
    
  } catch (error) {
    console.error('Error updating catalogue item:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
};

// Delete catalogue item (soft delete)
exports.deleteCatalogueItem = async (req, res) => {
  try {
    // Check if any items reference this catalogue item
    const itemInUse = await Item.exists({ 
      catalogue_item_id: req.params.id,
      deleted_at: null
    });
    
    if (itemInUse) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete catalogue item that is in use by inventory items'
      });
    }
    
    const item = await CatalogueItem.findByIdAndUpdate(
      req.params.id,
      { 
        is_active: false,
        deleted_at: Date.now()
      },
      { new: true }
    );
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Catalogue item not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Catalogue item deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting catalogue item:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
};

// Get inventory locations for a catalogue item
exports.getItemLocations = async (req, res) => {
  try {
    const items = await Item.find({ 
      catalogue_item_id: req.params.id,
      deleted_at: null,
      $or: [
        { quantity: { $gt: 0 } },
        { available_quantity: { $gt: 0 } }
      ]
    })
    .populate('lab', 'name')
    .select('lab storage_type quantity available_quantity status');
    
    res.json({
      success: true,
      data: items
    });
    
  } catch (error) {
    console.error('Error fetching item locations:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message 
    });
  }
};
