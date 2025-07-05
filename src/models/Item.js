const mongoose = require('mongoose');
const { Schema } = mongoose;

const itemSchema = new Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  lab: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
  quantity: { type: Number, required: true },
  available_quantity: { type: Number, required: true },
  unit: { type: String, required: true },
  expiry_date: { type: Date },
  minimum_quantity: { type: Number, required: true },
  description: { type: String },
  status: { 
    type: String, 
    enum: ['available', 'low_stock', 'out_of_stock', 'expired', 'in_maintenance'],
    default: 'available' 
  },
  deleted_at: { type: Date, default: null },
}, { timestamps: true });

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
  const filter = {};
  
  // Handle soft delete filtering
  if (include === 'active') {
    filter.deleted_at = null;
  } else if (include === 'deleted') {
    filter.deleted_at = { $ne: null };
  }
  // If include is 'all', don't filter by deleted_at
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  
  if (lab_id) filter.lab = lab_id;
  if (type) filter.type = type;
  if (low_stock) filter.$expr = { $lte: ["$available_quantity", "$minimum_quantity"] };
  if (expiring_soon) {
    filter.expiry_date = { $lte: soon };
  }
  const totalCount = await this.countDocuments(filter);
  const items = await this.find(filter)
    .populate('lab', 'name')
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  // Alerts summary
  const [alerts] = await this.aggregate([
    { $match: lab_id ? { lab: mongoose.Types.ObjectId(lab_id) } : {} },
    {
      $group: {
        _id: null,
        low_stock_count: {
          $sum: { $cond: [{ $lte: ["$available_quantity", "$minimum_quantity"] }, 1, 0] }
        },
        expiring_soon_count: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ["$expiry_date", null] },
                { $lte: ["$expiry_date", soon] }
              ] }, 1, 0
            ]
          }
        },
        expired_count: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ["$expiry_date", null] },
                { $lt: ["$expiry_date", new Date()] }
              ] }, 1, 0
            ]
          }
        }
      }
    }
  ]);
        return {
            items,
            pagination: {
                current_page: parseInt(page),
                total_pages: Math.ceil(totalCount / limit),
                total_count: totalCount,
                per_page: parseInt(limit)
            },
    alerts: alerts || { low_stock_count: 0, expiring_soon_count: 0, expired_count: 0 }
  };
};

itemSchema.statics.findByIdWithDetails = async function(id) {
  const item = await this.findById(id)
    .populate('lab', 'name')
    .lean();
  if (!item) return null;
  // You may need to implement population for borrow_logs, maintenance_logs, stock_logs if you migrate those collections
  return item;
};

itemSchema.statics.createItem = async function(itemData) {
  const item = await this.create({
    ...itemData,
            available_quantity: itemData.quantity
  });
  return item;
};

itemSchema.statics.updateItem = async function(id, updateData) {
  const result = await this.findByIdAndUpdate(id, updateData, { new: true });
  return !!result;
};

itemSchema.statics.adjustStock = async function(id, adjustmentData, session = null) {
  const options = session ? { session } : {};
  const item = await this.findById(id, null, options);
  if (!item) throw new Error('Item not found');
  
  const adjustment = adjustmentData.adjustment_type === 'add' 
    ? adjustmentData.quantity 
    : -adjustmentData.quantity;
    
  item.quantity += adjustment;
  item.available_quantity += adjustment;
  
  // Validate available quantity is not negative
  if (item.available_quantity < 0) {
    throw new Error('Insufficient stock available');
  }
  
  await item.save({ ...options, validateBeforeSave: true });
  return item;
};

// Instance methods
itemSchema.methods.checkStockLevels = async function() {
  if (this.available_quantity <= 0) {
    this.status = 'out_of_stock';
  } else if (this.available_quantity <= this.minimum_quantity) {
    this.status = 'low_stock';
  } else {
    this.status = 'available';
  }
  
  // Check for expiry
  if (this.expiry_date && new Date(this.expiry_date) < new Date()) {
    this.status = 'expired';
  }
  
  return this.save();
};

// Static methods
itemSchema.statics.getLowStockItems = async function(labId = null) {
  const filter = {
    $expr: { $lte: ["$available_quantity", "$minimum_quantity"] },
    status: { $ne: 'out_of_stock' }
  };
  
  if (labId) {
    filter.lab = labId;
  }
  
  return this.find(filter).populate('lab', 'name');
};

itemSchema.statics.getExpiringItems = async function(days = 30, labId = null) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  
  const filter = {
    expiry_date: { $lte: date, $gte: new Date() },
    status: { $ne: 'expired' }
  };
  
  if (labId) {
    filter.lab = labId;
  }
  
  return this.find(filter).populate('lab', 'name');
};

// Pre-save hook to validate stock levels
itemSchema.pre('save', function(next) {
  if (this.isModified('available_quantity') && this.available_quantity < 0) {
    throw new Error('Available quantity cannot be negative');
  }
  next();
});

const Item = mongoose.model('Item', itemSchema);
module.exports = Item; 