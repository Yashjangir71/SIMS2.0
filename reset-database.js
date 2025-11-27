// Reset Database Script - Clear all data and reinitialize
require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function resetDatabase() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        console.log('🗑️  Dropping database...');
        await mongoose.connection.db.dropDatabase();
        console.log('✅ Database cleared successfully!');
        
        console.log('\n🔄 Please restart the server to reinitialize with new data');
        console.log('👉 Run: node server.js\n');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

resetDatabase();
