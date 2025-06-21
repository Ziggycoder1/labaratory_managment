# 🏢 Laboratory Management System - API Documentation

## 📋 Enhanced Booking System

The booking system has been enhanced to handle professional laboratory bookings with item requirements, recurring bookings, and comprehensive management features.

---

## 🔐 Authentication

All endpoints require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

---

## 📚 Booking API Endpoints

### 1. **Get All Bookings** (Admin/Lab Manager)
```http
GET /api/bookings?lab_id=...&field_id=...&user_id=...&status=...&booking_type=...&start_date=...&end_date=...&page=1&limit=20
```

**Query Parameters:**
- `lab_id` (optional): Filter by lab ID
- `field_id` (optional): Filter by field ID  
- `user_id` (optional): Filter by user ID
- `status` (optional): Filter by status (pending/approved/rejected/cancelled/completed)
- `booking_type` (optional): Filter by booking type (research/teaching/practical/maintenance/other)
- `start_date` (optional): Filter bookings from this date
- `end_date` (optional): Filter bookings until this date
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response:**
```json
{
  "success": true,
  "data": {
    "bookings": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "lab": {
          "_id": "507f1f77bcf86cd799439012",
          "name": "Chemistry Lab 101",
          "code": "CHEM101",
          "capacity": 30
        },
        "field": {
          "_id": "507f1f77bcf86cd799439013",
          "name": "Chemistry",
          "code": "CHEM"
        },
        "user": {
          "_id": "507f1f77bcf86cd799439014",
          "full_name": "John Doe",
          "email": "john@example.com",
          "department": "Chemistry"
        },
        "start_time": "2024-01-15T10:00:00.000Z",
        "end_time": "2024-01-15T12:00:00.000Z",
        "purpose": "Research experiment on organic compounds",
        "booking_type": "research",
        "participants_count": 5,
        "equipment_needed": "Microscopes, test tubes",
        "item_requirements": [
          {
            "item": {
              "_id": "507f1f77bcf86cd799439015",
              "name": "Test Tubes",
              "type": "equipment",
              "available_quantity": 50
            },
            "quantity_needed": 20,
            "notes": "For chemical reactions"
          }
        ],
        "status": "approved",
        "approved_by": {
          "_id": "507f1f77bcf86cd799439016",
          "full_name": "Admin User",
          "email": "admin@example.com"
        },
        "approved_at": "2024-01-10T09:00:00.000Z",
        "special_instructions": "Handle with care",
        "setup_time_needed": 15,
        "cleanup_time_needed": 30,
        "is_recurring": false,
        "created_at": "2024-01-10T08:00:00.000Z",
        "updated_at": "2024-01-10T09:00:00.000Z"
      }
    ],
    "pagination": {
      "current_page": 1,
      "total_pages": 5,
      "total_count": 100,
      "per_page": 20
    }
  }
}
```

### 2. **Get Booking Statistics** (Admin/Lab Manager)
```http
GET /api/bookings/stats?lab_id=...&start_date=...&end_date=...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "stats": [
      {
        "_id": "approved",
        "count": 45,
        "total_hours": 180.5
      },
      {
        "_id": "pending",
        "count": 12,
        "total_hours": 48.0
      }
    ],
    "total_bookings": 100,
    "upcoming_bookings": 25
  }
}
```

### 3. **Get Specific Booking**
```http
GET /api/bookings/:id
```

### 4. **Create New Booking**
```http
POST /api/bookings
```

**Request Body:**
```json
{
  "lab_id": "507f1f77bcf86cd799439012",
  "field_id": "507f1f77bcf86cd799439013",
  "start_time": "2024-01-15T10:00:00Z",
  "end_time": "2024-01-15T12:00:00Z",
  "purpose": "Research experiment on organic compounds",
  "booking_type": "research",
  "participants_count": 5,
  "equipment_needed": "Microscopes, test tubes",
  "item_requirements": [
    {
      "item": "507f1f77bcf86cd799439015",
      "quantity_needed": 20,
      "notes": "For chemical reactions"
    }
  ],
  "special_instructions": "Handle with care",
  "setup_time_needed": 15,
  "cleanup_time_needed": 30,
  "is_recurring": false,
  "recurring_pattern": {
    "frequency": "weekly",
    "end_date": "2024-02-15T12:00:00Z",
    "days_of_week": [1, 3, 5]
  }
}
```

**Features:**
- ✅ **Item Requirements**: Specify items needed for the booking
- ✅ **Capacity Validation**: Check lab capacity vs participants
- ✅ **Item Availability**: Verify items are in stock
- ✅ **Recurring Bookings**: Create weekly/daily/monthly recurring bookings
- ✅ **Setup/Cleanup Time**: Reserve additional time for setup and cleanup
- ✅ **Booking Types**: Categorize bookings (research, teaching, practical, etc.)

### 5. **Update Booking Status** (Admin/Lab Manager)
```http
PUT /api/bookings/:id/status
```

**Request Body:**
```json
{
  "status": "approved",
  "rejection_reason": "Insufficient equipment available"
}
```

### 6. **Cancel Booking**
```http
DELETE /api/bookings/:id
```

**Features:**
- ✅ **24-hour Rule**: Users can only cancel bookings 24+ hours before start
- ✅ **Admin Override**: Admins can cancel any booking
- ✅ **Ownership Check**: Users can only cancel their own bookings

