// Smart Inventory Management System - Backend Server
// Node.js + Express + MongoDB Atlas

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ==================== MIDDLEWARE ====================
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON request bodies
// Serve only specific static files to avoid exposing server code
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'styles.css'));
});
app.get('/app-backend.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'app-backend.js'));
});

// ==================== FILE UPLOAD CONFIGURATION ====================
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max file size
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.csv') {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// ==================== DATABASE CONNECTION ====================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smart_inventory';

// Connect to MongoDB with automatic reconnection
mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000, // Timeout after 10s
    connectTimeoutMS: 10000, // Connection handshake timeout
    socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
})
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Handle connection events
mongoose.connection.on('connected', () => {
    console.log('🔗 Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ Mongoose connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ Mongoose disconnected from MongoDB');
});

// ==================== SCHEMAS ====================

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, enum: ['admin', 'manager', 'user'], default: 'user' },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Product Schema
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    currentStock: { type: Number, required: true, default: 0 },
    reorderPoint: { type: Number, required: true, default: 10 },
    supplier: { type: String },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Owner of this product
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // For backward compatibility
    source: { type: String, enum: ['manual', 'csv_import', 'daily_sales'], default: 'manual' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

// Sales Schema
const salesSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Owner of this sale
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    category: { type: String, required: true },
    date: { type: Date, required: true },
    unitsSold: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    isFeatured: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const Sales = mongoose.model('Sales', salesSchema);

// Daily Sales Report Schema (for day-by-day tracking)
const dailySalesReportSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        productName: { type: String, required: true },
        unitsSold: { type: Number, required: true },
        unitPrice: { type: Number, required: true },
        totalRevenue: { type: Number, required: true }
    }],
    totalDaySales: { type: Number, default: 0 },
    totalDayRevenue: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now }
});

// Compound index to prevent duplicate daily reports
dailySalesReportSchema.index({ userId: 1, date: 1 }, { unique: true });

const DailySalesReport = mongoose.model('DailySalesReport', dailySalesReportSchema);

// Activity Schema
const activitySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    details: { type: String },
    timestamp: { type: Date, default: Date.now }
});

const Activity = mongoose.model('Activity', activitySchema);

// ==================== MIDDLEWARE ====================

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// ==================== HEALTH CHECK ====================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        uptime: process.uptime()
    });
});

