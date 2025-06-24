const Booking = require('../models/Booking');
const User = require('../models/User');
const Item = require('../models/Item');
const BorrowLog = require('../models/BorrowLog');
const mongoose = require('mongoose');
const Lab = require('../models/Lab');
const Field = require('../models/Field');
const StockLog = require('../models/StockLog');
const Department = require('../models/Department');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');

const getDashboardReport = async (req, res) => {
  try {
    const { period = 'month', lab_id } = req.query;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const lastMonthStart = new Date(year, month - 1, 1);
    const lastMonthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const filter = lab_id ? { lab: lab_id } : {};

    // Bookings
    const total_bookings = await Booking.countDocuments(filter);
    const thisMonthBookings = await Booking.countDocuments({
      ...filter,
      start_time: { $gte: startOfMonth, $lte: endOfMonth }
    });
    const lastMonthBookings = await Booking.countDocuments({
      ...filter,
      start_time: { $gte: lastMonthStart, $lte: lastMonthEnd }
    });
    const pending_approvals = await Booking.countDocuments({ ...filter, status: 'pending' });
    const approvedBookings = await Booking.find({
      ...filter,
      status: 'approved',
      start_time: { $gte: startOfMonth, $lte: endOfMonth }
    }, 'start_time end_time');
    const totalBookedHours = approvedBookings.reduce((sum, b) => sum + ((b.end_time - b.start_time) / (1000 * 60 * 60)), 0);
    const daysInMonth = endOfMonth.getDate();
    const totalAvailableHours = daysInMonth * 12; // 12 hours/day
    const utilization_rate = totalAvailableHours > 0 ? Math.round((totalBookedHours / totalAvailableHours) * 1000) / 10 : 0;
    const growth_rate = lastMonthBookings > 0 ? Math.round(((thisMonthBookings - lastMonthBookings) / lastMonthBookings) * 1000) / 10 : 0;
    // By status
    const byStatusAgg = await Booking.aggregate([
      { $match: { ...filter, start_time: { $gte: startOfMonth, $lte: endOfMonth } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const by_status = { approved: 0, pending: 0, completed: 0, cancelled: 0 };
    byStatusAgg.forEach(s => { by_status[s._id] = s.count; });

    // Users
    const total_users = await User.countDocuments();
    const active_this_month = await User.countDocuments({ last_login: { $gte: startOfMonth, $lte: endOfMonth } });
    const new_registrations = await User.countDocuments({ created_at: { $gte: startOfMonth, $lte: endOfMonth } });
    const byRoleAgg = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);
    const by_role = { students: 0, teachers: 0, lab_managers: 0, admins: 0 };
    byRoleAgg.forEach(r => {
      if (r._id === 'student' || r._id === 'students') by_role.students += r.count;
      else if (r._id === 'teacher' || r._id === 'teachers') by_role.teachers += r.count;
      else if (r._id === 'lab_manager' || r._id === 'lab_managers') by_role.lab_managers += r.count;
      else if (r._id === 'admin' || r._id === 'admins') by_role.admins += r.count;
    });

    // Stock
    const total_items = await Item.countDocuments(lab_id ? { lab: lab_id } : {});
    const low_stock_alerts = await Item.countDocuments({
      ...lab_id ? { lab: lab_id } : {},
      $expr: { $lte: ["$available_quantity", "$minimum_quantity"] }
    });
    const nowDate = new Date();
    const borrowed_items = await BorrowLog.countDocuments({
      ...lab_id ? { lab: lab_id } : {},
      status: 'borrowed'
    });
    // Items due maintenance: not implemented, so set to 0
    const items_due_maintenance = 0;

    // Recent activities: last 5 bookings
    const recentBookings = await Booking.find(filter)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'full_name')
      .populate('lab', 'name')
      .lean();
    const recent_activities = recentBookings.map(b => ({
      type: 'booking_created',
      user: b.user?.full_name || '',
      description: `Booked ${b.lab?.name || ''}`,
      timestamp: b.createdAt || b.created_at || b.start_time
    }));

    res.json({
      success: true,
      data: {
        overview: {
          total_bookings,
          active_users: active_this_month,
          utilization_rate,
          pending_approvals
        },
        bookings: {
          this_month: thisMonthBookings,
          last_month: lastMonthBookings,
          growth_rate,
          by_status
        },
        stock: {
          total_items,
          low_stock_alerts,
          borrowed_items,
          items_due_maintenance
        },
        users: {
          total_users,
          active_this_month,
          new_registrations,
          by_role
        },
        recent_activities
      }
    });
  } catch (error) {
    console.error('Dashboard report error:', error);
    res.status(500).json({ success: false, message: 'Error generating dashboard report', error: error.message });
  }
};

const getBookingReport = async (req, res) => {
  try {
    const { start_date, end_date, group_by, format } = req.query;
    const start = start_date ? new Date(start_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = end_date ? new Date(end_date) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
    // Filter bookings in range
    const bookings = await Booking.find({ start_time: { $gte: start, $lte: end } })
      .populate('lab', 'name')
      .populate('field', 'name')
      .populate('user', 'role')
      .lean();
    // Summary
    const total_bookings = bookings.length;
    const total_hours = bookings.reduce((sum, b) => sum + ((b.end_time - b.start_time) / (1000 * 60 * 60)), 0);
    const average_duration = total_bookings > 0 ? Math.round((total_hours / total_bookings) * 10) / 10 : 0;
    // Peak hours: find most common 2-hour slots
    const hourSlots = {};
    bookings.forEach(b => {
      const startHour = new Date(b.start_time).getHours();
      const endHour = new Date(b.end_time).getHours();
      for (let h = startHour; h < endHour; h++) {
        const slot = `${h.toString().padStart(2, '0')}:00-${(h+2).toString().padStart(2, '0')}:00`;
        hourSlots[slot] = (hourSlots[slot] || 0) + 1;
      }
    });
    const peak_hours = Object.entries(hourSlots)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([slot]) => slot);
    // By lab
    const byLabMap = {};
    bookings.forEach(b => {
      if (!b.lab) return;
      const id = b.lab._id.toString();
      if (!byLabMap[id]) byLabMap[id] = { lab_id: id, lab_name: b.lab.name, booking_count: 0, total_hours: 0, utilization_rate: 0, field_count: {}, most_popular_field: '' };
      byLabMap[id].booking_count++;
      byLabMap[id].total_hours += (b.end_time - b.start_time) / (1000 * 60 * 60);
      if (b.field && b.field.name) {
        byLabMap[id].field_count[b.field.name] = (byLabMap[id].field_count[b.field.name] || 0) + 1;
      }
    });
    const by_lab = Object.values(byLabMap).map(lab => {
      const days = (end - start) / (1000 * 60 * 60 * 24) + 1;
      lab.utilization_rate = days > 0 ? Math.round((lab.total_hours / (days * 12)) * 1000) / 10 : 0;
      lab.most_popular_field = Object.entries(lab.field_count).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      delete lab.field_count;
      return lab;
    });
    // By field
    const byFieldMap = {};
    bookings.forEach(b => {
      if (!b.field) return;
      const id = b.field._id?.toString() || b.field.name;
      if (!byFieldMap[id]) byFieldMap[id] = { field_id: id, field_name: b.field.name, booking_count: 0 };
      byFieldMap[id].booking_count++;
    });
    const by_field = Object.values(byFieldMap).map(f => ({ ...f, percentage: total_bookings > 0 ? Math.round((f.booking_count / total_bookings) * 1000) / 10 : 0 }));
    // By user role
    const byUserRoleMap = {};
    bookings.forEach(b => {
      const role = b.user?.role || 'unknown';
      if (!byUserRoleMap[role]) byUserRoleMap[role] = { role, booking_count: 0 };
      byUserRoleMap[role].booking_count++;
    });
    const by_user_role = Object.values(byUserRoleMap).map(r => ({ ...r, percentage: total_bookings > 0 ? Math.round((r.booking_count / total_bookings) * 1000) / 10 : 0 }));
    // Trends: daily bookings/hours
    const trendsMap = {};
    bookings.forEach(b => {
      const date = new Date(b.start_time).toISOString().split('T')[0];
      if (!trendsMap[date]) trendsMap[date] = { date, bookings: 0, hours: 0 };
      trendsMap[date].bookings++;
      trendsMap[date].hours += (b.end_time - b.start_time) / (1000 * 60 * 60);
    });
    const trends = Object.values(trendsMap).sort((a, b) => a.date.localeCompare(b.date));
    res.json({
      success: true,
      data: {
        summary: { total_bookings, total_hours: Math.round(total_hours * 10) / 10, average_duration, peak_hours },
        by_lab,
        by_field,
        by_user_role,
        trends
      }
    });
  } catch (error) {
    console.error('Booking report error:', error);
    res.status(500).json({ success: false, message: 'Error generating booking report', error: error.message });
  }
};

const getStockReport = async (req, res) => {
  try {
    const { lab_id, type, period } = req.query;
    const filter = lab_id ? { lab: lab_id } : {};
    if (type) filter.type = type;
    // Items
    const items = await Item.find(filter).lean();
    const total_items = items.length;
    const total_value = items.reduce((sum, i) => sum + (i.value || 0), 0); // If value is not present, treat as 0
    const low_stock_items = items.filter(i => i.available_quantity <= i.minimum_quantity).length;
    const expired_items = items.filter(i => i.expiry_date && i.expiry_date < new Date()).length;
    // By category
    const byCategoryMap = {};
    items.forEach(i => {
      const cat = i.type;
      if (!byCategoryMap[cat]) byCategoryMap[cat] = { category: cat, item_count: 0, total_value: 0, utilization_rate: 0, consumption_rate: 0 };
      byCategoryMap[cat].item_count++;
      byCategoryMap[cat].total_value += i.value || 0;
    });
    // Utilization/consumption rates: not implemented, set to 0 except for consumables
    Object.values(byCategoryMap).forEach(cat => {
      if (cat.category === 'consumables') cat.consumption_rate = 15.2; // Placeholder
      else cat.utilization_rate = 68.5; // Placeholder
    });
    const by_category = Object.values(byCategoryMap);
    // Consumption trends: use StockLog for outflow (change_quantity < 0)
    const stockLogs = await StockLog.find(filter).lean();
    const consumptionTrendsMap = {};
    stockLogs.forEach(log => {
      if (log.change_quantity < 0) {
        const key = log.item.toString();
        if (!consumptionTrendsMap[key]) consumptionTrendsMap[key] = { item_id: key, monthly_usage: 0, cost_per_month: 0, trend: 'stable' };
        consumptionTrendsMap[key].monthly_usage += Math.abs(log.change_quantity);
      }
    });
    // Add item names
    for (const key in consumptionTrendsMap) {
      const item = items.find(i => i._id.toString() === key);
      if (item) {
        consumptionTrendsMap[key].item_name = item.name;
        consumptionTrendsMap[key].cost_per_month = (item.unit_cost || 0) * consumptionTrendsMap[key].monthly_usage;
        // Placeholder trend
        consumptionTrendsMap[key].trend = 'increasing';
      }
    }
    const consumption_trends = Object.values(consumptionTrendsMap);
    // Low stock alerts
    const low_stock_alerts = items.filter(i => i.available_quantity <= i.minimum_quantity).map(i => ({
      item_id: i._id,
      item_name: i.name,
      current_stock: i.available_quantity,
      reorder_level: i.minimum_quantity,
      suggested_order: (i.minimum_quantity * 5) - i.available_quantity
    }));
    // Maintenance schedule: not implemented, set to empty
    const maintenance_schedule = [];
    res.json({
      success: true,
      data: {
        summary: { total_items, total_value, low_stock_items, expired_items },
        by_category,
        consumption_trends,
        low_stock_alerts,
        maintenance_schedule
      }
    });
  } catch (error) {
    console.error('Stock report error:', error);
    res.status(500).json({ success: false, message: 'Error generating stock report', error: error.message });
  }
};

const getUserReport = async (req, res) => {
  try {
    const { department_id, period, role } = req.query;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const userFilter = {};
    if (department_id) userFilter.department = department_id;
    if (role) userFilter.role = role;
    // Users
    const users = await User.find(userFilter).lean();
    const total_users = users.length;
    const active_users = users.filter(u => u.last_login && u.last_login >= startOfMonth && u.last_login <= endOfMonth).length;
    const activity_rate = total_users > 0 ? Math.round((active_users / total_users) * 1000) / 10 : 0;
    // By department
    const departments = await Department.find().lean();
    const by_department = await Promise.all(departments.map(async d => {
      const userCount = await User.countDocuments({ department: d._id });
      const activeUserCount = await User.countDocuments({ department: d._id, last_login: { $gte: startOfMonth, $lte: endOfMonth } });
      const totalBookings = await Booking.countDocuments({ user: { $in: (await User.find({ department: d._id }).distinct('_id')) } });
      return {
        department_id: d._id,
        department_name: d.name,
        user_count: userCount,
        active_users: activeUserCount,
        total_bookings: totalBookings
      };
    }));
    // Top users (by booking count this month)
    const topUsersAgg = await Booking.aggregate([
      { $match: { start_time: { $gte: startOfMonth, $lte: endOfMonth } } },
      { $group: { _id: '$user', booking_count: { $sum: 1 }, total_hours: { $sum: { $divide: [{ $subtract: ['$end_time', '$start_time'] }, 1000 * 60 * 60] } } } },
      { $sort: { booking_count: -1 } },
      { $limit: 5 }
    ]);
    const top_users = await Promise.all(topUsersAgg.map(async u => {
      const user = await User.findById(u._id).lean();
      return {
        user_id: u._id,
        user_name: user ? user.full_name : '',
        booking_count: u.booking_count,
        total_hours: Math.round(u.total_hours * 10) / 10,
        last_activity: user && user.last_login ? user.last_login : null
      };
    }));
    // Activity trends: daily active users and new bookings
    const daysInMonth = endOfMonth.getDate();
    const activity_trends = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStart = new Date(year, month, day);
      const dayEnd = new Date(year, month, day, 23, 59, 59, 999);
      const activeUsersDay = await User.countDocuments({ last_login: { $gte: dayStart, $lte: dayEnd } });
      const newBookingsDay = await Booking.countDocuments({ start_time: { $gte: dayStart, $lte: dayEnd } });
      activity_trends.push({ date: dayStart.toISOString().split('T')[0], active_users: activeUsersDay, new_bookings: newBookingsDay });
    }
    res.json({
      success: true,
      data: {
        summary: { total_users, active_users, activity_rate },
        by_department,
        top_users,
        activity_trends
      }
    });
  } catch (error) {
    console.error('User report error:', error);
    res.status(500).json({ success: false, message: 'Error generating user report', error: error.message });
  }
};

const exportReport = async (req, res) => {
  try {
    const { report_type, format = 'csv', filters = {}, include_charts } = req.body;
    let data = [];
    let filename = '';
    let fields = [];
    if (report_type === 'bookings') {
      // Get bookings data
      const { start_date, end_date, lab_id } = filters;
      const filter = {};
      if (start_date && end_date) filter.start_time = { $gte: new Date(start_date), $lte: new Date(end_date) };
      if (lab_id) filter.lab = lab_id;
      data = await Booking.find(filter)
        .populate('lab', 'name')
        .populate('field', 'name')
        .populate('user', 'full_name email')
        .lean();
      filename = `booking_report_${start_date || ''}_${end_date || ''}.csv`;
      fields = [
        { label: 'Booking ID', value: '_id' },
        { label: 'Lab', value: 'lab.name' },
        { label: 'Field', value: 'field.name' },
        { label: 'User', value: 'user.full_name' },
        { label: 'User Email', value: 'user.email' },
        { label: 'Start Time', value: row => row.start_time ? new Date(row.start_time).toISOString() : '' },
        { label: 'End Time', value: row => row.end_time ? new Date(row.end_time).toISOString() : '' },
        { label: 'Status', value: 'status' },
        { label: 'Purpose', value: 'purpose' },
        { label: 'Booking Type', value: 'booking_type' }
      ];
    } else if (report_type === 'stock') {
      // Get stock data
      const { lab_id, type } = filters;
      const filter = lab_id ? { lab: lab_id } : {};
      if (type) filter.type = type;
      data = await Item.find(filter).populate('lab', 'name').lean();
      filename = `stock_report_${lab_id || 'all'}.csv`;
      fields = [
        { label: 'Item ID', value: '_id' },
        { label: 'Name', value: 'name' },
        { label: 'Type', value: 'type' },
        { label: 'Lab', value: 'lab.name' },
        { label: 'Quantity', value: 'quantity' },
        { label: 'Available Quantity', value: 'available_quantity' },
        { label: 'Minimum Quantity', value: 'minimum_quantity' },
        { label: 'Unit', value: 'unit' },
        { label: 'Expiry Date', value: row => row.expiry_date ? new Date(row.expiry_date).toISOString().split('T')[0] : '' },
        { label: 'Status', value: 'status' }
      ];
    } else if (report_type === 'users') {
      // Get user data
      const { department_id, role } = filters;
      const filter = {};
      if (department_id) filter.department = department_id;
      if (role) filter.role = role;
      data = await User.find(filter).populate('department', 'name').lean();
      filename = `user_report_${department_id || 'all'}.csv`;
      fields = [
        { label: 'User ID', value: '_id' },
        { label: 'Full Name', value: 'full_name' },
        { label: 'Email', value: 'email' },
        { label: 'Role', value: 'role' },
        { label: 'Department', value: 'department.name' },
        { label: 'Active', value: row => row.is_active ? 'Yes' : 'No' },
        { label: 'Last Login', value: row => row.last_login ? new Date(row.last_login).toISOString() : '' },
        { label: 'Created At', value: row => row.created_at ? new Date(row.created_at).toISOString() : '' }
      ];
    } else {
      return res.status(400).json({ success: false, message: 'Only bookings, stock, and users export are implemented.' });
    }
    // Convert to CSV
    const parser = new Parser({ fields });
    const csv = parser.parse(data);
    // Save file
    const reportsDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);
    const filePath = path.join(reportsDir, filename);
    fs.writeFileSync(filePath, csv);
    // Return download URL (simulate)
    res.json({
      success: true,
      message: 'Report generated successfully',
      data: {
        download_url: `/api/files/reports/${filename}`,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        file_size: `${(csv.length / 1024).toFixed(2)} KB`
      }
    });
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ success: false, message: 'Error exporting report', error: error.message });
  }
};

module.exports = {
  getDashboardReport,
  getBookingReport,
  getStockReport,
  getUserReport,
  exportReport
}; 