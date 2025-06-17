const pool = require('../config/database');

// Get all labs with filters
const getAllLabs = async (req, res) => {
  try {
    const { department_id, available_only } = req.query;
    
    let query = `
      SELECT 
        l.*,
        d.name as department_name,
        COUNT(DISTINCT e.id) as equipment_count,
        GROUP_CONCAT(DISTINCT f.id, ':', f.name, ':', f.code) as fields_data,
        (
          SELECT JSON_OBJECT(
            'start_time', b.start_time,
            'end_time', b.end_time,
            'field_name', f.name
          )
          FROM bookings b
          LEFT JOIN fields f ON b.field_id = f.id
          WHERE b.lab_id = l.id
          AND b.status = 'approved'
          AND b.start_time > NOW()
          ORDER BY b.start_time ASC
          LIMIT 1
        ) as next_booking
      FROM labs l
      LEFT JOIN departments d ON l.department_id = d.id
      LEFT JOIN equipment e ON l.id = e.lab_id
      LEFT JOIN lab_fields lf ON l.id = lf.lab_id
      LEFT JOIN fields f ON lf.field_id = f.id
      WHERE 1=1
    `;
    
    const queryParams = [];

    if (department_id) {
      query += ' AND l.department_id = ?';
      queryParams.push(department_id);
    }

    if (available_only === 'true') {
      query += ' AND l.is_active = true AND l.status = "active"';
    }

    query += ' GROUP BY l.id';

    const [labs] = await pool.query(query, queryParams);

    // Process the results
    const formattedLabs = labs.map(lab => {
      const fields = lab.fields_data ? lab.fields_data.split(',').map(field => {
        const [id, name, code] = field.split(':');
        return { id: parseInt(id), name, code };
      }) : [];

      const nextBooking = lab.next_booking ? JSON.parse(lab.next_booking) : null;

      return {
        id: lab.id,
        name: lab.name,
        code: lab.code,
        department_id: lab.department_id,
        department_name: lab.department_name,
        capacity: lab.capacity,
        location: lab.location,
        description: lab.description,
        is_active: lab.is_active,
        equipment_count: lab.equipment_count,
        available_fields: fields,
        current_availability: lab.status,
        next_booking: nextBooking
      };
    });

    res.json({
      success: true,
      data: formattedLabs
    });
  } catch (error) {
    console.error('Get all labs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching labs',
      errors: []
    });
  }
};

// Get specific lab details
const getLabById = async (req, res) => {
  try {
    const labId = req.params.id;

    // Get lab details with department
    const [labs] = await pool.query(
      `SELECT l.*, d.name as department_name
       FROM labs l
       LEFT JOIN departments d ON l.department_id = d.id
       WHERE l.id = ?`,
      [labId]
    );

    if (labs.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }

    const lab = labs[0];

    // Get available fields
    const [fields] = await pool.query(
      `SELECT f.id, f.name, f.code
       FROM fields f
       JOIN lab_fields lf ON f.id = lf.field_id
       WHERE lf.lab_id = ?`,
      [labId]
    );

    // Get equipment
    const [equipment] = await pool.query(
      `SELECT id, name, type, quantity, available_quantity
       FROM equipment
       WHERE lab_id = ?`,
      [labId]
    );

    // Get recent bookings
    const [recentBookings] = await pool.query(
      `SELECT b.*, f.name as field_name
       FROM bookings b
       LEFT JOIN fields f ON b.field_id = f.id
       WHERE b.lab_id = ?
       ORDER BY b.start_time DESC
       LIMIT 5`,
      [labId]
    );

    // Get statistics
    const [stats] = await pool.query(
      `SELECT 
        COUNT(*) as total_bookings_this_month,
        (COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM bookings WHERE lab_id = ?), 0)) as utilization_rate,
        (SELECT f.name 
         FROM bookings b 
         JOIN fields f ON b.field_id = f.id 
         WHERE b.lab_id = ? 
         GROUP BY f.id 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as most_used_by_field
       FROM bookings
       WHERE lab_id = ? 
       AND MONTH(start_time) = MONTH(CURRENT_DATE())
       AND YEAR(start_time) = YEAR(CURRENT_DATE())`,
      [labId, labId, labId]
    );

    res.json({
      success: true,
      data: {
        id: lab.id,
        name: lab.name,
        code: lab.code,
        department_id: lab.department_id,
        department: {
          id: lab.department_id,
          name: lab.department_name
        },
        capacity: lab.capacity,
        location: lab.location,
        description: lab.description,
        is_active: lab.is_active,
        created_at: lab.created_at,
        available_fields: fields,
        equipment: equipment,
        recent_bookings: recentBookings,
        statistics: {
          total_bookings_this_month: stats[0].total_bookings_this_month || 0,
          utilization_rate: parseFloat(stats[0].utilization_rate) || 0,
          most_used_by_field: stats[0].most_used_by_field || 'N/A'
        }
      }
    });
  } catch (error) {
    console.error('Get lab by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching lab details',
      errors: []
    });
  }
};

