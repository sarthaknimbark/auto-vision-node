const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { auth, admin } = require('../middleware/auth');
const Assessment = require('../models/Assessment');
const User = require('../models/User');


function authImage(req, res, next) {
    const token = req.header('x-auth-token') || req.query.token;
    if (!token) return res.status(401).send('Unauthorized');
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(403).send('Invalid token');
    }
}

function decodeDataUrlToBuffer(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return { buffer: null, mime: null };
    const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return { buffer: null, mime: null };
    try {
        return { buffer: Buffer.from(m[2], 'base64'), mime: m[1] };
    } catch {
        return { buffer: null, mime: null };
    }
}

function historyImageDownloadUrl(req, assessmentId, token) {
    const base = `${req.protocol}://${req.get('host')}`;
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${base}/api/data/assessment/${assessmentId}/image${q}`;
}

function attachHistoryImageUrls(req, docs) {
    const token = req.header('x-auth-token') || '';
    return docs.map((h) => {
        const id = String(h._id);
        if (id && /^[a-f\d]{24}$/i.test(id)) {
            return { ...h, imageUrl: historyImageDownloadUrl(req, id, token) };
        }
        return h;
    });
}

function toObjectId(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    return new mongoose.Types.ObjectId(String(id));
}

function assessmentUserIdString(doc) {
    const raw = doc.userId;
    if (raw == null) return null;
    if (typeof raw === 'object' && raw._id != null) return String(raw._id);
    if (typeof raw === 'string') return raw;
    return String(raw);
}

/** Ensures ownerEmail/ownerName on each doc even if populate did not attach a user. */
async function enrichAssessmentsWithOwner(docs) {
    const idSet = new Set();
    for (const h of docs) {
        const id = assessmentUserIdString(h);
        if (id && /^[a-f\d]{24}$/i.test(id)) idSet.add(id);
    }
    const ids = [...idSet];
    let byId = {};
    if (ids.length) {
        const users = await User.find({ _id: { $in: ids } }).select('email name').lean();
        byId = Object.fromEntries(users.map((u) => [String(u._id), u]));
    }
    return docs.map((h) => {
        const populated =
            h.userId &&
            typeof h.userId === 'object' &&
            typeof h.userId.email === 'string' &&
            h.userId.email.length > 0;
        const id = assessmentUserIdString(h);
        const lookup = id && /^[a-f\d]{24}$/i.test(id) ? byId[id] : null;
        const email =
            (h.userEmail && String(h.userEmail).trim()) ||
            (populated ? h.userId.email : null) ||
            (lookup?.email ?? null);
        const name =
            (populated && h.userId.name) ||
            lookup?.name ||
            h.userName ||
            null;
        return { ...h, ownerEmail: email, ownerName: name };
    });
}

// --- HISTORY ROUTES ---


router.get('/assessment/:id/image', authImage, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Bad id');

        const doc = await Assessment.findById(id).select('+imageData');
        if (!doc) return res.status(404).send('Not found');

        let data = doc.imageData;
        let mime = doc.imageMime || 'image/jpeg';

        // Fallback: If no binary imageData, check the legacy imageUrl field
        if (!data?.length && doc.imageUrl && doc.imageUrl.startsWith('data:')) {
            const decoded = decodeDataUrlToBuffer(doc.imageUrl);
            data = decoded.buffer;
            mime = decoded.mime;
        }

        if (!data?.length) {
            return res.status(404).send('No image data found');
        }

        const requesterId = String(req.user.id);
        const ownerId = String(doc.userId);
        if (req.user.role !== 'admin' && ownerId !== requesterId) {
            return res.status(403).send('Forbidden');
        }

        res.set('Content-Type', mime);
        res.set('Cache-Control', 'private, max-age=3600');
        res.set('Access-Control-Allow-Origin', '*');
        res.send(data);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});


router.post('/', auth, async (req, res) => {
    try {
        const { vehicleInfo, results, imageUrl } = req.body;
        const userId = toObjectId(req.user.id);
        if (!userId) return res.status(400).json({ msg: 'Invalid user id in token' });

        const owner = await User.findById(userId).select('email name').lean();
        const { buffer, mime } = decodeDataUrlToBuffer(imageUrl);

        const newAssessment = new Assessment({
            userId,
            userName: owner?.name || req.user.name,
            userEmail: owner?.email || '',
            vehicleInfo,
            results,
            imageData: buffer && buffer.length ? buffer : undefined,
            imageMime: buffer && buffer.length ? mime : undefined,
            imageUrl:
                buffer && buffer.length
                    ? ''
                    : typeof imageUrl === 'string' && imageUrl && !imageUrl.startsWith('blob:')
                      ? imageUrl
                      : '',
        });
        await newAssessment.save();

        const lean = await Assessment.findById(newAssessment._id).lean();
        const withUrl = attachHistoryImageUrls(req, await enrichAssessmentsWithOwner([lean]));
        res.json(withUrl[0]);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});


router.get('/', auth, async (req, res) => {
    try {
        const sort = { createdAt: -1 };
        const uid = toObjectId(req.user.id);
        const q =
            req.user.role === 'admin'
                ? Assessment.find()
                : Assessment.find(uid ? { userId: uid } : { userId: req.user.id });
        let history = await q.sort(sort).populate('userId', 'email name').lean();
        history = await enrichAssessmentsWithOwner(history);
        history = attachHistoryImageUrls(req, history);
        res.json(history);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// --- USER MANAGEMENT (Admin Only) ---


router.get('/users', [auth, admin], async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});


router.delete('/users/:id', [auth, admin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Prevent admin from deleting themselves
        if (user.id === req.user.id) {
            return res.status(400).json({ msg: 'You cannot delete yourself' });
        }

        await User.findByIdAndDelete(req.params.id);
        // Optional: Also delete user's assessments
        await Assessment.deleteMany({ userId: req.params.id });

        res.json({ msg: 'User and their assessments removed' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

module.exports = router;