### 7. **Check Lab Availability**
```http
GET /api/bookings/availability/check?lab_id=...&start_time=...&end_time=...&exclude_booking_id=...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "available": false,
    "conflicting_bookings": [
      {
        "_id": "507f1f77bcf86cd799439017",
        "start_time": "2024-01-15T09:00:00.000Z",
        "end_time": "2024-01-15T11:00:00.000Z",
        "user": {
          "full_name": "Jane Smith"
        },
        "field": {
          "name": "Chemistry",
          "code": "CHEM"
        }
      }
    ],
    "lab_details": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Chemistry Lab 101",
      "code": "CHEM101",
      "capacity": 30,
      "fields": [...]
    },
    "requested_time": {
      "start": "2024-01-15T10:00:00Z",
      "end": "2024-01-15T12:00:00Z",
      "duration_hours": 2
    }
  }
}
```

### 8. **Get My Bookings** (Current User)
```http
GET /api/bookings/my/bookings?status=...&booking_type=...&page=1&limit=20
```

---

## 🔧 Enhanced Features

### **Item Requirements Management**
- ✅ **Stock Validation**: System checks if required items are available
- ✅ **Quantity Tracking**: Track how many items are needed for each booking
- ✅ **Notes**: Add specific notes for each item requirement
- ✅ **Automatic Updates**: Item availability is checked in real-time

### **Recurring Bookings**
- ✅ **Multiple Frequencies**: Daily, weekly, monthly patterns
- ✅ **Day Selection**: Choose specific days of the week
- ✅ **End Date**: Set when recurring bookings should stop
- ✅ **Bulk Creation**: Creates multiple bookings automatically

### **Professional Booking Types**
- ✅ **Research**: For research activities
- ✅ **Teaching**: For educational purposes
- ✅ **Practical**: For hands-on experiments
- ✅ **Maintenance**: For lab maintenance
- ✅ **Other**: For miscellaneous activities

### **Time Management**
- ✅ **Setup Time**: Reserve time before the booking for setup
- ✅ **Cleanup Time**: Reserve time after the booking for cleanup
- ✅ **Duration Calculation**: Automatic calculation of booking duration
- ✅ **Conflict Detection**: Prevents overlapping bookings

### **Approval Workflow**
- ✅ **Status Tracking**: pending → approved/rejected → completed/cancelled
- ✅ **Approval History**: Track who approved and when
- ✅ **Rejection Reasons**: Provide reasons for rejected bookings
- ✅ **Role-based Approval**: Only admins/lab managers can approve

---

## 📊 Booking Status Flow

```
PENDING → APPROVED → COMPLETED
    ↓
REJECTED
    ↓
CANCELLED
```

---

## 🛡️ Security & Validation

### **Input Validation**
- ✅ **MongoDB ID Validation**: All IDs are validated
- ✅ **Date Validation**: ISO 8601 date format required
- ✅ **Enum Validation**: Booking types and statuses are validated
- ✅ **Number Validation**: Quantities and counts are validated
- ✅ **Required Fields**: Essential fields are mandatory

### **Authorization**
- ✅ **JWT Authentication**: All endpoints require valid tokens
- ✅ **Role-based Access**: Different permissions for different roles
- ✅ **Ownership Validation**: Users can only access their own data
- ✅ **Admin Override**: Admins have full access

### **Business Logic**
- ✅ **Capacity Limits**: Respect lab capacity limits
- ✅ **Time Conflicts**: Prevent overlapping bookings
- ✅ **Item Availability**: Check item stock before booking
- ✅ **Cancellation Rules**: Enforce cancellation time limits

---

## 🚀 Usage Examples

### **Create a Research Booking with Items**
```javascript
const bookingData = {
  lab_id: "507f1f77bcf86cd799439012",
  field_id: "507f1f77bcf86cd799439013",
  start_time: "2024-01-15T10:00:00Z",
  end_time: "2024-01-15T14:00:00Z",
  purpose: "Advanced organic chemistry research",
  booking_type: "research",
  participants_count: 3,
  equipment_needed: "Spectrophotometer, centrifuge",
  item_requirements: [
    {
      item: "507f1f77bcf86cd799439015",
      quantity_needed: 50,
      notes: "For sample preparation"
    },
    {
      item: "507f1f77bcf86cd799439016",
      quantity_needed: 10,
      notes: "For chemical reactions"
    }
  ],
  special_instructions: "Handle hazardous materials with care",
  setup_time_needed: 30,
  cleanup_time_needed: 45
};

fetch('/api/bookings', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify(bookingData)
});
```

### **Create Weekly Recurring Bookings**
```javascript
const recurringBooking = {
  lab_id: "507f1f77bcf86cd799439012",
  field_id: "507f1f77bcf86cd799439013",
  start_time: "2024-01-15T09:00:00Z",
  end_time: "2024-01-15T11:00:00Z",
  purpose: "Weekly chemistry practical",
  booking_type: "teaching",
  participants_count: 25,
  is_recurring: true,
  recurring_pattern: {
    frequency: "weekly",
    end_date: "2024-05-15T11:00:00Z",
    days_of_week: [1, 3] // Monday and Wednesday
  }
};
```

---

## 📈 Dashboard Integration

The booking system provides comprehensive data for dashboard integration:

- **Booking Statistics**: Total bookings, upcoming bookings, utilization rates
- **Lab Utilization**: Track how often labs are used
- **Item Usage**: Monitor which items are most requested
- **User Activity**: Track booking patterns by users
- **Approval Metrics**: Monitor approval/rejection rates

---

This enhanced booking system provides a professional, comprehensive solution for laboratory management with advanced features for item requirements, recurring bookings, and detailed tracking. 