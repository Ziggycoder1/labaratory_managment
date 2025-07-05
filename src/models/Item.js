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
  status: { type: String, default: 'available' },
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

itemSchema.statics.adjustStock = async function(id, adjustmentData) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const item = await this.findById(id).session(session);
    if (!item) throw new Error('Item not found');
            const adjustment = adjustmentData.adjustment_type === 'add' 
                ? adjustmentData.quantity 
                : -adjustmentData.quantity;
    item.quantity += adjustment;
    item.available_quantity += adjustment;
    await item.save();
    // You may want to log the stock adjustment in a separate collection
    await session.commitTransaction();
    session.endSession();
    return item;
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

const Item = mongoose.model('Item', itemSchema);
module.exports = Item; 