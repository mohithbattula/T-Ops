import { supabase } from '../lib/supabaseClient';

/**
 * Send a notification to a user
 * @param {string} receiverId - ID of the user receiving the notification
 * @param {string} senderId - ID of the user sending the notification
 * @param {string} senderName - Name of the sender
 * @param {string} message - Notification message
 * @param {string} type - Type of notification (task_assigned, announcement, leave_request, etc.)
 * @returns {Promise<void>}
 */
export const sendNotification = async (receiverId, senderId, senderName, message, type, orgId) => {
    try {
        const payload = {
            receiver_id: receiverId,
            sender_id: senderId,
            sender_name: senderName,
            message: message,
            type: type,
            is_read: false,
            created_at: new Date().toISOString()
        };

        if (orgId) {
            payload.org_id = orgId;
        }

        const { error } = await supabase
            .from('notifications')
            .insert(payload);

        if (error) throw error;
    } catch (error) {
        console.error('Error sending notification:', error);
        // Don't throw - notifications failing shouldn't break the main flow
    }
};

/**
 * Send notifications to multiple users
 * @param {Array<string>} receiverIds - Array of user IDs to receive the notification
 * @param {string} senderId - ID of the user sending the notification
 * @param {string} senderName - Name of the sender
 * @param {string} message - Notification message
 * @param {string} type - Type of notification
 * @param {string} orgId - Organization ID
 * @returns {Promise<void>}
 */
export const sendBulkNotifications = async (receiverIds, senderId, senderName, message, type, orgId) => {
    try {
        const notifications = receiverIds.map(receiverId => {
            const payload = {
                receiver_id: receiverId,
                sender_id: senderId,
                sender_name: senderName,
                message: message,
                type: type,
                is_read: false,
                created_at: new Date().toISOString()
            };

            if (orgId) {
                payload.org_id = orgId;
            }
            return payload;
        });

        const { error } = await supabase
            .from('notifications')
            .insert(notifications);

        if (error) throw error;
    } catch (error) {
        console.error('Error sending bulk notifications:', error);
        // Don't throw - notifications failing shouldn't break the main flow
    }
};

/**
 * Send task assignment notification
 * @param {string} assignedToId - ID of the user the task is assigned to
 * @param {string} assignerId - ID of the user assigning the task
 * @param {string} assignerName - Name of the assigner
 * @param {string} taskTitle - Title of the task
 * @param {string} orgId - Organization ID
 * @returns {Promise<void>}
 */
export const sendTaskAssignedNotification = async (assignedToId, assignerId, assignerName, taskTitle, orgId) => {
    const message = `You have been assigned a new task: ${taskTitle}`;
    await sendNotification(assignedToId, assignerId, assignerName, message, 'task_assigned', orgId);
};

/**
 * Send announcement notification to all relevant users
 * @param {Array<string>} recipientIds - Array of user IDs who should receive the announcement
 * @param {string} creatorId - ID of the user creating the announcement
 * @param {string} creatorName - Name of the creator
 * @param {string} announcementTitle - Title of the announcement
 * @param {string} orgId - Organization ID
 * @returns {Promise<void>}
 */
export const sendAnnouncementNotification = async (recipientIds, creatorId, creatorName, announcementTitle, orgId) => {
    const message = `${announcementTitle}`;
    await sendBulkNotifications(recipientIds, creatorId, creatorName, message, 'announcement', orgId);
};
