const mongoose = require('mongoose');
const { Schema } = mongoose;

const itemSchema = new Schema({
  catalogue_item_id: { 
    type: Schema.Types.ObjectId, 
    ref: 'CatalogueItem', 
    required: true 
  },
  lab: { 
    type: Schema.Types.ObjectId, 
    ref: 'Lab', 
    required: true 
  },
  storage_type: {
    type: String,
    enum: ['lab', 'temporary'],
    default: 'lab',
    required: true
  },
  quantity: { 
    type: Number, 
    required: true,
    min: 0
  },
  available_quantity: { 
    type: Number, 
    required: true,
    min: 0
  },
  minimum_quantity: { 
    type: Number, 
    required: true,
    min: 0
  },
  expiry_date: { 
    type: Date 
  },
  status: { 
    type: String, 
    enum: ['available', 'low_stock', 'out_of_stock', 'expired', 'in_maintenance'],
    default: 'available' 
  },
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  deleted_at: { 
    type: Date, 
    default: null 
  },
  asset_details: {
    serial_number: String,
    purchase_date: Date,
    warranty_expiry: Date,
    last_maintenance_date: Date,
    next_maintenance_date: Date,
    condition: {
      type: String,
      enum: ['new', 'good', 'fair', 'poor', 'disposed'],
      default: 'new'
    },
    notes: String
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Add virtuals for the fields that come from the catalogue item
itemSchema.virtual('name').get(function() {
  return this.catalogue_item_id?.name;
});

itemSchema.virtual('type').get(function() {
  return this.catalogue_item_id?.type;
});

itemSchema.virtual('unit').get(function() {
  return this.catalogue_item_id?.unit;
});

itemSchema.virtual('description').get(function() {
  return this.catalogue_item_id?.description;
});

// Add method to get full item data with catalogue fields
itemSchema.methods.getFullData = async function() {
  await this.populate('catalogue_item_id');
  const item = this.toObject();
  
  // Merge catalogue item fields
  if (this.catalogue_item_id) {
    const { name, type, unit, description, ...catalogueFields } = this.catalogue_item_id.toObject();
    return {
      ...item,
      name,
      type,
      unit,
      description,
      catalogue_details: catalogueFields
    };
  }
  
  return item;
};

// Update the find and findOne methods to always populate catalogue_item_id
itemSchema.pre('find', function() {
  this.populate('catalogue_item_id');
});

itemSchema.pre('findOne', function() {
  this.populate('catalogue_item_id');
});

// Static methods
itemSchema.statics.findAll = async function({ 
  lab_id, 
  type, 
  low_stock, 
  expiring_soon, 
  include = 'active',
  page = 1, 
  limit = 20 
}) {
  const skip = (page - 1) * limit;
  const query = {};
  
  // Handle include filter
  if (include === 'active') {
    query.deleted_at = { $in: [null, undefined] };
  } else if (include === 'deleted') {
    query.deleted_at = { $ne: null };
  }
  
  // Apply filters
  if (lab_id) {
    query.lab = Array.isArray(lab_id) ? { $in: lab_id } : lab_id;
  }
  
  if (type) {
    query.type = type;
  }
  
  if (low_stock === 'true') {
    query.$expr = { $lte: ['$available_quantity', '$minimum_quantity'] };
  }
  
  if (expiring_soon === 'true') {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    query.expiry_date = { $lte: thirtyDaysFromNow, $gte: new Date() };
  }
  
  const [items, total] = await Promise.all([
    this.find(query)
      .populate('catalogue_item_id')  
      .populate('lab', 'name code')
      .populate('created_by', 'name email')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    this.countDocuments(query)
  ]);
  
  return {
    items,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    }
  };
};

// Pre-save hook to validate stock levels
itemSchema.pre('save', function(next) {
  if (this.isModified('available_quantity') && this.available_quantity < 0) {
    throw new Error('Available quantity cannot be negative');
  }
  
  if (this.quantity < 0) {
    throw new Error('Quantity cannot be negative');
  }
  
  next();
});

const Item = mongoose.model('Item', itemSchema);
module.exports = Item;