// ==================== AUTH ROUTES ====================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, fullName, email, role } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = new User({
            username,
            password: hashedPassword,
            fullName,
            email,
            role: role || 'user'
        });

        await user.save();

        // Log activity
        await new Activity({
            userId: user._id,
            action: 'user_registered',
            details: `New user registered: ${fullName}`
        }).save();

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user._id,
                username: user.username,
                fullName: user.fullName,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate input
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Find user
        const user = await User.findOne({ username, isActive: true });
        if (!user) {
            console.log(`Login failed: User '${username}' not found or inactive`);
            return res.status(401).json({ 
                error: 'Invalid username or password',
                hint: 'Try demo/demo123 for quick access'
            });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            console.log(`Login failed: Invalid password for user '${username}'`);
            return res.status(401).json({ 
                error: 'Invalid username or password',
                hint: 'Try demo/demo123 for quick access'
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Generate JWT token
        const token = jwt.sign(
            { id: user._id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Log activity
        await new Activity({
            userId: user._id,
            action: 'user_login',
            details: `${user.fullName} logged in`
        }).save();

        console.log(`✅ Login successful: ${user.fullName} (${username})`);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                username: user.username,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error.message);
        res.status(500).json({ 
            error: 'Login failed due to server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ==================== PRODUCT ROUTES ====================

// Get all products (user-specific)
app.get('/api/products', authenticateToken, async (req, res) => {
    try {
        const products = await Product.find({ userId: req.user.id }).populate('addedBy', 'fullName username');
        res.json(products);
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Download CSV template (must be before :id route)
app.get('/api/products/template', (req, res) => {
    const template = 'name,category,unitPrice,currentStock,reorderPoint,supplier\n' +
                    'Sample Laptop,Electronics,74699,10,5,TechCorp\n' +
                    'Sample Mouse,Electronics,2489,50,20,TechCorp\n' +
                    'Sample Notebook,Stationery,414,100,50,PaperWorld';
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=product_import_template.csv');
    res.send(template);
});

// Download daily sales template
app.get('/api/daily-sales/template', (req, res) => {
    const template = 'productName,unitsSold,unitPrice\n' +
                    'Laptop Computer,5,74699\n' +
                    'Wireless Mouse,12,2489\n' +
                    'USB Cable,8,1078';
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=daily_sales_template.csv');
    res.send(template);
});

// Upload daily sales report
app.post('/api/daily-sales/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { date } = req.body;
        if (!date) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Date is required (format: YYYY-MM-DD)' });
        }

        const reportDate = new Date(date);
        reportDate.setHours(0, 0, 0, 0);

        // Check if report already exists for this date
        const existingReport = await DailySalesReport.findOne({ 
            userId: req.user.id, 
            date: reportDate 
        });

        if (existingReport) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
                error: `Daily report for ${date} already exists`,
                hint: 'Each day can only have one report'
            });
        }

        const products = [];
        const errors = [];
        let lineNumber = 0;
        let totalDaySales = 0;
        let totalDayRevenue = 0;

        // Parse CSV file
        fs.createReadStream(req.file.path)
            .pipe(csv())
            .on('data', (data) => {
                lineNumber++;
                
                if (!data.productName || !data.unitsSold || !data.unitPrice) {
                    errors.push(`Line ${lineNumber}: Missing required fields`);
                    return;
                }

                const unitsSold = parseInt(data.unitsSold);
                const unitPrice = parseFloat(data.unitPrice);

                if (isNaN(unitsSold) || unitsSold <= 0) {
                    errors.push(`Line ${lineNumber}: Invalid units sold`);
                    return;
                }
                if (isNaN(unitPrice) || unitPrice <= 0) {
                    errors.push(`Line ${lineNumber}: Invalid unit price`);
                    return;
                }

                const totalRevenue = unitsSold * unitPrice;
                totalDaySales += unitsSold;
                totalDayRevenue += totalRevenue;

                products.push({
                    productId: null,  // Not linked to product collection
                    productName: data.productName.trim(),
                    unitsSold,
                    unitPrice,
                    totalRevenue
                });
            })
            .on('end', async () => {
                try {
                    fs.unlinkSync(req.file.path);

                    if (errors.length > 0) {
                        return res.status(400).json({ error: 'Validation errors', errors });
                    }

                    if (products.length === 0) {
                        return res.status(400).json({ error: 'No valid sales data found' });
                    }

                    // Create daily report
                    // Attempt to map product names in CSV to existing products for this user
                    const userProducts = await Product.find({ userId: req.user.id });
                    const nameToIdMap = {};
                    userProducts.forEach(p => {
                        nameToIdMap[p.name.toLowerCase()] = p._id;
                    });
                    products.forEach(p => {
                        const mappedId = nameToIdMap[p.productName.toLowerCase()];
                        if (mappedId) {
                            p.productId = mappedId;
                        }
                    });

                    // Auto-create missing products from daily sales (first time appearance)
                    const missingNames = [...new Set(products.filter(p => !p.productId).map(p => p.productName))];
                    if (missingNames.length > 0) {
                        const newDocs = [];
                        missingNames.forEach(name => {
                            const sample = products.find(p => p.productName === name);
                            if (sample) {
                                newDocs.push({
                                    name: sample.productName,
                                    category: 'Imported',
                                    unitPrice: sample.unitPrice,
                                    currentStock: 0,
                                    reorderPoint: 10,
                                    supplier: 'Daily Sales Upload',
                                    userId: req.user.id,
                                    addedBy: req.user.id,
                                    source: 'daily_sales'
                                });
                            }
                        });
                        if (newDocs.length > 0) {
                            const inserted = await Product.insertMany(newDocs);
                            inserted.forEach(p => { nameToIdMap[p.name.toLowerCase()] = p._id; });
                            // Update productId references now that products exist
                            products.forEach(p => {
                                if (!p.productId) {
                                    const pid = nameToIdMap[p.productName.toLowerCase()];
                                    if (pid) p.productId = pid;
                                }
                            });
                            await new Activity({
                                userId: req.user.id,
                                action: 'auto_create_products',
                                details: `Created ${inserted.length} product(s) from daily sales upload (${missingNames.join(', ')})`
                            }).save();
                        }
                    }
                    const report = new DailySalesReport({
                        userId: req.user.id,
                        date: reportDate,
                        products,
                        totalDaySales,
                        totalDayRevenue
                    });

                    await report.save();

                    // Also save to Sales collection for forecasting
                    const salesRecords = products.map(p => ({
                        userId: req.user.id,
                        productId: p.productId || null,
                        productName: p.productName,
                        category: 'General',
                        date: reportDate,
                        unitsSold: p.unitsSold,
                        unitPrice: p.unitPrice
                    }));

                    await Sales.insertMany(salesRecords);

                    // Check how many days of data user has
                    const reportCount = await DailySalesReport.countDocuments({ userId: req.user.id });

                    // Log activity
                    await new Activity({
                        userId: req.user.id,
                        action: 'daily_sales_upload',
                        details: `Uploaded daily sales for ${date} - ${products.length} products, ₹${totalDayRevenue.toFixed(2)} revenue`
                    }).save();

                    console.log(`✅ Daily sales uploaded for ${date} by user ${req.user.id}`);

                    res.json({
                        message: 'Daily sales report uploaded successfully',
                        date: date,
                        productsCount: products.length,
                        totalSales: totalDaySales,
                        totalRevenue: totalDayRevenue,
                        daysReported: reportCount,
                        forecastReady: reportCount >= 7,
                        hint: reportCount < 7 ? `Upload ${7 - reportCount} more day(s) to enable forecasting` : 'Forecasting is now available!'
                    });
                } catch (dbError) {
                    console.error('❌ Database error during daily sales upload:');
                    console.error('Error name:', dbError.name);
                    console.error('Error message:', dbError.message);
                    console.error('Error code:', dbError.code);
                    console.error('Full error:', JSON.stringify(dbError, null, 2));
                    res.status(500).json({ 
                        error: 'Failed to save daily report',
                        details: dbError.message 
                    });
                }
            })
            .on('error', (error) => {
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                console.error('CSV parse error:', error);
                res.status(500).json({ error: 'Failed to parse CSV file' });
            });
    } catch (error) {
        console.error('Upload error:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message || 'Failed to upload daily sales' });
    }
});

// Get daily sales reports
app.get('/api/daily-sales/reports', authenticateToken, async (req, res) => {
    try {
        const reports = await DailySalesReport.find({ userId: req.user.id })
            .sort({ date: -1 })
            .limit(30);
        
        const totalReports = await DailySalesReport.countDocuments({ userId: req.user.id });
        
        res.json({
            reports,
            totalReports,
            forecastReady: totalReports >= 7
        });
    } catch (error) {
        console.error('Get reports error:', error);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// Clear all daily sales reports (user-specific)
app.delete('/api/daily-sales/reports', authenticateToken, async (req, res) => {
    try {
        const deleteResult = await DailySalesReport.deleteMany({ userId: req.user.id });
        
        // Log activity
        await new Activity({
            userId: req.user.id,
            action: 'clear_daily_reports',
            details: `Cleared ${deleteResult.deletedCount} daily sales report(s)`
        }).save();

        res.json({
            message: 'All daily sales reports cleared successfully',
            deletedCount: deleteResult.deletedCount
        });
    } catch (error) {
        console.error('Clear reports error:', error);
        res.status(500).json({ error: 'Failed to clear reports' });
    }
});

// Get single product (user-specific)
app.get('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const product = await Product.findOne({ _id: req.params.id, userId: req.user.id }).populate('addedBy', 'fullName username');
        if (!product) {
            return res.status(404).json({ error: 'Product not found or access denied' });
        }
        res.json(product);
    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// Add product (user-specific)
app.post('/api/products', authenticateToken, async (req, res) => {
    try {
        const { name, category, unitPrice, currentStock, reorderPoint, supplier } = req.body;

        const product = new Product({
            name,
            category,
            unitPrice,
            currentStock,
            reorderPoint,
            supplier,
            userId: req.user.id,
            addedBy: req.user.id,
            source: 'manual'
        });

        await product.save();

        // Log activity
        await new Activity({
            userId: req.user.id,
            action: 'add_product',
            details: `Added product: ${name}`
        }).save();

        res.status(201).json({
            message: 'Product added successfully',
            product
        });
    } catch (error) {
        console.error('Add product error:', error);
        res.status(500).json({ error: 'Failed to add product' });
    }
});

// Import products from CSV
app.post('/api/products/import', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const results = [];
        const errors = [];
        let lineNumber = 0;

        // Parse CSV file
        fs.createReadStream(req.file.path)
            .pipe(csv())
            .on('data', (data) => {
                lineNumber++;
                
                // Validate required fields
                if (!data.name || !data.category || !data.unitPrice) {
                    errors.push(`Line ${lineNumber}: Missing required fields (name, category, unitPrice)`);
                    return;
                }

                // Parse and validate data
                const product = {
                    name: data.name.trim(),
                    category: data.category.trim(),
                    unitPrice: parseFloat(data.unitPrice),
                    currentStock: parseInt(data.currentStock || 0),
                    reorderPoint: parseInt(data.reorderPoint || 10),
                    supplier: data.supplier ? data.supplier.trim() : '',
                    userId: req.user.id,
                    addedBy: req.user.id,
                    source: 'csv_import'
                };

                // Validate numeric values
                if (isNaN(product.unitPrice) || product.unitPrice <= 0) {
                    errors.push(`Line ${lineNumber}: Invalid unit price`);
                    return;
                }
                if (isNaN(product.currentStock) || product.currentStock < 0) {
                    errors.push(`Line ${lineNumber}: Invalid current stock`);
                    return;
                }
                if (isNaN(product.reorderPoint) || product.reorderPoint < 0) {
                    errors.push(`Line ${lineNumber}: Invalid reorder point`);
                    return;
                }

                results.push(product);
            })
            .on('end', async () => {
                try {
                    // Delete uploaded file
                    fs.unlinkSync(req.file.path);

                    if (errors.length > 0) {
                        return res.status(400).json({ 
                            error: 'Validation errors found', 
                            errors,
                            validProducts: results.length
                        });
                    }

                    if (results.length === 0) {
                        return res.status(400).json({ error: 'No valid products found in CSV file' });
                    }

                    // Insert products into database
                    const insertedProducts = await Product.insertMany(results);

                    // Log activity
                    await new Activity({
                        userId: req.user.id,
                        action: 'import_products',
                        details: `Imported ${insertedProducts.length} products from CSV`
                    }).save();

                    console.log(`✅ Imported ${insertedProducts.length} products`);

                    res.json({
                        message: 'Products imported successfully',
                        count: insertedProducts.length,
                        products: insertedProducts
                    });
                } catch (dbError) {
                    console.error('Database import error:', dbError);
                    res.status(500).json({ error: 'Failed to import products to database' });
                }
            })
            .on('error', (error) => {
                // Delete uploaded file on error
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                console.error('CSV parse error:', error);
                res.status(500).json({ error: 'Failed to parse CSV file' });
            });
    } catch (error) {
        console.error('Import error:', error);
        // Clean up file if exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message || 'Failed to import products' });
    }
});

// Update product (user-specific)
app.put('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const { name, category, unitPrice, currentStock, reorderPoint, supplier } = req.body;

        const product = await Product.findOne({ _id: req.params.id, userId: req.user.id });
        if (!product) {
            return res.status(404).json({ error: 'Product not found or access denied' });
        }

        const oldStock = product.currentStock;

        product.name = name || product.name;
        product.category = category || product.category;
        product.unitPrice = unitPrice !== undefined ? unitPrice : product.unitPrice;
        product.currentStock = currentStock !== undefined ? currentStock : product.currentStock;
        product.reorderPoint = reorderPoint !== undefined ? reorderPoint : product.reorderPoint;
        product.supplier = supplier || product.supplier;
        product.updatedAt = new Date();

        await product.save();

        // Log activity if stock changed
        if (oldStock !== product.currentStock) {
            await new Activity({
                userId: req.user.id,
                action: 'update_stock',
                details: `Updated stock for ${product.name}: ${oldStock} → ${product.currentStock} units`
            }).save();
        }

        res.json({
            message: 'Product updated successfully',
            product
        });
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: 'Failed to update product' });
    }
});

// Delete product (user-specific)
app.delete('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const product = await Product.findOne({ _id: req.params.id, userId: req.user.id });
        if (!product) {
            return res.status(404).json({ error: 'Product not found or access denied' });
        }

        const productName = product.name;
        await Product.findByIdAndDelete(req.params.id);

        // Log activity
        await new Activity({
            userId: req.user.id,
            action: 'delete_product',
            details: `Deleted product: ${productName}`
        }).save();

        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// ==================== SALES ROUTES ====================

// Get all sales (user-specific)
app.get('/api/sales', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate, productId } = req.query;
        let query = { userId: req.user.id };

        if (startDate && endDate) {
            query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }
        if (productId) {
            query.productId = productId;
        }

        const sales = await Sales.find(query).populate('productId', 'name category');
        res.json(sales);
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({ error: 'Failed to fetch sales' });
    }
});

