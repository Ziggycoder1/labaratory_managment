const MaintenanceSchedule = require('../models/MaintenanceSchedule');
const Item = require('../models/Item');
const User = require('../models/User');

// GET /api/maintenance/schedules
exports.getSchedules = async (req, res) => {
  try {
    const { item_id, status, lab_id } = req.query;
    const filter = {};
    if (item_id) filter.item = item_id;
    if (status) filter.status = status;
    if (lab_id) filter['item.lab'] = lab_id;

    // Populate item and assigned_to
    const schedules = await MaintenanceSchedule.find(filter)
      .populate({ path: 'item', select: 'name code lab' })
      .populate({ path: 'assigned_to', select: 'full_name role' })
      .lean();

    // Map to required format
    const mapped = schedules.map(s => ({
      id: s._id,
      item_id: s.item?._id,
      item_name: s.item?.name,
      item_code: s.item?.code,
      maintenance_type: s.maintenance_type,
      scheduled_date: s.scheduled_date ? new Date(s.scheduled_date).toISOString() : null,
      last_maintenance: s.last_maintenance ? new Date(s.last_maintenance).toISOString() : null,
      frequency: s.frequency,
      status: s.status,
      assigned_to: s.assigned_to ? {
        id: s.assigned_to._id,
        name: s.assigned_to.full_name,
        role: s.assigned_to.role
      } : null,
      estimated_duration: s.estimated_duration,
      description: s.description,
      priority: s.priority
    }));

    // Summary
    const total_schedules = await MaintenanceSchedule.countDocuments(filter);
    const overdue = await MaintenanceSchedule.countDocuments({ ...filter, status: 'overdue' });
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const due_this_week = await MaintenanceSchedule.countDocuments({ ...filter, status: 'due', scheduled_date: { $lte: weekFromNow, $gte: now } });
    const completed_this_month = await MaintenanceSchedule.countDocuments({ ...filter, status: 'completed', completion_date: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) } });

    res.json({
      success: true,
      data: {
        schedules: mapped,
        summary: {
          total_schedules,
          overdue,
          due_this_week,
          completed_this_month
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching schedules', error: error.message });
  }
};

// POST /api/maintenance/schedules
exports.createSchedule = async (req, res) => {
  try {
    const { item_id, maintenance_type, scheduled_date, frequency, description, assigned_to, estimated_duration, priority } = req.body;
    const item = await Item.findById(item_id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    const schedule = await MaintenanceSchedule.create({
      item: item_id,
      maintenance_type,
      scheduled_date,
      frequency,
      description,
      assigned_to,
      estimated_duration,
      priority
    });
    res.status(201).json({
      success: true,
      message: 'Maintenance schedule created successfully',
      data: {
        id: schedule._id,
        item_name: item.name,
        scheduled_date: new Date(schedule.scheduled_date).toISOString(),
        status: schedule.status
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error creating schedule', error: error.message });
  }
};

// PATCH /api/maintenance/schedules/:id/complete
exports.completeSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { completion_date, performed_by, notes, parts_replaced, cost, next_maintenance_date, condition_after } = req.body;
    const schedule = await MaintenanceSchedule.findById(id);
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });
    schedule.status = 'completed';
    schedule.completion_date = completion_date;
    schedule.performed_by = performed_by;
    schedule.notes = notes;
    schedule.parts_replaced = parts_replaced;
    schedule.cost = cost;
    schedule.next_maintenance_date = next_maintenance_date;
    schedule.condition_after = condition_after;
    await schedule.save();
    res.json({
      success: true,
      message: 'Maintenance marked as completed',
      data: {
        id: schedule._id,
        status: schedule.status,
        completion_date: schedule.completion_date ? new Date(schedule.completion_date).toISOString() : null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error completing schedule', error: error.message });
  }
}; 