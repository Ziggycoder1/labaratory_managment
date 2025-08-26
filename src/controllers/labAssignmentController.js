const Lab = require('../models/Lab');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');

/**
 * Middleware to check if user has permission to manage lab assignments
 */
const checkLabAssignmentPermission = async (req, res, next) => {
  try {
    const { labId } = req.params;
    const userId = req.user.id;
    
    // Check if user is admin or lab manager
    const user = await User.findById(userId);
    if (!['admin', 'lab_manager'].includes(user.role)) {
      return res.status(403).json({ 
        message: 'Only administrators and lab managers can manage lab assignments' 
      });
    }
    
    // For non-admin lab managers, check if they manage this lab
    if (user.role === 'lab_manager') {
      const lab = await Lab.findOne({
        _id: labId,
        'assigned_users.user': userId,
        'assigned_users.role': 'manager'
      });
      
      if (!lab) {
        return res.status(403).json({ 
          message: 'You do not have permission to manage this lab' 
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Error in lab assignment permission check:', error);
    res.status(500).json({ 
      message: 'Error checking permissions', 
      error: error.message 
    });
  }
};

/**
 * Assign a user to a lab
 * @route POST /api/labs/:labId/assignments
 */
exports.assignUser = [
  checkLabAssignmentPermission,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { labId } = req.params;
      const { userId, role = 'technician', notes } = req.body;
      const assignedBy = req.user.id;

      // Check if user to be assigned has valid role
      const userToAssign = await User.findById(userId);
      if (!['admin', 'lab_manager'].includes(userToAssign?.role)) {
        return res.status(400).json({ 
          message: 'Only users with admin or lab_manager role can be assigned to labs' 
        });
      }

      const lab = await Lab.findById(labId);
      if (!lab) {
        return res.status(404).json({ message: 'Lab not found' });
      }

      // Check if user is already assigned
      const existingAssignment = lab.assigned_users.find(
        u => u.user.toString() === userId
      );
      
      if (existingAssignment) {
        return res.status(400).json({ 
          message: 'User already assigned to this lab',
          assignment: existingAssignment
        });
      }

      lab.assigned_users.push({
        user: userId,
        role,
        assigned_by: assignedBy,
        notes,
        assigned_at: new Date()
      });

      // Log the assignment
      lab.audit_log.push({
        action: 'user_assigned',
        performed_by: assignedBy,
        changes: {
          assigned_user: userId,
          role
        }
      });

      await lab.save();
      
      // Populate the user details in the response
      await lab.populate('assigned_users.user', 'name email role');
      
      res.status(200).json({
        message: 'User assigned successfully',
        lab: lab.toObject({ getters: true })
      });
      
    } catch (error) {
      console.error('Error assigning user to lab:', error);
      res.status(500).json({ 
        message: 'Error assigning user to lab', 
        error: error.message 
      });
    }
  }
];

/**
 * Remove a user from a lab
 * @route DELETE /api/labs/:labId/assignments/:userId
 */
exports.removeUser = [
  checkLabAssignmentPermission,
  async (req, res) => {
    try {
      const { labId, userId } = req.params;
      const removedBy = req.user.id;

      const lab = await Lab.findById(labId);
      if (!lab) {
        return res.status(404).json({ message: 'Lab not found' });
      }

      // Prevent removing the last manager
      if (lab.assigned_users.filter(u => u.role === 'manager').length <= 1) {
        const userToRemove = lab.assigned_users.find(u => u.user.toString() === userId);
        if (userToRemove?.role === 'manager') {
          return res.status(400).json({ 
            message: 'Cannot remove the last manager from the lab' 
          });
        }
      }

      const initialCount = lab.assigned_users.length;
      const removedUser = lab.assigned_users.find(u => u.user.toString() === userId);
      
      if (!removedUser) {
        return res.status(404).json({ 
          message: 'User assignment not found' 
        });
      }

      lab.assigned_users = lab.assigned_users.filter(
        u => u.user.toString() !== userId
      );

      // Log the removal
      lab.audit_log.push({
        action: 'user_removed',
        performed_by: removedBy,
        changes: {
          removed_user: userId,
          role: removedUser.role
        }
      });

      await lab.save();
      
      res.status(200).json({ 
        message: 'User removed from lab successfully',
        lab: lab.toObject({ getters: true })
      });
      
    } catch (error) {
      console.error('Error removing user from lab:', error);
      res.status(500).json({ 
        message: 'Error removing user from lab', 
        error: error.message 
      });
    }
  }
];

/**
 * Update a user's role in a lab
 * @route PUT /api/labs/:labId/assignments/:userId
 */
exports.updateUserRole = [
  checkLabAssignmentPermission,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { labId, userId } = req.params;
      const { role, notes } = req.body;
      const updatedBy = req.user.id;

      const lab = await Lab.findById(labId);
      if (!lab) {
        return res.status(404).json({ message: 'Lab not found' });
      }

      const assignment = lab.assigned_users.find(
        u => u.user.toString() === userId
      );

      if (!assignment) {
        return res.status(404).json({ 
          message: 'User assignment not found' 
        });
      }

      // Prevent changing the last manager's role
      if (assignment.role === 'manager' && role !== 'manager') {
        const managerCount = lab.assigned_users.filter(
          u => u.role === 'manager' && u.user.toString() !== userId
        ).length;
        
        if (managerCount === 0) {
          return res.status(400).json({ 
            message: 'Cannot change role of the last manager in the lab' 
          });
        }
      }

      // Store old role for audit log
      const oldRole = assignment.role;
      
      // Update role and notes
      assignment.role = role;
      if (notes) assignment.notes = notes;
      assignment.updated_at = new Date();

      // Log the update
      lab.audit_log.push({
        action: 'user_role_updated',
        performed_by: updatedBy,
        changes: {
          user: userId,
          old_role: oldRole,
          new_role: role
        }
      });

      await lab.save();
      
      // Populate the user details in the response
      await lab.populate('assigned_users.user', 'name email role');
      
      res.status(200).json({
        message: 'User role updated successfully',
        lab: lab.toObject({ getters: true })
      });
      
    } catch (error) {
      console.error('Error updating user role:', error);
      res.status(500).json({ 
        message: 'Error updating user role', 
        error: error.message 
      });
    }
  }
];

/**
 * Get all users assigned to a lab
 * @route GET /api/labs/:labId/assignments
 */
exports.getAssignedUsers = [
  checkLabAssignmentPermission,
  async (req, res) => {
    try {
      const { labId } = req.params;
      
      const lab = await Lab.findById(labId)
        .populate('assigned_users.user', 'name email role')
        .select('assigned_users');
      
      if (!lab) {
        return res.status(404).json({ message: 'Lab not found' });
      }
      
      res.status(200).json({
        data: lab.assigned_users
      });
      
    } catch (error) {
      console.error('Error fetching assigned users:', error);
      res.status(500).json({ 
        message: 'Error fetching assigned users', 
        error: error.message 
      });
    }
  }
];
