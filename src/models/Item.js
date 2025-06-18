const db = require('../config/database');

class Item {
    static async findAll({ lab_id, type, low_stock, expiring_soon, page = 1, limit = 20 }) {
        const offset = (page - 1) * limit;
        let query = `
            SELECT 
                i.*,
                l.name as lab_name,
                (SELECT COUNT(*) FROM borrow_logs bl WHERE bl.item_id = i.id AND bl.status = 'borrowed') as borrowed_quantity
            FROM items i
            LEFT JOIN labs l ON i.lab_id = l.id
            WHERE 1=1
        `;
        const params = [];

        if (lab_id) {
            query += ' AND i.lab_id = ?';
            params.push(lab_id);
        }

        if (type) {
            query += ' AND i.type = ?';
            params.push(type);
        }

        if (low_stock) {
            query += ' AND i.available_quantity <= i.minimum_quantity';
        }

        if (expiring_soon) {
            query += ' AND i.expiry_date IS NOT NULL AND i.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
        }

        // Get total count for pagination
        const [countResult] = await db.query(
            `SELECT COUNT(*) as total FROM (${query}) as count_query`,
            params
        );
        const totalCount = countResult[0].total;

        // Add pagination
        query += ' LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const [items] = await db.query(query, params);

        // Get alerts summary
        const [alerts] = await db.query(`
            SELECT 
                SUM(CASE WHEN available_quantity <= minimum_quantity THEN 1 ELSE 0 END) as low_stock_count,
                SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as expiring_soon_count,
                SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date < CURDATE() THEN 1 ELSE 0 END) as expired_count
            FROM items
            WHERE 1=1
            ${lab_id ? 'AND lab_id = ?' : ''}
        `, lab_id ? [lab_id] : []);

        return {
            items,
            pagination: {
                current_page: parseInt(page),
                total_pages: Math.ceil(totalCount / limit),
                total_count: totalCount,
                per_page: parseInt(limit)
            },
            alerts: alerts[0]
        };
    }

    static async findById(id) {
        const [items] = await db.query(`
            SELECT 
                i.*,
                l.name as lab_name,
                l.id as lab_id
            FROM items i
            LEFT JOIN labs l ON i.lab_id = l.id
            WHERE i.id = ?
        `, [id]);

        if (items.length === 0) {
            return null;
        }

        const item = items[0];

        // Get current borrowers
        const [borrowers] = await db.query(`
            SELECT 
                bl.user_id,
                u.full_name as user_name,
                bl.borrow_date,
                bl.return_date as expected_return,
                bl.quantity
            FROM borrow_logs bl
            JOIN users u ON bl.user_id = u.id
            WHERE bl.item_id = ? AND bl.status = 'borrowed'
        `, [id]);

        // Get maintenance history
        const [maintenance] = await db.query(`
            SELECT 
                date,
                type,
                description,
                performed_by
            FROM maintenance_logs
            WHERE item_id = ?
            ORDER BY date DESC
        `, [id]);

        // Get stock movements
        const [movements] = await db.query(`
            SELECT 
                created_at as date,
                change_quantity as quantity,
                reason,
                u.full_name as performed_by
            FROM stock_logs sl
            JOIN users u ON sl.user_id = u.id
            WHERE sl.item_id = ?
            ORDER BY created_at DESC
        `, [id]);

        return {
            ...item,
            current_borrowers: borrowers,
            maintenance_history: maintenance,
            stock_movements: movements
        };
    }

