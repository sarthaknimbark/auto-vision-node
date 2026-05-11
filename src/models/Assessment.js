const mongoose = require('mongoose');

const AssessmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String }, // Denormalized for easy listing
    userEmail: { type: String }, // Denormalized so reports always show contact without relying on populate
    vehicleInfo: {
        make: String,
        model: String,
        year: Number
    },
    results: { type: mongoose.Schema.Types.Mixed },
    /** @deprecated Old rows may still hold a data URL or blob string here */
    imageUrl: { type: String, default: '' },
    /** MIME type for imageData (e.g. image/jpeg) */
    imageData: { type: Buffer, select: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Assessment', AssessmentSchema);
