const mongoose = require('mongoose');
const { Schema } = mongoose;

const specificationSchema = new Schema({
  // Common specifications
  unit: { 
    type: String, 
    required: true,
    trim: true 
  },
  default_minimum_quantity: { 
    type: Number, 
    required: true,
    min: 0,
    default: 1
  },
  
  // Fixed asset specific
  model_number: { 
    type: String,
    trim: true
  },
  warranty_period: { 
    type: Number, // in months
    min: 0
  },
  maintenance_interval: { 
    type: Number, // in days
    min: 0
  }
}, { _id: false });

const catalogueItemSchema = new Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    unique: true
  },
  code: {
    type: String,
    trim: true,
    required: true,
    unique: true
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['consumable', 'non_consumable', 'fixed_asset'],
    default: 'consumable'
  },
  category: {
    type: String,
    trim: true
  },
  unit: {
    type: String,
    trim: true,
    required: true
  },
  min_quantity: {
    type: Number,
    min: 0,
    default: 1
  },
  specifications: {
    type: specificationSchema,
    required: true
  },
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  is_active: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
catalogueItemSchema.index({ name: 'text', description: 'text' });

// Virtual for items referencing this catalogue item
catalogueItemSchema.virtual('items', {
  ref: 'Item',
  localField: '_id',
  foreignField: 'catalogue_item_id'
});

// Prevent deletion if items reference this catalogue item
catalogueItemSchema.pre('remove', async function(next) {
  const itemCount = await mongoose.model('Item').countDocuments({ 
    catalogue_item_id: this._id 
  });
  
  if (itemCount > 0) {
    throw new Error('Cannot delete catalogue item that is in use');
  }
  
  next();
});

// Static methods
catalogueItemSchema.statics.findByType = function(type) {
  return this.find({ type, is_active: true });
};

catalogueItemSchema.statics.search = function(query) {
  return this.find({
    $text: { $search: query },
    is_active: true
  });
};

const CatalogueItem = mongoose.model('CatalogueItem', catalogueItemSchema);

module.exports = CatalogueItem;