    static async create(itemData) {
        const [result] = await db.query(`
            INSERT INTO items (
                name, type, lab_id, quantity, available_quantity,
                unit, expiry_date, minimum_quantity, description,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            itemData.name,
            itemData.type,
            itemData.lab_id,
            itemData.quantity,
            itemData.quantity, // Initially available_quantity equals total quantity
            itemData.unit,
            itemData.expiry_date,
            itemData.minimum_quantity,
            itemData.description,
            'available'
        ]);

        return {
            id: result.insertId,
            name: itemData.name,
            quantity: itemData.quantity,
            available_quantity: itemData.quantity
        };
    }

    static async update(id, updateData) {
        const [result] = await db.query(`
            UPDATE items 
            SET ? 
            WHERE id = ?
        `, [updateData, id]);

        return result.affectedRows > 0;
    }

    static async adjustStock(id, adjustmentData) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Get current item data
            const [items] = await connection.query(
                'SELECT quantity, available_quantity FROM items WHERE id = ?',
                [id]
            );

            if (items.length === 0) {
                throw new Error('Item not found');
            }

            const item = items[0];
            const adjustment = adjustmentData.adjustment_type === 'add' 
                ? adjustmentData.quantity 
                : -adjustmentData.quantity;

            // Update item quantities
            await connection.query(`
                UPDATE items 
                SET quantity = quantity + ?,
                    available_quantity = available_quantity + ?
                WHERE id = ?
            `, [adjustment, adjustment, id]);

            // Log the stock adjustment
            const [logResult] = await connection.query(`
                INSERT INTO stock_logs (
                    item_id, user_id, change_quantity, reason
                ) VALUES (?, ?, ?, ?)
            `, [
                id,
                adjustmentData.user_id,
                adjustment,
                adjustmentData.reason
            ]);

            await connection.commit();

            return {
                old_quantity: item.quantity,
                new_quantity: item.quantity + adjustment,
                adjustment: adjustment,
                log_id: logResult.insertId
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async getAlerts({ type, lab_id }) {
        let query = `
            SELECT 
                i.id,
                i.name as item_name,
                i.available_quantity as current_quantity,
                i.minimum_quantity as reorder_level,
                i.expiry_date,
                l.name as lab_name,
                CASE 
                    WHEN i.available_quantity <= i.minimum_quantity THEN 'low_stock'
                    WHEN i.expiry_date IS NOT NULL AND i.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'expiring_soon'
                    WHEN i.expiry_date IS NOT NULL AND i.expiry_date < CURDATE() THEN 'expired'
                END as alert_type,
                CASE 
                    WHEN i.available_quantity <= i.minimum_quantity THEN 'medium'
                    WHEN i.expiry_date IS NOT NULL AND i.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 'high'
                    ELSE 'low'
                END as severity,
                CASE 
                    WHEN i.available_quantity <= i.minimum_quantity THEN CONCAT(i.name, ' stock is below reorder level')
                    WHEN i.expiry_date IS NOT NULL AND i.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN CONCAT(i.name, ' expires in ', DATEDIFF(i.expiry_date, CURDATE()), ' days')
                    ELSE NULL
                END as message
            FROM items i
            LEFT JOIN labs l ON i.lab_id = l.id
            WHERE (
                i.available_quantity <= i.minimum_quantity
                OR (i.expiry_date IS NOT NULL AND i.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY))
            )
        `;
        const params = [];

        if (type) {
            query += ` AND (
                CASE 
                    WHEN i.available_quantity <= i.minimum_quantity THEN 'low_stock'
                    WHEN i.expiry_date IS NOT NULL AND i.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'expiring_soon'
                    WHEN i.expiry_date IS NOT NULL AND i.expiry_date < CURDATE() THEN 'expired'
                END
            ) = ?`;
            params.push(type);
        }

        if (lab_id) {
            query += ' AND i.lab_id = ?';
            params.push(lab_id);
        }

        const [alerts] = await db.query(query, params);

        // Get summary
        const [summary] = await db.query(`
            SELECT 
                COUNT(*) as total_alerts,
                SUM(CASE WHEN available_quantity <= minimum_quantity THEN 1 ELSE 0 END) as low_stock,
                SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as expiring_soon,
                SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date < CURDATE() THEN 1 ELSE 0 END) as expired,
                SUM(CASE WHEN next_maintenance IS NOT NULL AND next_maintenance <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as maintenance_due
            FROM items
            WHERE 1=1
            ${lab_id ? 'AND lab_id = ?' : ''}
        `, lab_id ? [lab_id] : []);

        return {
            alerts,
            summary: summary[0]
        };
    }
}

module.exports = Item; 