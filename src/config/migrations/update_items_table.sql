-- Start transaction
START TRANSACTION;

-- 1. First, backup equipment data
CREATE TEMPORARY TABLE equipment_backup AS
SELECT * FROM equipment;

-- 2. Add new columns to items table if they don't exist
ALTER TABLE items
ADD COLUMN IF NOT EXISTS available_quantity INT NOT NULL DEFAULT 0 AFTER quantity,
ADD COLUMN IF NOT EXISTS description TEXT AFTER minimum_quantity,
ADD COLUMN IF NOT EXISTS status ENUM('available', 'maintenance', 'disposed') DEFAULT 'available' AFTER description;

-- 3. Migrate data from equipment to items
INSERT INTO items (
    lab_id,
    name,
    type,
    quantity,
    available_quantity,
    description,
    status,
    created_at,
    updated_at
)
SELECT 
    lab_id,
    name,
    CASE 
        WHEN type = 'non-consumable' THEN 'non_consumable'
        ELSE type
    END as type,
    quantity,
    available_quantity,
    NULL as description,
    'available' as status,
    created_at,
    updated_at
FROM equipment_backup
ON DUPLICATE KEY UPDATE
    available_quantity = VALUES(available_quantity),
    status = VALUES(status);

-- 4. Update existing items to set available_quantity equal to quantity
UPDATE items 
SET available_quantity = quantity 
WHERE available_quantity = 0;

-- 5. Drop the equipment table
DROP TABLE IF EXISTS equipment;

-- 6. Update indexes
DROP INDEX IF EXISTS idx_equipment_lab ON items;
CREATE INDEX IF NOT EXISTS idx_items_lab ON items(lab_id);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);

-- Commit the transaction
COMMIT; 