// Add sale (user-specific)
app.post('/api/sales', authenticateToken, async (req, res) => {
    try {
        const { productId, unitsSold, unitPrice, date } = req.body;

        const product = await Product.findOne({ _id: productId, userId: req.user.id });
        if (!product) {
            return res.status(404).json({ error: 'Product not found or access denied' });
        }

        const sale = new Sales({
            userId: req.user.id,
            productId,
            productName: product.name,
            category: product.category,
            unitsSold,
            unitPrice: unitPrice || product.unitPrice,
            date: date || new Date()
        });

        await sale.save();

        res.status(201).json({
            message: 'Sale recorded successfully',
            sale
        });
    } catch (error) {
        console.error('Add sale error:', error);
        res.status(500).json({ error: 'Failed to record sale' });
    }
});

// ==================== ACTIVITY ROUTES ====================

// Get all activities (user-specific)
app.get('/api/activities', authenticateToken, async (req, res) => {
    try {
        const { limit } = req.query;
        let query = { userId: req.user.id };

        const activities = await Activity.find(query)
            .populate('userId', 'fullName username')
            .sort({ timestamp: -1 })
            .limit(parseInt(limit) || 100);

        res.json(activities);
    } catch (error) {
        console.error('Get activities error:', error);
        res.status(500).json({ error: 'Failed to fetch activities' });
    }
});

