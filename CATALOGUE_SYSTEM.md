# Catalogue-Based Item Management System

This document outlines the new catalogue-based item management system for the Laboratory Information System (LIS).

## Overview

The catalogue system introduces a centralized way to manage inventory items across all labs. Each physical item in the system is now linked to a catalogue item, which serves as a template containing all the common properties.

## Key Concepts

### Catalogue Items
- Serve as templates for physical inventory items
- Define common properties like name, description, type, and specifications
- Can be marked as active/inactive
- Support for different item types (consumable, non-consumable, fixed assets)

### Inventory Items
- Represent physical instances of catalogue items
- Linked to specific labs and storage locations
- Track quantities and availability
- Support for both lab storage and temporary storage

### Storage Types
1. **Lab Storage**: Permanent storage within a lab
2. **Temporary Storage**: Used by lab managers for temporary holding

## New API Endpoints

### Catalogue Management
- `GET /api/catalogue` - List all catalogue items
- `POST /api/catalogue` - Create a new catalogue item
- `GET /api/catalogue/:id` - Get a specific catalogue item
- `PUT /api/catalogue/:id` - Update a catalogue item
- `DELETE /api/catalogue/:id` - Delete a catalogue item (soft delete)
- `GET /api/catalogue/:id/inventory` - View inventory across labs for a catalogue item

### Item Transfers
- `POST /api/items/transfer` - Transfer items between storage locations
  - Supports lab-to-lab, lab-to-temp, and temp-to-lab transfers
  - Tracks transfer history with detailed logs

## Migration Process

To migrate from the old system to the new catalogue-based system, follow these steps:

1. **Backup your database**
   ```bash
   mongodump --uri="YOUR_MONGODB_URI" --out=./backup-$(date +%F)
   ```

2. **Run the migration script**
   ```bash
   cd backend/labaratory_managment
   node scripts/migrateToCatalogue.js
   ```

3. **Verify the migration**
   - Check that all items now have a `catalogue_item_id`
   - Verify that catalogue items were created correctly
   - Test item transfers between storage locations

## Best Practices

1. **Creating New Items**
   - Always create a catalogue item first
   - Use the catalogue item ID when creating inventory items
   - Set appropriate storage type (lab or temporary)

2. **Managing Inventory**
   - Use the transfer endpoint to move items between locations
   - Regularly review low stock alerts
   - Keep catalogue item information up to date

3. **Fixed Assets**
   - Include all required specifications (model number, warranty, etc.)
   - Set up maintenance schedules
   - Track asset conditions and locations

## Troubleshooting

### Common Issues

1. **Missing Catalogue Item**
   - Error: "Catalogue item not found"
   - Solution: Create the catalogue item first before adding inventory

2. **Insufficient Quantity**
   - Error: "Insufficient quantity available for transfer"
   - Solution: Check available quantity before transferring

3. **Duplicate Catalogue Items**
   - Issue: Multiple catalogue items for the same product
   - Solution: Merge duplicates and update references

## Support

For assistance with the catalogue system, contact the LIS support team at [support@lis.rw](mailto:support@lis.rw).