// Check lab availability
const checkLabAvailability = async (req, res) => {
  try {
    const labId = req.params.id;
    const { date, start_time, end_time, field_id } = req.query;

    // Convert date and times to datetime
    const startDateTime = `${date} ${start_time}`;
    const endDateTime = `${date} ${end_time}`;

    // Check for conflicting bookings
    const [conflictingBookings] = await pool.query(
      `SELECT b.*, f.name as field_name
       FROM bookings b
       LEFT JOIN fields f ON b.field_id = f.id
       WHERE b.lab_id = ?
       AND b.status = 'approved'
       AND (
         (b.start_time <= ? AND b.end_time > ?)
         OR (b.start_time < ? AND b.end_time >= ?)
         OR (b.start_time >= ? AND b.end_time <= ?)
       )
       ${field_id ? 'AND b.field_id = ?' : ''}`,
      field_id 
        ? [labId, endDateTime, startDateTime, endDateTime, startDateTime, startDateTime, endDateTime, field_id]
        : [labId, endDateTime, startDateTime, endDateTime, startDateTime, startDateTime, endDateTime]
    );

    // Get available time slots
    const [availableSlots] = await pool.query(
      `SELECT 
        TIME_FORMAT(start_time, '%H:%i') as start_time,
        TIME_FORMAT(end_time, '%H:%i') as end_time
       FROM (
         SELECT 
           @start := DATE_ADD(@start, INTERVAL 2 HOUR) as start_time,
           DATE_ADD(@start, INTERVAL 2 HOUR) as end_time
         FROM (SELECT @start := DATE_FORMAT(?, '%Y-%m-%d 08:00:00')) t1,
         (SELECT @row := 0) t2
         WHERE @start < DATE_FORMAT(?, '%Y-%m-%d 18:00:00')
       ) time_slots
       WHERE NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.lab_id = ?
         AND b.status = 'approved'
         AND DATE(b.start_time) = ?
         AND (
           (b.start_time <= CONCAT(?, ' ', end_time) AND b.end_time > CONCAT(?, ' ', start_time))
           OR (b.start_time < CONCAT(?, ' ', end_time) AND b.end_time >= CONCAT(?, ' ', start_time))
           OR (b.start_time >= CONCAT(?, ' ', start_time) AND b.end_time <= CONCAT(?, ' ', end_time))
         )
       )`,
      [date, date, labId, date, date, date, date, date, date, date, date]
    );

    res.json({
      success: true,
      data: {
        available: conflictingBookings.length === 0,
        conflicting_bookings: conflictingBookings,
        suggested_times: availableSlots
      }
    });
  } catch (error) {
    console.error('Check lab availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking lab availability',
      errors: []
    });
  }
};

// Create new lab
const createLab = async (req, res) => {
  const { name, code, department_id, capacity, location, description, field_ids } = req.body;

  try {
    // Start transaction
    await pool.query('START TRANSACTION');

    // Insert lab
    const [result] = await pool.query(
      `INSERT INTO labs (name, code, department_id, capacity, location, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, code, department_id, capacity, location, description]
    );

    const labId = result.insertId;

    // Insert lab fields
    if (field_ids && field_ids.length > 0) {
      const fieldValues = field_ids.map(fieldId => [labId, fieldId]);
      await pool.query(
        'INSERT INTO lab_fields (lab_id, field_id) VALUES ?',
        [fieldValues]
      );
    }

    // Commit transaction
    await pool.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Lab created successfully',
      data: {
        id: labId,
        name,
        code,
        department_id,
        capacity,
        location
      }
    });
  } catch (error) {
    // Rollback transaction on error
    await pool.query('ROLLBACK');
    console.error('Create lab error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating lab',
      errors: []
    });
  }
};

module.exports = {
  getAllLabs,
  getLabById,
  checkLabAvailability,
  createLab
}; 