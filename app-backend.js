// Smart Inventory Management System - Frontend with MongoDB Backend Integration
// Connects to Express + MongoDB Atlas backend via REST API

// Global variables
let currentUser = null;
let currentPage = 'login';
let dashboardChart = null;
let categoryChart = null;
let forecastChart = null;
let authToken = null;
let showImportedOnly = false; // filter flag for imported products
let cachedSalesForReports = null; // cache for re-rendering reports chart

// API Configuration
const API_BASE_URL = 'http://localhost:3000/api';

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// Initialize the application
async function initializeApp() {
    console.log('🚀 Initializing Smart Inventory Management System with Backend...');

    // Check if user is already logged in (token in localStorage)
    authToken = localStorage.getItem('auth_token');
    
    if (authToken) {
        try {
            // Verify token and get user data
            const userData = await fetchAPI('/users/me');
            currentUser = userData;
            showMainApp();
        } catch (error) {
            console.error('Token validation failed:', error);
            localStorage.removeItem('auth_token');
            authToken = null;
            showLoginPage();
        }
    } else {
        showLoginPage();
    }

    // Initialize event listeners
    initializeEventListeners();

    console.log('✅ Application initialized successfully!');
}

// Initialize event listeners
function initializeEventListeners() {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }

    // Auto-hide alerts
    setTimeout(() => {
        hideAllAlerts();
    }, 5000);
}

// ==================== API HELPER FUNCTIONS ====================

async function fetchAPI(endpoint, options = {}) {
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        ...options
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'API request failed');
        }

        return data;
    } catch (error) {
        if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
            throw new Error('Cannot connect to server. Make sure the backend is running on http://localhost:3000');
        }
        throw error;
    }
}

// ==================== AUTHENTICATION FUNCTIONS ====================

async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        showAlert('info', 'Logging in...');
        
        const response = await fetchAPI('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        // Store token and user data
        authToken = response.token;
        localStorage.setItem('auth_token', authToken);
        currentUser = response.user;

        showAlert('success', `Welcome back, ${currentUser.fullName}!`);

        setTimeout(() => {
            showMainApp();
        }, 1000);

    } catch (error) {
        console.error('Login error:', error);
        let errorMsg = error.message;
        if (!errorMsg.includes('Cannot connect to server')) {
            errorMsg += ' (Try demo/demo123)';
        }
        showAlert('danger', errorMsg);
    }
}

async function handleRegister(e) {
    e.preventDefault();

    const fullName = document.getElementById('regFullName').value;
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const role = document.getElementById('regRole').value;

    try {
        await fetchAPI('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password, fullName, email, role })
        });

        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('registerModal'));
        modal.hide();

        showAlert('success', 'Registration successful! You can now log in.');

        // Clear form
        document.getElementById('registerForm').reset();
    } catch (error) {
        console.error('Registration error:', error);
        showAlert('danger', error.message || 'Registration failed');
    }
}

function logout() {
    if (currentUser) {
        console.log(`${currentUser.fullName} logged out`);
    }

    currentUser = null;
    authToken = null;
    localStorage.removeItem('auth_token');
    
    showAlert('info', 'You have been logged out successfully.');

    setTimeout(() => {
        showLoginPage();
    }, 1000);
}

// ==================== NAVIGATION FUNCTIONS ====================

function showLoginPage() {
    document.getElementById('loginPage').classList.remove('d-none');
    document.getElementById('mainNavbar').classList.add('d-none');
    document.getElementById('mainLayout').classList.add('d-none');
    currentPage = 'login';
    document.body.style.minHeight = '100vh';
}

function showMainApp() {
    document.getElementById('loginPage').classList.add('d-none');
    document.getElementById('mainNavbar').classList.remove('d-none');
    document.getElementById('mainLayout').classList.remove('d-none');

    // Update user info in navbar
    document.getElementById('currentUser').textContent = currentUser ? currentUser.fullName : 'User';

    // Show dashboard by default
    showPage('dashboard');

    document.body.style.minHeight = 'auto';
}

function showPage(page) {
    currentPage = page;

    // Update active nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    document.querySelectorAll(`[onclick="showPage('${page}')"]`).forEach(link => {
        link.classList.add('active');
    });

    // Load page content
    const contentContainer = document.getElementById('pageContent');

    switch(page) {
        case 'dashboard':
            loadDashboard(contentContainer);
            break;
        case 'products':
            loadProductsPage(contentContainer);
            break;
        case 'add-product':
            loadAddProductPage(contentContainer);
            break;
        case 'daily-sales':
            loadDailySalesPage(contentContainer);
            break;
        case 'reports':
            loadReportsPage(contentContainer);
            break;
        case 'profile':
            loadProfilePage(contentContainer);
            break;
        default:
            contentContainer.innerHTML = '<h2>Page not found</h2>';
    }
}

// ==================== DASHBOARD PAGE ====================

async function loadDashboard(container) {
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div><p class="mt-3">Loading dashboard...</p></div>';

    try {
        const [products, sales, activities] = await Promise.all([
            fetchAPI('/products'),
            fetchAPI('/sales'),
            fetchAPI('/activities?limit=100')
        ]);

        container.innerHTML = getDashboardHTML(products, sales, activities);
        initializeDashboard();
    } catch (error) {
        console.error('Dashboard load error:', error);
        container.innerHTML = `<div class="alert alert-danger">Failed to load dashboard: ${error.message}</div>`;
    }
}

