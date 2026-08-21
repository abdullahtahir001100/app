const Notification = require('../models/Notification');

async function getNotifications(userId, { filter, search, page = 1, limit = 20 }) {
    const query = { userId, isDeleted: { $ne: true } };
    if (filter && filter !== 'all') {
        query.category = filter;
    }
    if (search) {
        query.title = { $regex: search, $options: 'i' };
    }

    const notifications = await Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

    const total = await Notification.countDocuments(query);

    return { notifications, total, page, limit };
}

async function getNotificationById(userId, notificationId) {
    return Notification.findOne({ _id: notificationId, userId, isDeleted: { $ne: true } }).lean();
}

async function createNotification(userId, notificationData) {
    const notification = new Notification({ ...notificationData, userId });
    await notification.save();
    return notification;
}

async function markNotificationAsRead(userId, notificationId) {
    return Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { read: true },
        { new: true }
    ).lean();
}

async function markAllNotificationsAsRead(deviceId) {
    return Notification.updateMany(
        {
            deviceId,
            read: false,
            isDeleted: { $ne: true }
        },
        {
            $set: {
                read: true
            }
        }
    );
}

async function deleteNotification(userId, notificationId) {
    return Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { $set: { isDeleted: true } },
        { new: true }
    );
}

async function deleteNotifications(userId, notificationIds) {
    return Notification.updateMany(
        { _id: { $in: notificationIds }, userId },
        { $set: { isDeleted: true } }
    );
}

module.exports = {
    getNotifications,
    getNotificationById,
    createNotification,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    deleteNotifications,
};