// ==================== FORECAST ROUTES ====================

// Generate demand forecast using Linear Regression
app.post('/api/forecast/:productId', authenticateToken, async (req, res) => {
    try {
        const { productId } = req.params;
        const { days = 14 } = req.body;

        // Get product (user-specific)
        const product = await Product.findOne({ _id: productId, userId: req.user.id });
        if (!product) {
            return res.status(404).json({ error: 'Product not found or access denied' });
        }

        // Get historical sales for this product (user-specific)
        const sales = await Sales.find({ productId, userId: req.user.id }).sort({ date: 1 });

        // Check if user has uploaded at least 7 daily reports
        const dailyReportCount = await DailySalesReport.countDocuments({ userId: req.user.id });

        if (dailyReportCount < 7) {
            return res.status(400).json({ 
                error: `Insufficient daily reports. You have ${dailyReportCount} day(s) of data.`,
                hint: `Upload ${7 - dailyReportCount} more daily CSV report(s) to enable forecasting`,
                daysReported: dailyReportCount,
                daysRequired: 7
            });
        }

        if (sales.length < 7) {
            return res.status(400).json({ 
                error: 'Insufficient sales data for this product. Minimum 7 days required.' 
            });
        }

        // Prepare data for linear regression
        const historicalData = [];
        const salesByDate = {};

        // Group sales by date
        sales.forEach(sale => {
            const dateKey = new Date(sale.date).toISOString().split('T')[0];
            if (!salesByDate[dateKey]) {
                salesByDate[dateKey] = 0;
            }
            salesByDate[dateKey] += sale.unitsSold;
        });

        // Convert to array with day index
        const sortedDates = Object.keys(salesByDate).sort();
        sortedDates.forEach((date, index) => {
            historicalData.push({
                day: index,
                demand: salesByDate[date],
                date: date
            });
        });

        // Calculate Linear Regression: y = mx + b
        const n = historicalData.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

        historicalData.forEach(point => {
            sumX += point.day;
            sumY += point.demand;
            sumXY += point.day * point.demand;
            sumX2 += point.day * point.day;
        });

        // Calculate slope (m) and intercept (b)
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Calculate R-squared (coefficient of determination)
        const meanY = sumY / n;
        let ssTotal = 0, ssResidual = 0;

        historicalData.forEach(point => {
            const predicted = slope * point.day + intercept;
            ssTotal += Math.pow(point.demand - meanY, 2);
            ssResidual += Math.pow(point.demand - predicted, 2);
        });

        const rSquared = 1 - (ssResidual / ssTotal);
        const accuracy = Math.max(0, Math.min(100, rSquared * 100));

        // Generate forecast for next N days
        const lastDay = historicalData[historicalData.length - 1].day;
        const lastDate = new Date(historicalData[historicalData.length - 1].date);
        const forecast = [];

        for (let i = 1; i <= days; i++) {
            const dayIndex = lastDay + i;
            const predictedDemand = slope * dayIndex + intercept;
            
            // Add some variance based on day of week
            const forecastDate = new Date(lastDate);
            forecastDate.setDate(lastDate.getDate() + i);
            const dayOfWeek = forecastDate.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            
            // Weekend adjustment (typically 10-20% higher demand)
            const weekendMultiplier = isWeekend ? 1.15 : 1.0;
            
            // Ensure non-negative demand
            const finalDemand = Math.max(1, Math.round(predictedDemand * weekendMultiplier));
            
            // Confidence based on R-squared and distance from training data
            const distanceFactor = 1 - (i / (days * 2));
            const confidence = Math.max(60, Math.min(95, accuracy * distanceFactor));

            forecast.push({
                date: forecastDate.toISOString().split('T')[0],
                dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
                predictedDemand: finalDemand,
                isWeekend: isWeekend,
                confidence: Math.round(confidence)
            });
        }

        // Calculate total forecasted demand
        const totalForecastedDemand = forecast.reduce((sum, day) => sum + day.predictedDemand, 0);
        const avgDailyDemand = Math.round(totalForecastedDemand / days);

        // Generate recommendation
        let recommendation;
        const stockNeeded = totalForecastedDemand;
        
        if (product.currentStock < product.reorderPoint) {
            recommendation = `URGENT: Reorder immediately! Current stock (${product.currentStock}) is below reorder point (${product.reorderPoint}). Forecasted demand: ${stockNeeded} units over next ${days} days.`;
        } else if (product.currentStock < stockNeeded) {
            recommendation = `Order ${stockNeeded - product.currentStock} units to meet forecasted demand of ${stockNeeded} units over next ${days} days.`;
        } else {
            recommendation = `Stock levels are adequate. Current stock (${product.currentStock}) covers forecasted demand (${stockNeeded} units) for next ${days} days.`;
        }

        // Log activity
        await new Activity({
            userId: req.user.id,
            action: 'generate_forecast',
            details: `Generated AI forecast for ${product.name} using Linear Regression`
        }).save();

        res.json({
            product: {
                id: product._id,
                name: product.name,
                currentStock: product.currentStock,
                reorderPoint: product.reorderPoint
            },
            model: {
                type: 'Linear Regression',
                equation: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`,
                slope: slope,
                intercept: intercept,
                rSquared: rSquared,
                accuracy: Math.round(accuracy * 10) / 10,
                trainingDays: historicalData.length
            },
            forecast: forecast,
            summary: {
                totalForecastedDemand: totalForecastedDemand,
                avgDailyDemand: avgDailyDemand,
                daysForecasted: days,
                recommendation: recommendation
            }
        });
    } catch (error) {
        console.error('Forecast error:', error);
        res.status(500).json({ error: 'Failed to generate forecast' });
    }
});

// ==================== MAINTENANCE ROUTES ====================
// Backfill sales documents that have null productId by matching productName
app.post('/api/maintenance/backfill-sales', authenticateToken, async (req, res) => {
    try {
        const userProducts = await Product.find({ userId: req.user.id });
        const nameToId = {};
        userProducts.forEach(p => nameToId[p.name.toLowerCase()] = p._id);

        const salesToUpdate = await Sales.find({ userId: req.user.id, productId: null });
        let updated = 0;
        for (const sale of salesToUpdate) {
            const pid = nameToId[sale.productName.toLowerCase()];
            if (pid) {
                sale.productId = pid;
                await sale.save();
                updated++;
            }
        }

        // Log activity
        await new Activity({
            userId: req.user.id,
            action: 'maintenance_backfill',
            details: `Backfilled ${updated} sales records with productId`
        }).save();

        res.json({ message: 'Backfill complete', updated });
    } catch (error) {
        console.error('Backfill sales error:', error);
        res.status(500).json({ error: 'Failed to backfill sales records' });
    }
});

// Create missing products from historical daily sales reports (one-time backfill)
app.post('/api/maintenance/create-missing-products', authenticateToken, async (req, res) => {
    try {
        // Collect all product names from user's daily reports
        const reports = await DailySalesReport.find({ userId: req.user.id });
        const allNames = new Set();
        reports.forEach(r => r.products.forEach(p => allNames.add(p.productName)));

        // Existing product names
        const existing = await Product.find({ userId: req.user.id });
        const existingNames = new Set(existing.map(p => p.name.toLowerCase()));

        const toCreate = [];
        allNames.forEach(name => {
            if (!existingNames.has(name.toLowerCase())) {
                // Find a sample entry for unitPrice
                const sampleReport = reports.find(r => r.products.some(p => p.productName === name));
                const sampleProduct = sampleReport.products.find(p => p.productName === name);
                toCreate.push({
                    name: name,
                    category: 'Imported',
                    unitPrice: sampleProduct ? sampleProduct.unitPrice : 0,
                    currentStock: 0,
                    reorderPoint: 10,
                    supplier: 'Daily Sales Upload',
                    userId: req.user.id,
                    addedBy: req.user.id,
                    source: 'daily_sales'
                });
            }
        });

        let inserted = [];
        if (toCreate.length > 0) {
            inserted = await Product.insertMany(toCreate);
            await new Activity({
                userId: req.user.id,
                action: 'maintenance_create_missing_products',
                details: `Created ${inserted.length} missing product(s) from daily sales reports`
            }).save();
        }

        res.json({ message: 'Missing products creation complete', created: inserted.length });
    } catch (error) {
        console.error('Create missing products error:', error);
        res.status(500).json({ error: 'Failed to create missing products' });
    }
});

// Remove duplicate products (keep only one per name, preferring daily_sales > csv_import > manual)
app.post('/api/maintenance/deduplicate-products', authenticateToken, async (req, res) => {
    try {
        const products = await Product.find({ userId: req.user.id }).sort({ createdAt: -1 });
        const keepMap = {};
        const toDelete = [];

        // Priority: daily_sales > csv_import > manual
        const sourcePriority = { 'daily_sales': 3, 'csv_import': 2, 'manual': 1 };

        products.forEach(p => {
            const key = p.name.toLowerCase().trim();
            if (!keepMap[key]) {
                keepMap[key] = p;
            } else {
                const existingPriority = sourcePriority[keepMap[key].source || 'manual'] || 0;
                const currentPriority = sourcePriority[p.source || 'manual'] || 0;
                if (currentPriority > existingPriority) {
                    // Replace with higher priority
                    toDelete.push(keepMap[key]._id);
                    keepMap[key] = p;
                } else {
                    // Delete current (lower priority)
                    toDelete.push(p._id);
                }
            }
        });

        const deleteResult = await Product.deleteMany({ _id: { $in: toDelete }, userId: req.user.id });

        await new Activity({
            userId: req.user.id,
            action: 'maintenance_deduplicate_products',
            details: `Removed ${deleteResult.deletedCount} duplicate product(s)`
        }).save();

        res.json({ 
            message: 'Deduplication complete',
            deleted: deleteResult.deletedCount,
            remaining: Object.keys(keepMap).length
        });
    } catch (error) {
        console.error('Deduplicate products error:', error);
        res.status(500).json({ error: 'Failed to deduplicate products' });
    }
});

// Rebuild Sales records from DailySalesReports using current Product IDs
app.post('/api/maintenance/rebuild-sales', authenticateToken, async (req, res) => {
    try {
        // Get all user products
        const userProducts = await Product.find({ userId: req.user.id });
        const nameToProduct = {};
        userProducts.forEach(p => {
            const key = p.name.toLowerCase().trim();
            // Prefer daily_sales or csv_import source over manual to avoid duplicates
            if (!nameToProduct[key] || p.source === 'daily_sales' || p.source === 'csv_import') {
                nameToProduct[key] = p;
            }
        });

        // Get all daily reports
        const reports = await DailySalesReport.find({ userId: req.user.id }).sort({ date: 1 });

        // Delete existing sales records for this user
        const deleteResult = await Sales.deleteMany({ userId: req.user.id });

        // Rebuild sales from reports
        const newSales = [];
        reports.forEach(report => {
            report.products.forEach(item => {
                const key = item.productName.toLowerCase().trim();
                const product = nameToProduct[key];
                if (product) {
                    newSales.push({
                        userId: req.user.id,
                        productId: product._id,
                        productName: product.name,
                        category: product.category,
                        date: report.date,
                        unitsSold: item.unitsSold,
                        unitPrice: item.unitPrice
                    });
                } else {
                    console.warn(`No product found for: ${item.productName}`);
                }
            });
        });

        const inserted = await Sales.insertMany(newSales);

        await new Activity({
            userId: req.user.id,
            action: 'maintenance_rebuild_sales',
            details: `Rebuilt ${inserted.length} sales records from ${reports.length} daily reports (deleted ${deleteResult.deletedCount} old records)`
        }).save();

        res.json({ 
            message: 'Sales rebuilt successfully',
            deleted: deleteResult.deletedCount,
            inserted: inserted.length,
            reports: reports.length
        });
    } catch (error) {
        console.error('Rebuild sales error:', error);
        res.status(500).json({ error: 'Failed to rebuild sales records' });
    }
});

// Seed a baseline set of products for the current user (if collection empty for user)
app.post('/api/maintenance/seed-products', authenticateToken, async (req, res) => {
    try {
        const existingCount = await Product.countDocuments({ userId: req.user.id });
        if (existingCount > 0) {
            return res.json({ message: 'Products already exist for this user', existingCount });
        }
        const seedList = [
            { name: 'Laptop Computer', category: 'Electronics', unitPrice: 74699 },
            { name: 'Wireless Mouse', category: 'Electronics', unitPrice: 2489 },
            { name: 'USB Cable', category: 'Accessories', unitPrice: 1078 },
            { name: 'Office Chair', category: 'Furniture', unitPrice: 16599 },
            { name: 'Desk Lamp', category: 'Accessories', unitPrice: 4149 },
            { name: 'Notebook A4', category: 'Stationery', unitPrice: 414 },
            { name: 'Ballpoint Pen', category: 'Stationery', unitPrice: 165 },
            { name: 'Coffee Beans', category: 'Food', unitPrice: 2074 },
            { name: 'Energy Drink', category: 'Beverages', unitPrice: 248 },
            { name: 'Smartphone', category: 'Electronics', unitPrice: 58099 },
            { name: 'Gaming Laptop', category: 'Electronics', unitPrice: 89999 },
            { name: 'Mechanical Keyboard', category: 'Electronics', unitPrice: 5499 },
            { name: '4K Monitor', category: 'Electronics', unitPrice: 32999 },
            { name: 'Standing Desk', category: 'Furniture', unitPrice: 24999 },
            { name: 'Ergonomic Chair', category: 'Furniture', unitPrice: 18999 }
        ];
        const docs = seedList.map(p => ({
            ...p,
            currentStock: 0,
            reorderPoint: 10,
            supplier: 'Seed',
            userId: req.user.id,
            addedBy: req.user.id,
            source: 'manual'
        }));
        const inserted = await Product.insertMany(docs);
        await new Activity({
            userId: req.user.id,
            action: 'seed_products',
            details: `Seeded ${inserted.length} baseline products`
        }).save();
        res.json({ message: 'Seed complete', created: inserted.length });
    } catch (error) {
        console.error('Seed products error:', error);
        res.status(500).json({ error: 'Failed to seed products' });
    }
});

// ==================== USER ROUTES ====================

// Get all users (admin only)
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const users = await User.find().select('-password');
        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get current user profile
app.get('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error('Get user profile error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// ==================== INITIALIZE SAMPLE DATA ====================

async function initializeSampleData() {
    try {
        // Check if data already exists
        const userCount = await User.countDocuments();
        if (userCount > 0) {
            console.log('✅ Sample data already exists');
            return;
        }

        console.log('📊 Creating sample data...');

        // Create demo users
        const demoUsers = [
            {
                username: 'demo',
                password: await bcrypt.hash('demo123', 10),
                fullName: 'Demo User',
                email: 'demo@inventory.com',
                role: 'admin'
            },
            {
                username: 'manager',
                password: await bcrypt.hash('manager123', 10),
                fullName: 'Manager User',
                email: 'manager@inventory.com',
                role: 'manager'
            },
            {
                username: 'user',
                password: await bcrypt.hash('user123', 10),
                fullName: 'Regular User',
                email: 'user@inventory.com',
                role: 'user'
            }
        ];

        const users = await User.insertMany(demoUsers);

        // Create sample products for EACH user (Prices in Indian Rupees - ₹)
        const productTemplate = [
            { name: 'Laptop Computer', category: 'Electronics', unitPrice: 74699, currentStock: 15, reorderPoint: 5, supplier: 'TechCorp' },
            { name: 'Wireless Mouse', category: 'Electronics', unitPrice: 2489, currentStock: 45, reorderPoint: 20, supplier: 'TechCorp' },
            { name: 'USB Cable', category: 'Electronics', unitPrice: 1078, currentStock: 35, reorderPoint: 50, supplier: 'CablePlus' },
            { name: 'Office Chair', category: 'Furniture', unitPrice: 16599, currentStock: 8, reorderPoint: 3, supplier: 'FurniMax' },
            { name: 'Desk Lamp', category: 'Furniture', unitPrice: 4149, currentStock: 12, reorderPoint: 8, supplier: 'LightCo' },
            { name: 'Notebook A4', category: 'Stationery', unitPrice: 414, currentStock: 250, reorderPoint: 100, supplier: 'PaperWorld' },
            { name: 'Ballpoint Pen', category: 'Stationery', unitPrice: 165, currentStock: 180, reorderPoint: 200, supplier: 'PenMart' },
            { name: 'Coffee Beans', category: 'Food', unitPrice: 2074, currentStock: 28, reorderPoint: 15, supplier: 'CoffeeSupply' },
            { name: 'Energy Drink', category: 'Food', unitPrice: 248, currentStock: 75, reorderPoint: 50, supplier: 'BevCorp' },
            { name: 'Smartphone', category: 'Electronics', unitPrice: 58099, currentStock: 6, reorderPoint: 8, supplier: 'MobileTech' }
        ];

        const allProducts = [];
        const sales = [];
        const today = new Date();

        // Create products and sales for each user separately
        for (const user of users) {
            const userProducts = productTemplate.map(p => ({
                ...p,
                userId: user._id,
                addedBy: user._id
            }));

            const insertedProducts = await Product.insertMany(userProducts);
            allProducts.push(...insertedProducts);

            // Create sample sales data for this user's products (last 90 days)
            for (let i = 90; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                
                const dailySales = Math.floor(Math.random() * 6) + 3;
                
                for (let j = 0; j < dailySales; j++) {
                    const product = insertedProducts[Math.floor(Math.random() * insertedProducts.length)];
                    const quantity = Math.floor(Math.random() * 8) + 1;
                    const priceVariation = 0.9 + Math.random() * 0.2;
                    
                    sales.push({
                        userId: user._id,
                        productId: product._id,
                        productName: product.name,
                        category: product.category,
                        date: date,
                        unitsSold: quantity,
                        unitPrice: Math.round(product.unitPrice * priceVariation * 100) / 100
                    });
                }
            }
        }

        await Sales.insertMany(sales);

        console.log('✅ Sample data created successfully!');
        console.log(`   - ${users.length} users created`);
        console.log(`   - ${allProducts.length} products created (${allProducts.length / users.length} per user)`);
        console.log(`   - ${sales.length} sales records created`);
    } catch (error) {
        console.error('❌ Error creating sample data:', error);
    }
}

// ==================== START SERVER ====================

// Start server (Render/Local). Always seed on first deploy.
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);

    // Kick off sample-data initialization in background so server startup isn't blocked.
    (async () => {
        try {
            console.log('⏳ Checking/creating sample data in background...');
            await initializeSampleData();
            console.log('✅ Sample data check/seed complete');
        } catch (err) {
            console.error('❌ Sample data initialization error (background):', err.message || err);
        }
    })();
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⏹️  Shutting down server...');
    await mongoose.connection.close();
    process.exit(0);
});

// Export app (useful for testing or future adapters)
module.exports = app;