function getDashboardHTML(products, sales, activities) {
    // Calculate statistics
    const totalProducts = products.length;
    const totalCategories = [...new Set(products.map(p => p.category))].length;
    const lowStockItems = products.filter(p => p.currentStock <= p.reorderPoint);

    // Calculate recent sales (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSales = sales.filter(s => new Date(s.date) >= sevenDaysAgo);
    const totalRevenue = recentSales.reduce((sum, sale) => sum + (sale.unitsSold * sale.unitPrice), 0);
    const totalUnits = recentSales.reduce((sum, sale) => sum + sale.unitsSold, 0);

    // User activity stats
    const userActivities = activities.filter(a => a.userId._id === currentUser.id);
    const userStats = {
        productsAdded: userActivities.filter(a => a.action === 'add_product').length,
        stockUpdates: userActivities.filter(a => a.action === 'update_stock').length,
        forecastsGenerated: userActivities.filter(a => a.action === 'generate_forecast').length,
        totalActions: userActivities.length
    };

    return `
        <!-- Welcome Section -->
        <div class="welcome-section mb-4 animate-in">
            <div class="row align-items-center">
                <div class="col-md-8">
                    <div class="welcome-content">
                        <h1 class="display-6 fw-bold text-primary mb-2">
                            <i class="fas fa-chart-line me-3"></i>Welcome back, ${currentUser.fullName}!
                        </h1>
                        <p class="lead text-muted">
                            Here's what's happening in your inventory today
                            <span class="badge bg-primary ms-2">${new Date().toLocaleDateString('en-US', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            })}</span>
                        </p>
                    </div>
                </div>
                <div class="col-md-4 text-end">
                    <div class="welcome-actions">
                        <button class="btn btn-outline-primary me-2" onclick="showPage('dashboard')">
                            <i class="fas fa-sync me-2"></i>Refresh
                        </button>
                        <a href="#" onclick="showPage('add-product')" class="btn btn-primary">
                            <i class="fas fa-plus me-2"></i>Add Product
                        </a>
                    </div>
                </div>
            </div>
        </div>

        <!-- Statistics Cards -->
        <div class="row mb-4">
            <div class="col-xl-3 col-md-6">
                <div class="stat-card bg-gradient-primary text-white animate-in">
                    <div class="card-body">
                        <div class="row align-items-center">
                            <div class="col-3">
                                <div class="stat-icon">
                                    <i class="fas fa-boxes fa-2x"></i>
                                </div>
                            </div>
                            <div class="col-9">
                                <div class="stat-content">
                                    <h3 class="stat-number" data-target="${totalProducts}">0</h3>
                                    <p class="stat-label mb-0">Total Products</p>
                                    <div class="stat-trend">
                                        <i class="fas fa-arrow-up me-1"></i>
                                        <span class="trend-text">Active inventory</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="card-footer bg-rgba-white-10">
                        <div class="d-flex justify-content-between">
                            <small><i class="fas fa-calendar me-1"></i>Updated now</small>
                            <small><i class="fas fa-chart-line me-1"></i>Trending up</small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-xl-3 col-md-6">
                <div class="stat-card bg-gradient-success text-white animate-in">
                    <div class="card-body">
                        <div class="row align-items-center">
                            <div class="col-3">
                                <div class="stat-icon">
                                    <i class="fas fa-layer-group fa-2x"></i>
                                </div>
                            </div>
                            <div class="col-9">
                                <div class="stat-content">
                                    <h3 class="stat-number" data-target="${totalCategories}">0</h3>
                                    <p class="stat-label mb-0">Categories</p>
                                    <div class="stat-trend">
                                        <i class="fas fa-tags me-1"></i>
                                        <span class="trend-text">Well organized</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="card-footer bg-rgba-white-10">
                        <div class="d-flex justify-content-between">
                            <small><i class="fas fa-boxes me-1"></i>All products</small>
                            <small><i class="fas fa-check me-1"></i>Organized</small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-xl-3 col-md-6">
                <div class="stat-card bg-gradient-${lowStockItems.length > 0 ? 'danger' : 'warning'} text-white animate-in">
                    <div class="card-body">
                        <div class="row align-items-center">
                            <div class="col-3">
                                <div class="stat-icon">
                                    <i class="fas fa-exclamation-triangle fa-2x"></i>
                                </div>
                            </div>
                            <div class="col-9">
                                <div class="stat-content">
                                    <h3 class="stat-number" data-target="${lowStockItems.length}">0</h3>
                                    <p class="stat-label mb-0">Low Stock Items</p>
                                    <div class="stat-trend">
                                        ${lowStockItems.length > 0 ? 
                                            '<i class="fas fa-exclamation me-1"></i><span class="trend-text">Needs attention</span>' :
                                            '<i class="fas fa-check me-1"></i><span class="trend-text">All good!</span>'
                                        }
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="card-footer bg-rgba-white-10">
                        <div class="d-flex justify-content-between">
                            <small><i class="fas fa-bell me-1"></i>Alert system</small>
                            <small><i class="fas fa-clock me-1"></i>Real-time</small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-xl-3 col-md-6">
                <div class="stat-card bg-gradient-info text-white animate-in">
                    <div class="card-body">
                        <div class="row align-items-center">
                            <div class="col-3">
                                <div class="stat-icon">
                                    <i class="fas fa-rupee-sign fa-2x"></i>
                                </div>
                            </div>
                            <div class="col-9">
                                <div class="stat-content">
                                    <h3 class="stat-number">₹${Math.round(totalRevenue)}</h3>
                                    <p class="stat-label mb-0">7-Day Revenue</p>
                                    <div class="stat-trend">
                                        <i class="fas fa-arrow-up me-1"></i>
                                        <span class="trend-text">${totalUnits} units sold</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="card-footer bg-rgba-white-10">
                        <div class="d-flex justify-content-between">
                            <small><i class="fas fa-chart-line me-1"></i>Weekly total</small>
                            <small><i class="fas fa-trending-up me-1"></i>Growing</small>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Low Stock Alerts -->
        <div class="row">
            <div class="col-lg-8">
                <div class="dashboard-card animate-in">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <div>
                            <h5 class="mb-0">
                                <i class="fas fa-exclamation-circle text-danger me-2"></i>
                                Low Stock Alerts
                            </h5>
                            <small class="text-muted">Products requiring immediate attention</small>
                        </div>
                        <span class="badge badge-danger-soft">${lowStockItems.length}</span>
                    </div>
                    <div class="card-body">
                        ${lowStockItems.length > 0 ? `
                            <div class="table-responsive">
                                <table class="table table-hover align-middle">
                                    <thead>
                                        <tr>
                                            <th><i class="fas fa-box me-1"></i>Product</th>
                                            <th><i class="fas fa-tags me-1"></i>Category</th>
                                            <th><i class="fas fa-cubes me-1"></i>Stock</th>
                                            <th><i class="fas fa-flag me-1"></i>Reorder</th>
                                            <th><i class="fas fa-minus me-1"></i>Shortage</th>
                                            <th><i class="fas fa-cogs me-1"></i>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${lowStockItems.map(item => `
                                            <tr class="low-stock-row">
                                                <td>
                                                    <div class="product-info">
                                                        <strong>${item.name}</strong>
                                                        <div class="product-id text-muted small">ID: #${item._id.substring(0, 8)}</div>
                                                    </div>
                                                </td>
                                                <td><span class="badge badge-category">${item.category}</span></td>
                                                <td><span class="stock-critical"><i class="fas fa-exclamation-triangle text-danger me-1"></i><strong>${item.currentStock}</strong></span></td>
                                                <td><span class="text-muted">${item.reorderPoint}</span></td>
                                                <td><span class="badge bg-danger">${item.reorderPoint - item.currentStock}</span></td>
                                                <td>
                                                    <div class="btn-group btn-group-sm">
                                                        <button class="btn btn-success" onclick="updateStock('${item._id}', ${item.currentStock})" title="Update Stock">
                                                            <i class="fas fa-plus"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : `
                            <div class="empty-state text-center py-5">
                                <i class="fas fa-check-circle text-success fa-4x mb-3"></i>
                                <h6>Excellent! All Products Well Stocked</h6>
                                <p class="text-muted">No items are currently below their reorder point.</p>
                            </div>
                        `}
                    </div>
                </div>
            </div>

            <div class="col-lg-4">
                <div class="dashboard-card animate-in">
                    <div class="card-header">
                        <h5 class="mb-0"><i class="fas fa-pie-chart me-2"></i>Category Overview</h5>
                    </div>
                    <div class="card-body">
                        <div class="chart-container mb-3">
                            <canvas id="categoryChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function initializeDashboard() {
    animateCounters();
    initializeCategoryChart();
}

function animateCounters() {
    const counters = document.querySelectorAll('[data-target]');
    counters.forEach(counter => {
        const target = parseInt(counter.getAttribute('data-target'));
        let current = 0;
        const increment = target / 50;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                counter.textContent = target;
                clearInterval(timer);
            } else {
                counter.textContent = Math.floor(current);
            }
        }, 40);
    });
}

async function initializeCategoryChart() {
    try {
        const products = await fetchAPI('/products');
        
        const categoryData = {};
        products.forEach(product => {
            if (!categoryData[product.category]) {
                categoryData[product.category] = { count: 0, totalStock: 0 };
            }
            categoryData[product.category].count++;
            categoryData[product.category].totalStock += product.currentStock;
        });

        const labels = Object.keys(categoryData);
        const data = Object.values(categoryData).map(cat => cat.totalStock);
        const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

        const ctx = document.getElementById('categoryChart').getContext('2d');

        if (categoryChart) {
            categoryChart.destroy();
        }

        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length),
                    borderWidth: 3,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    } catch (error) {
        console.error('Category chart error:', error);
    }
}

// ==================== PRODUCTS PAGE ====================

async function loadProductsPage(container) {
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div><p class="mt-3">Loading products...</p></div>';

    try {
        const [products, dailyReports] = await Promise.all([
            fetchAPI('/products'),
            fetchAPI('/daily-sales/reports')
        ]);
        const forecastInfo = {
            forecastReady: dailyReports.forecastReady,
            daysReported: dailyReports.totalReports,
            daysRemaining: Math.max(0, 7 - dailyReports.totalReports)
        };
        container.innerHTML = getProductsHTML(products, forecastInfo);
    } catch (error) {
        console.error('Products load error:', error);
        container.innerHTML = `<div class="alert alert-danger">Failed to load products: ${error.message}</div>`;
    }
}

function getProductsHTML(products, forecastInfo = { forecastReady: false, daysReported: 0, daysRemaining: 7 }) {
    const importedCount = products.filter(p => p.source && p.source !== 'manual').length;
    const filtered = showImportedOnly ? products.filter(p => p.source && p.source !== 'manual') : products;
    return `
        <div class="d-flex justify-content-between align-items-center mb-4 animate-in">
            <div>
                <h2><i class="fas fa-boxes me-3"></i>Product Inventory</h2>
                <p class="text-muted">Manage all your products and stock levels${importedCount>0?` • Imported: ${importedCount}`:''}</p>
            </div>
            <div class="btn-group">
                <a href="#" onclick="downloadCSVTemplate()" class="btn btn-outline-secondary">
                    <i class="fas fa-download me-2"></i>Download Template
                </a>
                <button class="btn btn-success" onclick="document.getElementById('csvFileInput').click()">
                    <i class="fas fa-file-upload me-2"></i>Import CSV
                </button>
                <a href="#" onclick="showPage('add-product')" class="btn btn-primary">
                    <i class="fas fa-plus me-2"></i>Add New Product
                </a>
                <button class="btn ${showImportedOnly?'btn-warning':'btn-outline-warning'}" onclick="toggleImportedFilter()" title="Filter imported products">
                    <i class="fas fa-filter me-1"></i>${showImportedOnly?'Imported Only':'Show Imported'}
                </button>
                <input type="file" id="csvFileInput" accept=".csv" style="display: none;" onchange="handleCSVUpload(event)">
            </div>
        </div>

        <div class="alert alert-info animate-in mb-3"><i class="fas fa-info-circle me-2"></i>Forecasting is available in the Daily Sales section.</div>

        ${filtered.length > 0 ? `
            <div class="card animate-in">
                <div class="card-body">
                    <div class="table-responsive">
                        <table class="table table-hover align-middle">
                            <thead>
                                <tr>
                                    <th><i class="fas fa-box me-1"></i>Product Name</th>
                                    <th><i class="fas fa-tags me-1"></i>Category</th>
                                    <th><i class="fas fa-rupee-sign me-1"></i>Price</th>
                                    <th><i class="fas fa-cubes me-1"></i>Stock</th>
                                    <th><i class="fas fa-flag me-1"></i>Reorder</th>
                                    <th><i class="fas fa-truck me-1"></i>Supplier</th>
                                    <th><i class="fas fa-database me-1"></i>Source</th>
                                    <th><i class="fas fa-info-circle me-1"></i>Status</th>
                                    <th><i class="fas fa-cogs me-1"></i>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filtered.map(product => {
                                    const isLowStock = product.currentStock <= product.reorderPoint;
                                    const sourceLabel = (product.source||'manual')
                                        .replace('csv_import','CSV')
                                        .replace('daily_sales','Daily')
                                        .replace('manual','Manual');
                                    return `
                                        <tr class="${isLowStock ? 'table-warning' : ''}">
                                            <td>
                                                <div class="fw-bold">${product.name}</div>
                                                <small class="text-muted">Added: ${new Date(product.createdAt).toLocaleDateString()}</small>
                                            </td>
                                            <td><span class="badge bg-secondary">${product.category}</span></td>
                                            <td><strong>₹${product.unitPrice.toFixed(2)}</strong></td>
                                            <td><span class="badge ${isLowStock ? 'bg-danger' : 'bg-success'}">${product.currentStock}</span></td>
                                            <td>${product.reorderPoint}</td>
                                            <td>${product.supplier || 'N/A'}</td>
                                            <td><span class="badge ${product.source==='manual'?'bg-primary':(product.source==='csv_import'?'bg-info':'bg-warning')}">${sourceLabel}</span></td>
                                            <td>
                                                <span class="badge ${isLowStock ? 'bg-danger' : 'bg-success'}">
                                                    ${isLowStock ? '<i class="fas fa-exclamation-triangle me-1"></i>Low Stock' : '<i class="fas fa-check me-1"></i>In Stock'}
                                                </span>
                                            </td>
                                            <td>
                                                <div class="btn-group btn-group-sm">
                                                    <button class="btn btn-outline-primary" onclick="updateStock('${product._id}', ${product.currentStock})" title="Update Stock">
                                                        <i class="fas fa-edit"></i>
                                                    </button>
                                                    <button class="btn btn-outline-danger" onclick="deleteProduct('${product._id}')" title="Delete Product">
                                                        <i class="fas fa-trash"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        ` : `
            <div class="text-center py-5 animate-in">
                <i class="fas fa-box fa-4x text-muted mb-4"></i>
                <h4>${showImportedOnly?'No Imported Products Found':'No Products Found'}</h4>
                <p class="text-muted mb-4">${showImportedOnly?'Imported products (CSV/Daily Sales) will appear here once uploaded.':'Start by adding your first product to the inventory.'}</p>
                ${showImportedOnly?'<button class="btn btn-outline-secondary" onclick="toggleImportedFilter()"><i class="fas fa-undo me-2"></i>Show All</button>':`<a href="#" onclick="showPage('add-product')" class="btn btn-primary btn-lg">
                    <i class="fas fa-plus me-2"></i>Add First Product
                </a>`}
            </div>
        `}
    `;
}

function toggleImportedFilter() {
    showImportedOnly = !showImportedOnly;
    showPage('products');
}

// ==================== ADD PRODUCT PAGE ====================

async function loadAddProductPage(container) {
    try {
        const products = await fetchAPI('/products');
        const categories = [...new Set(products.map(p => p.category))];
        container.innerHTML = getAddProductHTML(categories);
        initializeAddProductPage();
    } catch (error) {
        console.error('Add product page load error:', error);
        container.innerHTML = getAddProductHTML([]);
        initializeAddProductPage();
    }
}

function getAddProductHTML(categories) {
    return `
        <div class="row justify-content-center">
            <div class="col-lg-8">
                <div class="card animate-in">
                    <div class="card-header">
                        <h4 class="mb-0"><i class="fas fa-plus me-3"></i>Add New Product</h4>
                        <p class="mb-0 text-muted">Fill in the product details below</p>
                    </div>
                    <div class="card-body">
                        <form id="addProductForm">
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label for="productName" class="form-label">
                                            <i class="fas fa-box me-2"></i>Product Name
                                        </label>
                                        <input type="text" class="form-control" id="productName" placeholder="Enter product name" required>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label for="productCategory" class="form-label">
                                            <i class="fas fa-tags me-2"></i>Category
                                        </label>
                                        <select class="form-select" id="productCategory" required>
                                            <option value="">Select Category</option>
                                            ${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
                                            <option value="other">Other (specify below)</option>
                                        </select>
                                        <input type="text" class="form-control mt-2 d-none" id="otherCategory" placeholder="Enter new category">
                                    </div>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label for="unitPrice" class="form-label">
                                            <i class="fas fa-rupee-sign me-2"></i>Unit Price
                                        </label>
                                        <input type="number" class="form-control" id="unitPrice" step="0.01" min="0" placeholder="0.00" required>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label for="supplier" class="form-label">
                                            <i class="fas fa-truck me-2"></i>Supplier
                                        </label>
                                        <input type="text" class="form-control" id="supplier" placeholder="Enter supplier name">
                                    </div>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label for="initialStock" class="form-label">
                                            <i class="fas fa-cubes me-2"></i>Initial Stock
                                        </label>
                                        <input type="number" class="form-control" id="initialStock" min="0" placeholder="0" required>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label for="reorderPoint" class="form-label">
                                            <i class="fas fa-flag me-2"></i>Reorder Point
                                        </label>
                                        <input type="number" class="form-control" id="reorderPoint" min="0" placeholder="10" required>
                                    </div>
                                </div>
                            </div>

                            <div class="d-grid gap-2 d-md-flex justify-content-md-end">
                                <button type="button" class="btn btn-secondary me-md-2" onclick="showPage('products')">
                                    <i class="fas fa-times me-2"></i>Cancel
                                </button>
                                <button type="submit" class="btn btn-primary">
                                    <i class="fas fa-plus me-2"></i>Add Product
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function initializeAddProductPage() {
    document.getElementById('productCategory').addEventListener('change', function() {
        const otherInput = document.getElementById('otherCategory');
        if (this.value === 'other') {
            otherInput.classList.remove('d-none');
            otherInput.required = true;
        } else {
            otherInput.classList.add('d-none');
            otherInput.required = false;
        }
    });

    document.getElementById('addProductForm').addEventListener('submit', handleAddProduct);
}

async function handleAddProduct(e) {
    e.preventDefault();

    const name = document.getElementById('productName').value;
    let category = document.getElementById('productCategory').value;
    const unitPrice = parseFloat(document.getElementById('unitPrice').value);
    const supplier = document.getElementById('supplier').value;
    const currentStock = parseInt(document.getElementById('initialStock').value);
    const reorderPoint = parseInt(document.getElementById('reorderPoint').value);

    if (category === 'other') {
        category = document.getElementById('otherCategory').value;
    }

    try {
        await fetchAPI('/products', {
            method: 'POST',
            body: JSON.stringify({ name, category, unitPrice, currentStock, reorderPoint, supplier })
        });

        showAlert('success', `Product "${name}" added successfully!`);

        setTimeout(() => {
            showPage('products');
        }, 1500);
    } catch (error) {
        console.error('Add product error:', error);
        showAlert('danger', error.message || 'Failed to add product');
    }
}

// ==================== REPORTS PAGE ====================

async function loadReportsPage(container) {
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div><p class="mt-3">Loading reports...</p></div>';

    try {
        const [products, sales] = await Promise.all([
            fetchAPI('/products'),
            fetchAPI('/sales')
        ]);

        cachedSalesForReports = sales;
        container.innerHTML = getReportsHTML(products, sales);
        // Hook selector and render with default aggregation
        const aggSelect = document.getElementById('aggregationSelect');
        const mode = aggSelect ? aggSelect.value : 'monthly';
        initializeReportsPage(sales, mode);
        if (aggSelect) {
            aggSelect.addEventListener('change', (e) => {
                initializeReportsPage(cachedSalesForReports || sales, e.target.value);
            });
        }
    } catch (error) {
        console.error('Reports load error:', error);
        container.innerHTML = `<div class="alert alert-danger">Failed to load reports: ${error.message}</div>`;
    }
}

function getReportsHTML(products, sales) {
    const totalProducts = products.length;
    const totalCategories = [...new Set(products.map(p => p.category))].length;

    // Sales by month
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const recentSales = sales.filter(s => new Date(s.date) >= sixMonthsAgo);

    // Top products
    const productSales = {};
    sales.forEach(sale => {
        if (!productSales[sale.productId]) {
            productSales[sale.productId] = {
                name: sale.productName,
                category: sale.category,
                totalSold: 0,
                totalRevenue: 0
            };
        }
        productSales[sale.productId].totalSold += sale.unitsSold;
        productSales[sale.productId].totalRevenue += sale.unitsSold * sale.unitPrice;
    });

    const topProducts = Object.values(productSales).sort((a, b) => b.totalSold - a.totalSold).slice(0, 10);

    return `
        <div class="d-flex justify-content-between align-items-center mb-4 animate-in">
            <div>
                <h2><i class="fas fa-chart-bar me-3"></i>Analytics & Reports</h2>
                <p class="text-muted">Comprehensive business insights</p>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-md-4">
                <div class="card text-center animate-in">
                    <div class="card-body">
                        <i class="fas fa-boxes fa-2x text-primary mb-2"></i>
                        <h5>${totalProducts}</h5>
                        <p class="text-muted mb-0">Total Products</p>
                    </div>
                </div>
            </div>
            <div class="col-md-4">
                <div class="card text-center animate-in">
                    <div class="card-body">
                        <i class="fas fa-tags fa-2x text-info mb-2"></i>
                        <h5>${totalCategories}</h5>
                        <p class="text-muted mb-0">Categories</p>
                    </div>
                </div>
            </div>
            <div class="col-md-4">
                <div class="card text-center animate-in">
                    <div class="card-body">
                        <i class="fas fa-chart-line fa-2x text-success mb-2"></i>
                        <h5>${recentSales.length}</h5>
                        <p class="text-muted mb-0">Recent Sales</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-8">
                <div class="card animate-in">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h5 class="mb-0"><i class="fas fa-chart-line me-2"></i>Sales Trend</h5>
                        <div class="d-flex align-items-center gap-2">
                            <label for="aggregationSelect" class="me-2 mb-0 text-muted small">Granularity</label>
                            <select id="aggregationSelect" class="form-select form-select-sm" style="width: auto;">
                                <option value="daily">Daily (Last 30 days)</option>
                                <option value="weekly">Weekly (Last 12 weeks)</option>
                                <option value="monthly" selected>Monthly (Last 6 months)</option>
                            </select>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="chart-container">
                            <canvas id="salesChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-lg-4">
                <div class="card animate-in">
                    <div class="card-header">
                        <h5 class="mb-0"><i class="fas fa-trophy me-2"></i>Top Products</h5>
                    </div>
                    <div class="card-body">
                        ${topProducts.length > 0 ? `
                            <div class="table-responsive">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            <th>Product</th>
                                            <th>Units</th>
                                            <th>Revenue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${topProducts.map(product => `
                                            <tr>
                                                <td>
                                                    <div class="fw-bold">${product.name}</div>
                                                    <small class="text-muted">${product.category}</small>
                                                </td>
                                                <td><span class="badge bg-primary">${product.totalSold}</span></td>
                                                <td><strong>₹${Math.round(product.totalRevenue)}</strong></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : '<p class="text-muted text-center">No sales data</p>'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function initializeReportsPage(sales, mode = 'monthly') {
    if (!sales || sales.length === 0) return;

    // Helpers
    const toYMD = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().substring(0, 10);
    const getMonday = (d) => {
        const date = new Date(d);
        const day = (date.getDay() + 6) % 7; // 0=Mon
        date.setDate(date.getDate() - day);
        date.setHours(0,0,0,0);
        return date;
    };

    let labels = [];
    let revenueData = [];
    let unitsData = [];

    if (mode === 'daily') {
        // Last 30 days, zero-filled by day
        const days = [];
        const now = new Date();
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            days.push(toYMD(d));
        }
        const byDay = {};
        sales.forEach(s => {
            const key = toYMD(new Date(s.date));
            if (!days.includes(key)) return;
            if (!byDay[key]) byDay[key] = { revenue: 0, units: 0 };
            byDay[key].revenue += s.unitsSold * s.unitPrice;
            byDay[key].units += s.unitsSold;
        });
        labels = days.map(d => {
            const date = new Date(d + 'T00:00:00');
            return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
        });
        revenueData = days.map(d => byDay[d]?.revenue || 0);
        unitsData = days.map(d => byDay[d]?.units || 0);
    } else if (mode === 'weekly') {
        // Last 12 weeks (ISO weeks starting Monday), zero-filled
        const weeks = [];
        const now = getMonday(new Date());
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i * 7);
            weeks.push(toYMD(d)); // week start key
        }
        const byWeek = {};
        sales.forEach(s => {
            const wkStart = toYMD(getMonday(new Date(s.date)));
            if (!weeks.includes(wkStart)) return;
            if (!byWeek[wkStart]) byWeek[wkStart] = { revenue: 0, units: 0 };
            byWeek[wkStart].revenue += s.unitsSold * s.unitPrice;
            byWeek[wkStart].units += s.unitsSold;
        });
        labels = weeks.map(w => {
            const date = new Date(w + 'T00:00:00');
            return 'Wk ' + date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
        });
        revenueData = weeks.map(w => byWeek[w]?.revenue || 0);
        unitsData = weeks.map(w => byWeek[w]?.units || 0);
    } else {
        // Monthly: last 6 months, zero-filled
        const now = new Date();
        const months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push(d.toISOString().substring(0, 7));
        }
        const byMonth = {};
        sales.forEach(s => {
            const key = new Date(s.date).toISOString().substring(0, 7);
            if (!months.includes(key)) return;
            if (!byMonth[key]) byMonth[key] = { revenue: 0, units: 0 };
            byMonth[key].revenue += s.unitsSold * s.unitPrice;
            byMonth[key].units += s.unitsSold;
        });
        labels = months.map(m => {
            const d = new Date(m + '-01T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        });
        revenueData = months.map(m => byMonth[m]?.revenue || 0);
        unitsData = months.map(m => byMonth[m]?.units || 0);
    }

    const ctx = document.getElementById('salesChart').getContext('2d');

    if (dashboardChart) {
        dashboardChart.destroy();
    }

    dashboardChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Revenue (₹)',
                    data: revenueData,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    fill: true,
                    pointRadius: 3,
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'Units Sold',
                    data: unitsData,
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    fill: false,
                    pointRadius: 3,
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Revenue (₹)' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Units Sold' },
                    grid: { drawOnChartArea: false }
                }
            },
            plugins: {
                legend: { position: 'top' },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}

// ==================== PROFILE PAGE ====================

async function loadProfilePage(container) {
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div><p class="mt-3">Loading profile...</p></div>';

    try {
        const activities = await fetchAPI(`/activities?userId=${currentUser.id}&limit=20`);
        container.innerHTML = getProfileHTML(activities);
    } catch (error) {
        console.error('Profile load error:', error);
        container.innerHTML = `<div class="alert alert-danger">Failed to load profile: ${error.message}</div>`;
    }
}

function getProfileHTML(activities) {
    return `
        <div class="row animate-in">
            <div class="col-lg-4">
                <div class="card">
                    <div class="card-body text-center">
                        <div class="profile-avatar mb-3">
                            <i class="fas fa-user-circle fa-5x text-primary"></i>
                        </div>
                        <h4>${currentUser.fullName}</h4>
                        <p class="text-muted">@${currentUser.username}</p>
                        <span class="badge bg-primary">${currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}</span>
                    </div>
                </div>

                <div class="card mt-4">
                    <div class="card-header">
                        <h6 class="mb-0"><i class="fas fa-info-circle me-2"></i>Account Information</h6>
                    </div>
                    <div class="card-body">
                        <div class="mb-3"><strong>Email:</strong> ${currentUser.email}</div>
                        <div class="mb-3"><strong>Member Since:</strong> ${new Date(currentUser.createdAt).toLocaleDateString()}</div>
                        <div class="mb-3"><strong>Last Login:</strong> ${currentUser.lastLogin ? new Date(currentUser.lastLogin).toLocaleDateString() : 'Never'}</div>
                        <div class="mb-3"><strong>Total Activities:</strong> ${activities.length}</div>
                    </div>
                </div>
            </div>

            <div class="col-lg-8">
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0"><i class="fas fa-history me-2"></i>Recent Activity</h6>
                    </div>
                    <div class="card-body">
                        ${activities.length > 0 ? 
                            activities.map(activity => `
                                <div class="d-flex mb-3 activity-item">
                                    <div class="flex-shrink-0">
                                        <div class="activity-icon">
                                            <i class="fas fa-${activity.action === 'add_product' ? 'plus' : activity.action === 'update_stock' ? 'edit' : 'circle'}"></i>
                                        </div>
                                    </div>
                                    <div class="flex-grow-1 ms-3">
                                        <div class="fw-bold">${activity.action.replace('_', ' ').toUpperCase()}</div>
                                        <div class="text-muted small">${activity.details || 'No details'}</div>
                                        <div class="text-muted small"><i class="fas fa-clock me-1"></i>${new Date(activity.timestamp).toLocaleString()}</div>
                                    </div>
                                </div>
                            `).join('') :
                            '<div class="text-center py-4"><p class="text-muted">No activity yet</p></div>'
                        }
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ==================== MODAL FUNCTIONS ====================

function updateStock(productId, currentStock) {
    document.getElementById('updateProductId').value = productId;
    document.getElementById('newStock').value = currentStock;
    document.getElementById('currentStockDisplay').textContent = currentStock;

    const modal = new bootstrap.Modal(document.getElementById('stockUpdateModal'));
    modal.show();
}

async function submitStockUpdate() {
    const productId = document.getElementById('updateProductId').value;
    const newStock = parseInt(document.getElementById('newStock').value);

    if (isNaN(newStock) || newStock < 0) {
        showAlert('danger', 'Please enter a valid stock amount');
        return;
    }

    try {
        await fetchAPI(`/products/${productId}`, {
            method: 'PUT',
            body: JSON.stringify({ currentStock: newStock })
        });

        const modal = bootstrap.Modal.getInstance(document.getElementById('stockUpdateModal'));
        modal.hide();

        showAlert('success', 'Stock updated successfully!');

        setTimeout(() => {
            showPage(currentPage);
        }, 1000);
    } catch (error) {
        console.error('Stock update error:', error);
        showAlert('danger', error.message || 'Failed to update stock');
    }
}

async function deleteProduct(productId) {
    if (!confirm('Are you sure you want to delete this product?')) {
        return;
    }

    try {
        await fetchAPI(`/products/${productId}`, {
            method: 'DELETE'
        });

        showAlert('success', 'Product deleted successfully');

        setTimeout(() => {
            showPage('products');
        }, 1000);
    } catch (error) {
        console.error('Delete product error:', error);
        showAlert('danger', error.message || 'Failed to delete product');
    }
}

async function generateForecast(productId, productName) {
    const modal = new bootstrap.Modal(document.getElementById('forecastModal'));
    modal.show();

    const modalContent = document.getElementById('forecastContent');
    modalContent.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;">
                <span class="visually-hidden">Loading...</span>
            </div>
            <h5>Generating Linear Regression Forecast for ${productName}</h5>
            <p class="text-muted">Analyzing historical sales data and computing demand predictions...</p>
            <div class="progress mt-3">
                <div class="progress-bar progress-bar-striped progress-bar-animated bg-info" style="width: 100%"></div>
            </div>
        </div>
    `;

    try {
        const forecast = await fetchAPI(`/forecast/${productId}`, {
            method: 'POST',
            body: JSON.stringify({ days: 14 })
        });

        displayForecastResults(forecast);
    } catch (error) {
        console.error('Forecast error:', error);
        modalContent.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                ${error.message || 'Failed to generate forecast'}
            </div>
        `;
    }
}

function displayForecastResults(forecast) {
    const product = forecast.product;
    const model = forecast.model;
    const predictions = forecast.forecast;
    const summary = forecast.summary;

    let html = `
        <!-- Model Information -->
        <div class="alert alert-info">
            <h6 class="mb-2"><i class="fas fa-brain me-2"></i>Linear Regression Model</h6>
            <div class="row">
                <div class="col-md-6">
                    <strong>Equation:</strong> ${model.equation}<br>
                    <strong>Accuracy (R²):</strong> ${model.accuracy}%
                </div>
                <div class="col-md-6">
                    <strong>Training Data:</strong> ${model.trainingDays} days<br>
                    <strong>Model Type:</strong> ${model.type}
                </div>
            </div>
        </div>

        <!-- Current Status & Forecast Chart -->
        <div class="row">
            <div class="col-md-4">
                <div class="card bg-light border-info">
                    <div class="card-body text-center">
                        <h6><i class="fas fa-info-circle text-info me-2"></i>Current Status</h6>
                        <div class="mb-2">
                            <span class="badge bg-info fs-6">${product.currentStock} units</span>
                        </div>
                        <small class="text-muted">Reorder at ${product.reorderPoint} units</small>
                        <div class="progress mt-2" style="height: 8px;">
                            <div class="progress-bar bg-info" style="width: ${Math.min((product.currentStock / product.reorderPoint) * 100, 100)}%"></div>
                        </div>
                    </div>
                </div>
                
                <div class="card mt-3 bg-light">
                    <div class="card-body">
                        <h6><i class="fas fa-chart-bar me-2"></i>Forecast Summary</h6>
                        <div class="mb-2">
                            <strong>Total Demand:</strong> ${summary.totalForecastedDemand} units
                        </div>
                        <div class="mb-2">
                            <strong>Avg Daily:</strong> ${summary.avgDailyDemand} units/day
                        </div>
                        <div class="mb-2">
                            <strong>Period:</strong> ${summary.daysForecasted} days
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-8">
                <div class="chart-container" style="height: 300px;">
                    <canvas id="forecastChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Forecast Details Table -->
        <div class="mt-4">
            <h6><i class="fas fa-calendar-alt me-2"></i>14-Day Demand Forecast</h6>
            <div class="table-responsive">
                <table class="table table-sm table-hover">
                    <thead>
                        <tr>
                            <th><i class="fas fa-calendar me-1"></i>Date</th>
                            <th><i class="fas fa-calendar-week me-1"></i>Day</th>
                            <th><i class="fas fa-chart-line me-1"></i>Predicted Demand</th>
                            <th><i class="fas fa-check-circle me-1"></i>Confidence</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    predictions.forEach(day => {
        html += `
            <tr>
                <td><strong>${day.date}</strong></td>
                <td>
                    ${day.isWeekend ? 
                        '<span class="badge bg-info"><i class="fas fa-umbrella-beach me-1"></i>' + day.dayOfWeek + '</span>' : 
                        '<span class="badge bg-secondary"><i class="fas fa-briefcase me-1"></i>' + day.dayOfWeek + '</span>'
                    }
                </td>
                <td><span class="badge bg-primary">${day.predictedDemand} units</span></td>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="progress flex-grow-1 me-2" style="height: 20px;">
                            <div class="progress-bar bg-success" style="width: ${day.confidence}%">
                                ${day.confidence}%
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Recommendation -->
        <div class="mt-4 p-3 ${product.currentStock < product.reorderPoint ? 'bg-danger' : 'bg-success'} bg-opacity-10 rounded">
            <h6><i class="fas fa-lightbulb ${product.currentStock < product.reorderPoint ? 'text-warning' : 'text-success'} me-2"></i>AI Recommendation</h6>
            <p class="mb-0">${summary.recommendation}</p>
        </div>

        <!-- Model Details -->
        <div class="mt-3 p-3 bg-light rounded">
            <h6><i class="fas fa-info-circle text-info me-2"></i>About Linear Regression Forecasting</h6>
            <ul class="small mb-0">
                <li>Uses historical sales data to predict future demand trends</li>
                <li>Calculates best-fit line: <code>y = ${model.slope.toFixed(4)}x + ${model.intercept.toFixed(4)}</code></li>
                <li>R² value of ${model.accuracy}% indicates model accuracy (higher is better)</li>
                <li>Weekend adjustments applied based on historical patterns</li>
                <li>Confidence decreases for predictions further in the future</li>
            </ul>
        </div>
    `;

    document.getElementById('forecastContent').innerHTML = html;

    // Create forecast chart
    setTimeout(() => {
        const ctx = document.getElementById('forecastChart').getContext('2d');

        if (window.forecastChartInstance) {
            window.forecastChartInstance.destroy();
        }

        window.forecastChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: predictions.map(f => {
                    const date = new Date(f.date);
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }),
                datasets: [{
                    label: 'Predicted Demand',
                    data: predictions.map(f => f.predictedDemand),
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: predictions.map(f => f.isWeekend ? '#e74c3c' : '#3498db'),
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        callbacks: {
                            label: function(context) {
                                return `Predicted: ${context.parsed.y} units`;
                            },
                            afterLabel: function(context) {
                                const day = predictions[context.dataIndex];
                                return `Day: ${day.dayOfWeek}\nConfidence: ${day.confidence}%`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Units' }
                    },
                    x: {
                        title: { display: true, text: 'Date' }
                    }
                }
            }
        });
    }, 100);
}

// ==================== UTILITY FUNCTIONS ====================

function showAlert(type, message) {
    const alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) return;

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show animate-in`;
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check' : type === 'danger' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    alertContainer.appendChild(alertDiv);

    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

function hideAllAlerts() {
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        if (alert.parentNode) {
            alert.remove();
        }
    });
}

function fillDemoCredentials() {
    document.getElementById('username').value = 'demo';
    document.getElementById('password').value = 'demo123';
}

function showRegisterForm() {
    const modal = new bootstrap.Modal(document.getElementById('registerModal'));
    modal.show();
}

function registerUser() {
    document.getElementById('registerForm').dispatchEvent(new Event('submit', { cancelable: true }));
}

// ==================== CSV IMPORT FUNCTIONS ====================

async function downloadCSVTemplate() {
    try {
        const response = await fetch(`${API_BASE_URL}/products/template`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'product_import_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showAlert('success', 'Template downloaded successfully!');
    } catch (error) {
        console.error('Download template error:', error);
        showAlert('danger', 'Failed to download template');
    }
}

async function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv')) {
        showAlert('danger', 'Please upload a CSV file');
        event.target.value = '';
        return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
        showAlert('danger', 'File size must be less than 5MB');
        event.target.value = '';
        return;
    }

    try {
        showAlert('info', `Uploading ${file.name}...`);

        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE_URL}/products/import`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            if (result.errors && result.errors.length > 0) {
                // Show validation errors
                let errorMsg = `Import failed with ${result.errors.length} error(s):\\n`;
                errorMsg += result.errors.slice(0, 5).join('\\n');
                if (result.errors.length > 5) {
                    errorMsg += `\\n... and ${result.errors.length - 5} more errors`;
                }
                showAlert('danger', errorMsg.replace(/\\n/g, '<br>'));
            } else {
                throw new Error(result.error || 'Import failed');
            }
        } else {
            showAlert('success', `Successfully imported ${result.count} product(s)!`);
            
            // Reload products page
            setTimeout(() => {
                showPage('products');
            }, 1500);
        }
    } catch (error) {
        console.error('CSV upload error:', error);
        showAlert('danger', error.message || 'Failed to upload CSV file');
    } finally {
        // Reset file input
        event.target.value = '';
    }
}

// ==================== DAILY SALES PAGE ====================

async function loadDailySalesPage(container) {
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div><p class="mt-3">Loading daily sales...</p></div>';

    try {
        const [reportsData, products] = await Promise.all([
            fetchAPI('/daily-sales/reports'),
            fetchAPI('/products')
        ]);
        container.innerHTML = getDailySalesHTML({ ...reportsData, products });
    } catch (error) {
        console.error('Daily sales load error:', error);
        container.innerHTML = getDailySalesHTML({ reports: [], totalReports: 0, forecastReady: false, products: [] });
    }
}

function getDailySalesHTML(data) {
    const { reports, totalReports, forecastReady, products = [] } = data;

    return `
        <div class="animate-in">
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2><i class="fas fa-calendar-check me-3"></i>Daily Sales Reports</h2>
                    <p class="text-muted">Upload CSV files with daily product sales to enable forecasting</p>
                </div>
                <div class="btn-group">
                    <button class="btn btn-outline-secondary" onclick="downloadDailySalesTemplate()">
                        <i class="fas fa-download me-2"></i>Download Template
                    </button>
                    <button class="btn btn-primary" onclick="document.getElementById('dailySalesInput').click()">
                        <i class="fas fa-upload me-2"></i>Upload Daily Sales
                    </button>
                    ${totalReports > 0 ? `<button class="btn btn-outline-danger" onclick="clearAllDailyReports()" title="Clear all daily sales reports">
                        <i class="fas fa-trash me-2"></i>Clear All Reports
                    </button>` : ''}
                    <input type="file" id="dailySalesInput" accept=".csv" style="display: none;" onchange="handleDailySalesUpload(event)">
                </div>
            </div>

            <!-- Progress Card -->
            <div class="card mb-4 ${forecastReady ? 'border-success' : 'border-warning'}">
                <div class="card-body">
                    <div class="row align-items-center">
                        <div class="col-md-8">
                            <h5 class="mb-2">
                                <i class="fas ${forecastReady ? 'fa-check-circle text-success' : 'fa-exclamation-triangle text-warning'} me-2"></i>
                                Forecasting Status
                            </h5>
                            <p class="mb-0">
                                ${forecastReady 
                                    ? '<strong class="text-success">✅ Forecasting Enabled!</strong> You have uploaded enough daily reports.' 
                                    : `<strong class="text-warning">⚠️ More data needed:</strong> Upload ${7 - totalReports} more day(s) of sales data to enable linear regression forecasting.`
                                }
                            </p>
                        </div>
                        <div class="col-md-4 text-end">
                            <div class="display-6 ${forecastReady ? 'text-success' : 'text-warning'}">
                                ${totalReports} / 7 Days
                            </div>
                            <div class="progress mt-2" style="height: 10px;">
                                <div class="progress-bar ${forecastReady ? 'bg-success' : 'bg-warning'}" 
                                     style="width: ${Math.min((totalReports / 7) * 100, 100)}%"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Forecast Panel -->
            <div class="card mb-4">
                <div class="card-body">
                    <div class="row align-items-end">
                        <div class="col-md-8">
                            <label class="form-label"><i class="fas fa-box me-2"></i>Select Product</label>
                            <select id="forecastProductSelect" class="form-select">
                                ${products.map(p => `<option value="${p._id}">${p.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-md-4 text-end">
                            <button class="btn btn-info mt-3" onclick="dailySalesRunForecast()" ${forecastReady ? '' : 'disabled'}>
                                <i class="fas fa-robot me-2"></i>Generate 14-day Forecast
                            </button>
                            ${forecastReady ? '' : `<div class="text-muted small mt-2">Upload ${7 - totalReports} more day(s) to enable.</div>`}
                        </div>
                    </div>
                </div>
            </div>

            ${reports.length > 0 ? `
                <!-- Reports Table -->
                <div class="card">
                    <div class="card-header">
                        <h5 class="mb-0"><i class="fas fa-table me-2"></i>Uploaded Daily Reports</h5>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-hover align-middle">
                                <thead>
                                    <tr>
                                        <th><i class="fas fa-calendar me-1"></i>Date</th>
                                        <th><i class="fas fa-box me-1"></i>Products</th>
                                        <th><i class="fas fa-chart-line me-1"></i>Total Sales</th>
                                        <th><i class="fas fa-rupee-sign me-1"></i>Revenue</th>
                                        <th><i class="fas fa-clock me-1"></i>Uploaded</th>
                                        <th><i class="fas fa-eye me-1"></i>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${reports.map(report => {
                                        const reportDate = new Date(report.date);
                                        const uploadDate = new Date(report.uploadedAt);
                                        return `
                                            <tr>
                                                <td><strong>${reportDate.toLocaleDateString()}</strong></td>
                                                <td><span class="badge bg-info">${report.products.length}</span></td>
                                                <td><strong>${report.totalDaySales}</strong> units</td>
                                                <td><strong>₹${report.totalDayRevenue.toLocaleString()}</strong></td>
                                                <td>${uploadDate.toLocaleString()}</td>
                                                <td>
                                                    <button class="btn btn-sm btn-outline-primary" onclick="viewDailyReport('${report._id}')">
                                                        <i class="fas fa-eye"></i> View
                                                    </button>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ` : `
                <div class="text-center py-5">
                    <i class="fas fa-calendar-plus fa-4x text-muted mb-4"></i>
                    <h4>No Daily Reports Yet</h4>
                    <p class="text-muted mb-4">Upload your first daily sales CSV to start tracking.</p>
                    <button class="btn btn-primary btn-lg" onclick="document.getElementById('dailySalesInput').click()">
                        <i class="fas fa-upload me-2"></i>Upload First Report
                    </button>
                </div>
            `}

            <!-- Help Section -->
            <div class="card mt-4 bg-light">
                <div class="card-body">
                    <h5><i class="fas fa-info-circle me-2"></i>How It Works</h5>
                    <ol>
                        <li><strong>Download Template:</strong> Click "Download Template" to get the CSV format</li>
                        <li><strong>Fill Daily Data:</strong> Add your product sales for each day (productName, unitsSold, unitPrice)</li>
                        <li><strong>Upload Report:</strong> Upload one CSV file per day with that day's sales</li>
                        <li><strong>Track Progress:</strong> After 7 days of uploads, linear regression forecasting will be enabled</li>
                        <li><strong>Get Forecasts:</strong> Use the forecasting panel above to select a product and generate predictions</li>
                    </ol>
                    <p class="mb-0 text-muted"><strong>Note:</strong> Each date can only have one report. Make sure to upload complete data for each day.</p>
                </div>
            </div>
        </div>
    `;
}

async function downloadDailySalesTemplate() {
    try {
        const response = await fetch(`${API_BASE_URL}/daily-sales/template`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'daily_sales_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showAlert('success', 'Template downloaded successfully!');
    } catch (error) {
        console.error('Download template error:', error);
        showAlert('danger', 'Failed to download template');
    }
}

async function handleDailySalesUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
        showAlert('danger', 'Please upload a CSV file');
        event.target.value = '';
        return;
    }

    // Prompt for date
    const date = prompt('Enter the date for this report (YYYY-MM-DD format):', new Date().toISOString().split('T')[0]);
    if (!date) {
        event.target.value = '';
        return;
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        showAlert('danger', 'Invalid date format. Use YYYY-MM-DD');
        event.target.value = '';
        return;
    }

    try {
        showAlert('info', `Uploading daily sales for ${date}...`);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('date', date);

        const response = await fetch(`${API_BASE_URL}/daily-sales/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            if (result.errors) {
                let errorMsg = `Upload failed:\\n${result.errors.slice(0, 3).join('\\n')}`;
                if (result.errors.length > 3) errorMsg += `\\n... and ${result.errors.length - 3} more`;
                showAlert('danger', errorMsg.replace(/\\n/g, '<br>'));
            } else {
                showAlert('danger', result.error || 'Upload failed');
            }
        } else {
            let successMsg = `✅ Daily sales uploaded for ${date}!<br>`;
            successMsg += `Products: ${result.productsCount}, Total Sales: ${result.totalSales} units, Revenue: ₹${result.totalRevenue.toLocaleString()}<br>`;
            successMsg += `<strong>${result.hint}</strong>`;
            showAlert('success', successMsg);
            
            setTimeout(() => {
                showPage('daily-sales');
            }, 2000);
        }
    } catch (error) {
        console.error('Upload error:', error);
        showAlert('danger', error.message || 'Failed to upload daily sales');
    } finally {
        event.target.value = '';
    }
}

function dailySalesRunForecast() {
    const select = document.getElementById('forecastProductSelect');
    if (!select || !select.value) {
        showAlert('danger', 'Please select a product');
        return;
    }
    const productName = select.options[select.selectedIndex].text;
    generateForecast(select.value, productName);
}

async function clearAllDailyReports() {
    if (!confirm('⚠️ Are you sure you want to clear all daily sales reports?\n\nThis will:\n- Delete all uploaded daily reports\n- Reset your forecast progress to 0/7\n- This action cannot be undone!')) {
        return;
    }

    try {
        showAlert('info', 'Clearing all daily sales reports...');

        const response = await fetchAPI('/daily-sales/reports', {
            method: 'DELETE'
        });

        showAlert('success', `Successfully cleared ${response.deletedCount} report(s)! Forecast progress reset to 0/7.`);
        
        // Reload the page after 1.5 seconds
        setTimeout(() => {
            showPage('daily-sales');
        }, 1500);
    } catch (error) {
        console.error('Clear reports error:', error);
        showAlert('danger', error.message || 'Failed to clear reports');
    }
}

async function viewDailyReport(reportId) {
    try {
        const reports = await fetchAPI('/daily-sales/reports');
        const report = reports.reports.find(r => r._id === reportId);
        
        if (!report) {
            showAlert('danger', 'Report not found');
            return;
        }

        const reportDate = new Date(report.date);
        
        // Create modal HTML
        const modalHTML = `
            <div class="modal fade" id="reportModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="fas fa-file-invoice me-2"></i>Daily Sales Report - ${reportDate.toLocaleDateString()}
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row mb-4">
                                <div class="col-md-4">
                                    <div class="card text-center bg-primary text-white">
                                        <div class="card-body">
                                            <h6 class="mb-1">Total Products</h6>
                                            <h3 class="mb-0">${report.products.length}</h3>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-4">
                                    <div class="card text-center bg-success text-white">
                                        <div class="card-body">
                                            <h6 class="mb-1">Total Sales</h6>
                                            <h3 class="mb-0">${report.totalDaySales}</h3>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-4">
                                    <div class="card text-center bg-info text-white">
                                        <div class="card-body">
                                            <h6 class="mb-1">Total Revenue</h6>
                                            <h3 class="mb-0">₹${report.totalDayRevenue.toLocaleString()}</h3>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <h6 class="mb-3"><i class="fas fa-list me-2"></i>Products Sold</h6>
                            <div class="table-responsive">
                                <table class="table table-striped table-hover">
                                    <thead>
                                        <tr>
                                            <th>Product Name</th>
                                            <th class="text-end">Units Sold</th>
                                            <th class="text-end">Unit Price (₹)</th>
                                            <th class="text-end">Total Revenue (₹)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${report.products.map(product => `
                                            <tr>
                                                <td><strong>${product.productName}</strong></td>
                                                <td class="text-end">${product.unitsSold}</td>
                                                <td class="text-end">₹${product.unitPrice.toLocaleString()}</td>
                                                <td class="text-end"><strong>₹${product.totalRevenue.toLocaleString()}</strong></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                    <tfoot class="table-secondary">
                                        <tr>
                                            <td><strong>TOTAL</strong></td>
                                            <td class="text-end"><strong>${report.totalDaySales}</strong></td>
                                            <td></td>
                                            <td class="text-end"><strong>₹${report.totalDayRevenue.toLocaleString()}</strong></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            <div class="mt-3 text-muted small">
                                <i class="fas fa-clock me-2"></i>Uploaded: ${new Date(report.uploadedAt).toLocaleString()}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('reportModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('reportModal'));
        modal.show();

        // Clean up modal after it's hidden
        document.getElementById('reportModal').addEventListener('hidden.bs.modal', function () {
            this.remove();
        });

    } catch (error) {
        console.error('View report error:', error);
        showAlert('danger', 'Failed to load report details');
    }
}
