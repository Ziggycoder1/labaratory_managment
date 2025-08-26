# Laboratory Information System (LIS)

A comprehensive laboratory management system for the University of Rwanda - College of Medicine and Health Sciences.

## Features

- User Role Management (Admin, Lab Manager, Teacher, Student, External User)
- Lab Booking System
- Stock Management
- Equipment Borrowing System
- Reporting and Analytics

## Tech Stack

- Backend: Node.js with Express
- Database: MySQL
- Authentication: JWT

## Prerequisites

- Node.js (v14 or higher)
- MySQL (v8.0 or higher)
- npm or yarn

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=3000
   NODE_ENV=development
   DB_HOST=localhost
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_NAME=laboratory_db
   DB_PORT=3306
   JWT_SECRET=your_jwt_secret
   JWT_EXPIRES_IN=24h
   ```
4. Set up the database:
   - Create a new MySQL database
   - Run the schema.sql file in `src/config/schema.sql`

## Running the Application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Authentication
- POST /api/auth/register - Register a new user
- POST /api/auth/login - Login user

### Users
- GET /api/users - Get all users (Admin only)
- GET /api/users/:id - Get user by ID
- PUT /api/users/:id - Update user
- DELETE /api/users/:id - Delete user

### Departments
- GET /api/departments - Get all departments
- POST /api/departments - Create department (Admin only)
- PUT /api/departments/:id - Update department
- DELETE /api/departments/:id - Delete department

### Labs
- GET /api/labs - Get all labs
- POST /api/labs - Create lab (Admin/Lab Manager)
- PUT /api/labs/:id - Update lab
- DELETE /api/labs/:id - Delete lab

### Bookings
- GET /api/bookings - Get all bookings
- POST /api/bookings - Create booking
- PUT /api/bookings/:id - Update booking
- DELETE /api/bookings/:id - Cancel booking

### Items
- GET /api/items - Get all items
- POST /api/items - Add new item
- PUT /api/items/:id - Update item
- DELETE /api/items/:id - Delete item

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

This project is licensed under the ISC License. 