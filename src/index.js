const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!mongoUri) {
    throw new Error('Missing MongoDB connection string. Set MONGODB_URI in your .env file before starting the server.');
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/auth', require('./routes/auth'));
app.use('/api/data', require('./routes/data'));

// Database Connection
mongoose.connect(mongoUri)
    .then(() => console.log('MongoDB Connected...'))
    .catch(err => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
