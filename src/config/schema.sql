-- Create database
CREATE DATABASE IF NOT EXISTS laboratory_db;
USE laboratory_db;

-- Departments table
CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(10) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    department_id INT,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'lab_manager', 'teacher', 'student', 'external') NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    reset_token VARCHAR(255) DEFAULT NULL,
    reset_token_expiry DATETIME DEFAULT NULL,
    last_login DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- Labs table
CREATE TABLE IF NOT EXISTS labs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    department_id INT,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    capacity INT NOT NULL,
    location VARCHAR(255) NOT NULL,
    description TEXT,
    status ENUM('active', 'maintenance', 'inactive') DEFAULT 'active',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- Fields table
CREATE TABLE IF NOT EXISTS fields (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(10) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- LabFields table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS lab_fields (
    lab_id INT,
    field_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lab_id, field_id),
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE,
    FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE
);

-- Items table (consolidated equipment and items)
CREATE TABLE IF NOT EXISTS items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    lab_id INT,
    name VARCHAR(100) NOT NULL,
    type ENUM('consumable', 'non_consumable', 'fixed') NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    available_quantity INT NOT NULL DEFAULT 0,
    unit VARCHAR(50),
    expiry_date DATE,
    minimum_quantity INT DEFAULT 0,
    description TEXT,
    status ENUM('available', 'maintenance', 'disposed') DEFAULT 'available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE
);

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    lab_id INT,
    field_id INT,
    user_id INT,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    purpose TEXT,
    status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE,
    FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- BorrowLogs table
CREATE TABLE IF NOT EXISTS borrow_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    item_id INT,
    user_id INT,
    lab_id INT,
    borrow_date DATETIME NOT NULL,
    return_date DATETIME,
    status ENUM('borrowed', 'returned') DEFAULT 'borrowed',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (lab_id) REFERENCES labs(id)
);

-- StockLogs table
CREATE TABLE IF NOT EXISTS stock_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    item_id INT,
    user_id INT,
    change_quantity INT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Add indexes for better performance
CREATE INDEX idx_lab_department ON labs(department_id);
CREATE INDEX idx_lab_code ON labs(code);
CREATE INDEX idx_lab_status ON labs(status);
CREATE INDEX idx_lab_active ON labs(is_active);
CREATE INDEX idx_booking_lab ON bookings(lab_id);
CREATE INDEX idx_booking_field ON bookings(field_id);
CREATE INDEX idx_booking_user ON bookings(user_id);
CREATE INDEX idx_booking_time ON bookings(start_time, end_time);
CREATE INDEX idx_items_lab ON items(lab_id);
CREATE INDEX idx_items_type ON items(type);
CREATE INDEX idx_items_status ON items(status); 