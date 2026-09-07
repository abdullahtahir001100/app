const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Dynamic event name from Rust
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // High level grouping
    category: {
      type: String,
      default: "system",
      index: true,
    },

    // Chrome, Edge, VLC, Explorer.exe, Discord etc
    appName: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    processName: {
      type: String,
      trim: true,
      default: "",
    },

    executablePath: {
      type: String,
      default: "",
    },

    windowTitle: {
      type: String,
      default: "",
    },

    url: {
      type: String,
      default: "",
    },

    domain: {
      type: String,
      default: "",
      index: true,
    },

    fileName: {
      type: String,
      default: "",
    },

    filePath: {
      type: String,
      default: "",
    },

    fileExtension: {
      type: String,
      default: "",
    },

    fileSize: {
      type: Number,
      default: 0,
    },

    device: {
      type: String,
      default: "",
    },

    details: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      default: "success",
    },

    duration: {
      type: Number,
      default: 0, // seconds
    },

    ipAddress: {
      type: String,
      default: "",
    },

    latitude: Number,

    longitude: Number,

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Performance indexes
ActivityLogSchema.index({ deviceId: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1, createdAt: -1 });
ActivityLogSchema.index({ category: 1, createdAt: -1 });
ActivityLogSchema.index({ appName: 1, createdAt: -1 });
ActivityLogSchema.index({ processName: 1, createdAt: -1 });
ActivityLogSchema.index({ domain: 1, createdAt: -1 });
ActivityLogSchema.index({ url: 1 });
ActivityLogSchema.index({ status: 1 });

module.exports =
  mongoose.models.ActivityLog ||
  mongoose.model("ActivityLog", ActivityLogSchema);