const mongoose = require('mongoose');
const { Schema } = mongoose;

// Define valid status values
const LAB_STATUS = {
  ACTIVE: 'active',
  MAINTENANCE: 'maintenance',
  INACTIVE: 'inactive',
  BOOKED: 'booked',
  AVAILABLE: 'available'
};

const labSchema = new Schema({
  name: { 
    type: String, 
    required: [true, 'Lab name is required'],
    trim: true,
    minlength: [3, 'Lab name must be at least 3 characters long'],
    maxlength: [100, 'Lab name cannot exceed 100 characters']
  },
  code: { 
    type: String, 
    required: [true, 'Lab code is required'],
    unique: true, 
    trim: true,
    uppercase: true,
    match: [/^[A-Z0-9-]+$/, 'Lab code can only contain letters, numbers, and hyphens']
  },
  department: { 
    type: Schema.Types.ObjectId, 
    ref: 'Department', 
    required: [true, 'Department is required']
  },
  status: { 
    type: String, 
    enum: {
      values: Object.values(LAB_STATUS),
      message: 'Invalid lab status'
    },
    default: LAB_STATUS.ACTIVE
  },
  is_active: { 
    type: Boolean, 
    default: true 
  },
  capacity: { 
    type: Number, 
    min: [1, 'Capacity must be at least 1'],
    max: [1000, 'Capacity cannot exceed 1000']
  },
  location: { 
    type: String, 
    trim: true,
    maxlength: [200, 'Location cannot exceed 200 characters']
  },
  building: {
    type: String,
    trim: true,
    maxlength: [100, 'Building name cannot exceed 100 characters']
  },
  floor: {
    type: Number,
    min: [-5, 'Floor cannot be less than -5 (basement)'],
    max: [100, 'Floor cannot exceed 100']
  },
  room_number: {
    type: String,
    trim: true,
    maxlength: [20, 'Room number cannot exceed 20 characters']
  },
  description: { 
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  fields: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Field' 
  }],
  equipment: [{
    item: { type: Schema.Types.ObjectId, ref: 'Equipment' },
    quantity: { type: Number, default: 1, min: 1 }
  }],
  images: [{
    url: String,
    caption: String,
    is_primary: { type: Boolean, default: false }
  }],
  opening_hours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String }
  },
  contact_person: {
    name: String,
    email: {
      type: String,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address']
    },
    phone: {
      type: String,
      match: [/^[0-9\-+()\s]+$/, 'Please enter a valid phone number']
    }
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  last_maintenance: Date,
  maintenance_notes: String,
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updated_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  deleted_at: {
    type: Date,
    default: null
  },
  deleted_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assigned_users: [{
    user: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: [true, 'User is required for assignment'],
      validate: {
        validator: async function(userId) {
          try {
            const user = await mongoose.model('User').findById(userId).select('role').lean();
            return user && ['admin', 'lab_manager'].includes(user.role);
          } catch (error) {
            return false;
          }
        },
        message: 'Only users with admin or lab_manager role can be assigned to labs'
      }
    },
    role: { 
      type: String, 
      enum: {
        values: ['manager', 'technician', 'instructor'],
        message: 'Invalid role. Must be one of: manager, technician, instructor'
      },
      default: 'manager',
      required: [true, 'Role is required']
    },
    assigned_at: { 
      type: Date, 
      default: Date.now,
      required: [true, 'Assignment date is required']
    },
    assigned_by: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      required: [true, 'Assigned by user is required']
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters']
    }
  }]
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
labSchema.index({ name: 'text', code: 'text', location: 'text', description: 'text' });
labSchema.index({ department: 1, status: 1 });
labSchema.index({ is_active: 1 });
labSchema.index({ 'fields': 1 });

// Virtual for lab's URL
labSchema.virtual('url').get(function() {
  return `/labs/${this._id}`;
});

// Virtual for lab's full location
labSchema.virtual('full_location').get(function() {
  const parts = [];
  if (this.building) parts.push(this.building);
  if (this.room_number) parts.push(`Room ${this.room_number}`);
  if (this.floor != null) parts.push(`${this.floor > 0 ? `${this.floor} Floor` : 'Basement'}`);
  return parts.join(', ');
});

// Virtual for lab's current availability status
labSchema.virtual('is_available').get(function() {
  return this.status === LAB_STATUS.AVAILABLE || 
         (this.status === LAB_STATUS.ACTIVE && this.is_active);
});

// Pre-save hook to handle code formatting
labSchema.pre('save', function(next) {
  if (this.isModified('code')) {
    this.code = this.code.trim().toUpperCase();
  }
  next();
});

// Static method to check if a lab with the given code already exists
labSchema.statics.codeExists = async function(code, excludeId = null) {
  const query = { code: code.trim().toUpperCase() };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const count = await this.countDocuments(query);
  return count > 0;
};

// Instance method to get lab statistics
labSchema.methods.getStatistics = async function() {
  const LabBooking = this.model('LabBooking');
  const now = new Date();
  
  const [totalBookings, upcomingBookings, pastBookings] = await Promise.all([
    LabBooking.countDocuments({ lab: this._id }),
    LabBooking.countDocuments({ 
      lab: this._id, 
      start_time: { $gte: now } 
    }),
    LabBooking.countDocuments({ 
      lab: this._id, 
      end_time: { $lt: now } 
    })
  ]);

  return {
    total_bookings: totalBookings,
    upcoming_bookings: upcomingBookings,
    past_bookings: pastBookings,
    equipment_count: this.equipment?.length || 0,
    fields_count: this.fields?.length || 0
  };
};

// Soft delete method
labSchema.methods.softDelete = async function(userId) {
  this.deleted_at = new Date();
  this.deleted_by = userId;
  this.is_active = false;
  await this.save();
};

// Restore method
labSchema.methods.restore = async function() {
  this.deleted_at = null;
  this.deleted_by = null;
  this.is_active = true;
  await this.save();
};

// Query helper for active labs
labSchema.query.active = function() {
  return this.where({ is_active: true, deleted_at: null });
};

// Query helper for available labs
labSchema.query.available = function() {
  return this.where({ 
    is_active: true, 
    deleted_at: null,
    $or: [
      { status: LAB_STATUS.AVAILABLE },
      { status: LAB_STATUS.ACTIVE }
    ]
  });
};

// Add text index for search
if (!labSchema.options.toObject) labSchema.options.toObject = {};
labSchema.options.toObject.transform = function(doc, ret) {
  // Remove sensitive/private fields
  delete ret.__v;
  delete ret.deleted_at;
  delete ret.deleted_by;
  
  // Add virtuals
  if (!ret.full_location && (ret.building || ret.room_number || ret.floor != null)) {
    ret.full_location = [];
    if (ret.building) ret.full_location.push(ret.building);
    if (ret.room_number) ret.full_location.push(`Room ${ret.room_number}`);
    if (ret.floor != null) {
      ret.full_location.push(`${ret.floor > 0 ? `${ret.floor} Floor` : 'Basement'}`);
    }
    ret.full_location = ret.full_location.join(', ');
  }
  
  return ret;
};

const Lab = mongoose.model('Lab', labSchema);

// Add LAB_STATUS to the model for easy access
Lab.STATUS = LAB_STATUS;

module.exports = Lab;