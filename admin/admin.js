// // ============================================
// // ADMIN PANEL JAVASCRIPT
// // ============================================

// const API_URL = 'http://localhost:5000/api';

// // Global state
// let token = localStorage.getItem('token');
// let admin = JSON.parse(localStorage.getItem('admin') || '{}');
// let allCustomers = [];
// let allMessages = [];

// // ============================================
// // LOGIN PAGE
// // ============================================

// const loginForm = document.getElementById('loginForm');
// if (loginForm) {
//     const loginBtn = document.getElementById('loginBtn');
//     const loginAlert = document.getElementById('loginAlert');
//     console.log('🔐 Admin login script initialized. Found loginForm:', !!loginForm);

//     function showLoginAlert(message, type = 'error') {
//         loginAlert.textContent = message;
//         loginAlert.className = `alert ${type} show`;
        
//         setTimeout(() => {
//             loginAlert.classList.remove('show');
//         }, 5000);
//     }

//     loginForm.addEventListener('submit', async (e) => {
//         e.preventDefault();
        
//         const username = document.getElementById('username').value;
//         const password = document.getElementById('password').value;

//         loginBtn.disabled = true;
//         loginBtn.textContent = 'Loading...';

//         try {
//             const response = await fetch(`${API_URL}/admin/login`, {
//                 method: 'POST',
//                 headers: {
//                     'Content-Type': 'application/json'
//                 },
//                 body: JSON.stringify({ username, password })
//             });

//             const result = await response.json();

//             if (result.success) {
//                 localStorage.setItem('token', result.token);
//                 localStorage.setItem('admin', JSON.stringify(result.admin));
                
//                 window.location.href = 'dashboard.html';
//             } else {
//                 showLoginAlert('❌ ' + result.message, 'error');
//             }
//         } catch (error) {
//             console.error('Login error:', error);
//             showLoginAlert('❌ Tidak dapat terhubung ke server', 'error');
//         }

//         loginBtn.disabled = false;
//         loginBtn.textContent = 'Login';
//     });
// }

// // ============================================
// // DASHBOARD PAGE
// // ============================================

// if (window.location.pathname.includes('dashboard.html')) {
//     // Check authentication
//     if (!token) {
//         window.location.href = 'index.html';
//     }

//     // Display admin name
//     document.getElementById('adminName').textContent = `Hello, ${admin.nama || 'Admin'}`;

//     // ============================================
//     // NAVIGATION
//     // ============================================

//     const navItems = document.querySelectorAll('.nav-item');
//     const pages = document.querySelectorAll('.page');

//     navItems.forEach(item => {
//         item.addEventListener('click', (e) => {
//             e.preventDefault();
            
//             const targetPage = item.dataset.page;
            
//             // Update nav
//             navItems.forEach(nav => nav.classList.remove('active'));
//             item.classList.add('active');
            
//             // Update page
//             pages.forEach(page => page.classList.remove('active'));
//             document.getElementById(targetPage + 'Page').classList.add('active');
            
//             // Load page data
//             if (targetPage === 'dashboard') {
//                 loadDashboard();
//             } else if (targetPage === 'customers') {
//                 loadCustomers();
//             } else if (targetPage === 'messages') {
//                 loadMessages();
//             }
//         });
//     });

//     // ============================================
//     // API CALLS
//     // ============================================

//     async function apiCall(endpoint, options = {}) {
//         try {
//             const response = await fetch(`${API_URL}${endpoint}`, {
//                 ...options,
//                 headers: {
//                     'Content-Type': 'application/json',
//                     'Authorization': `Bearer ${token}`,
//                     ...options.headers
//                 }
//             });

//             if (response.status === 401) {
//                 logout();
//                 return null;
//             }

//             return await response.json();
//         } catch (error) {
//             console.error('API call error:', error);
//             return null;
//         }
//     }

//     // ============================================
//     // DASHBOARD
//     // ============================================

//     async function loadDashboard() {
//         try {
//             // Load statistics
//             const stats = await apiCall('/admin/stats');
            
//             if (stats && stats.success) {
//                 document.getElementById('totalCustomers').textContent = stats.data.total_customers || 0;
//                 document.getElementById('fromInstagram').textContent = stats.data.from_instagram || 0;
//                 document.getElementById('fromWebsite').textContent = stats.data.from_website || 0;
//                 document.getElementById('newCustomers').textContent = stats.data.new_customers || 0;
//             }

//             // Load recent customers
//             const customers = await apiCall('/admin/customers');
            
//             if (customers && customers.success) {
//                 displayRecentCustomers(customers.data.slice(0, 5));
//             }
//         } catch (error) {
//             console.error('Load dashboard error:', error);
//         }
//     }

//     function displayRecentCustomers(customers) {
//         const container = document.getElementById('recentCustomers');
        
//         if (customers.length === 0) {
//             container.innerHTML = '<div class="no-data">Belum ada customer</div>';
//             return;
//         }

//         let html = `
//             <table>
//                 <thead>
//                     <tr>
//                         <th>Nama</th>
//                         <th>WhatsApp</th>
//                         <th>Sales</th>
//                         <th>Source</th>
//                         <th>Status</th>
//                         <th>Tanggal</th>
//                     </tr>
//                 </thead>
//                 <tbody>
//         `;

//         customers.forEach(customer => {
//             const date = new Date(customer.created_at).toLocaleDateString('id-ID');
//             const sourceClass = customer.source.toLowerCase();
//             const statusClass = customer.status.toLowerCase();
            
//             html += `
//                 <tr>
//                     <td>${customer.nama_lengkap}</td>
//                     <td>${customer.whatsapp}</td>
//                     <td>${customer.nama_sales || '-'}</td>
//                     <td><span class="badge ${sourceClass}">${customer.source}</span></td>
//                     <td><span class="badge ${statusClass}">${customer.status}</span></td>
//                     <td>${date}</td>
//                 </tr>
//             `;
//         });

//         html += '</tbody></table>';
//         container.innerHTML = html;
//     }

//     // ============================================
//     // CUSTOMERS PAGE
//     // ============================================

//     async function loadCustomers() {
//         const container = document.getElementById('customersTable');
//         container.innerHTML = '<div class="loading">Loading...</div>';

//         const result = await apiCall('/admin/customers');
        
//         if (result && result.success) {
//             allCustomers = result.data;
//             displayCustomers(allCustomers);
//         } else {
//             container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
//         }
//     }

//     function displayCustomers(customers) {
//         const container = document.getElementById('customersTable');
        
//         if (customers.length === 0) {
//             container.innerHTML = '<div class="no-data">Belum ada customer</div>';
//             return;
//         }

//         let html = `
//             <table>
//                 <thead>
//                     <tr>
//                         <th>No</th>
//                         <th>Nama</th>
//                         <th>WhatsApp</th>
//                         <th>Sales</th>
//                         <th>Produk</th>
//                         <th>Harga</th>
//                         <th>Metode</th>
//                         <th>Source</th>
//                         <th>Status</th>
//                         <th>Tanggal</th>
//                         <th>Aksi</th>
//                     </tr>
//                 </thead>
//                 <tbody>
//         `;

//         customers.forEach((customer, index) => {
//             const date = new Date(customer.created_at).toLocaleDateString('id-ID');
//             const sourceClass = customer.source.toLowerCase();
//             const statusClass = customer.status.toLowerCase();
//             const produk = customer.merk_unit && customer.tipe_unit 
//                 ? `${customer.merk_unit} ${customer.tipe_unit}` 
//                 : '-';
//             const harga = customer.harga 
//                 ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga)
//                 : '-';
            
//             html += `
//                 <tr>
//                     <td>${index + 1}</td>
//                     <td>${customer.nama_lengkap}</td>
//                     <td>${customer.whatsapp}</td>
//                     <td>${customer.nama_sales || '-'}</td>
//                     <td>${produk}</td>
//                     <td>${harga}</td>
//                     <td>${customer.metode_pembayaran || '-'}</td>
//                     <td><span class="badge ${sourceClass}">${customer.source}</span></td>
//                     <td><span class="badge ${statusClass}">${customer.status}</span></td>
//                     <td>${date}</td>
//                     <td>
//                         <div class="table-actions">
//                             <button class="btn-small" onclick="viewCustomer(${customer.id})">Detail</button>
//                         </div>
//                     </td>
//                 </tr>
//             `;
//         });

//         html += '</tbody></table>';
//         container.innerHTML = html;
//     }

//     // Search customer
//     document.getElementById('searchCustomer').addEventListener('input', (e) => {
//         const search = e.target.value.toLowerCase();
//         const filtered = allCustomers.filter(customer => 
//             customer.nama_lengkap.toLowerCase().includes(search) ||
//             customer.whatsapp.includes(search) ||
//             (customer.nama_sales && customer.nama_sales.toLowerCase().includes(search))
//         );
//         displayCustomers(filtered);
//     });

//     // Filter by source
//     document.getElementById('filterSource').addEventListener('change', (e) => {
//         const source = e.target.value;
//         const filtered = source 
//             ? allCustomers.filter(customer => customer.source === source)
//             : allCustomers;
//         displayCustomers(filtered);
//     });

//     // View customer detail
//     window.viewCustomer = async function(customerId) {
//         const result = await apiCall(`/admin/customers/${customerId}`);
        
//         if (result && result.success) {
//             showCustomerDetail(result.data);
//         }
//     };

//     function showCustomerDetail(customer) {
//         const modal = document.getElementById('customerModal');
//         const detail = document.getElementById('customerDetail');
        
//         const date = new Date(customer.created_at).toLocaleString('id-ID');
//         const harga = customer.harga 
//             ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga)
//             : '-';
        
//         detail.innerHTML = `
//             <div class="detail-group">
//                 <div class="detail-label">Nama Lengkap</div>
//                 <div class="detail-value">${customer.nama_lengkap}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">WhatsApp</div>
//                 <div class="detail-value">${customer.whatsapp}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Nama Sales</div>
//                 <div class="detail-value">${customer.nama_sales || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Produk</div>
//                 <div class="detail-value">${customer.merk_unit || '-'} ${customer.tipe_unit || ''}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Harga</div>
//                 <div class="detail-value">${harga}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Qty</div>
//                 <div class="detail-value">${customer.qty || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Tanggal Lahir</div>
//                 <div class="detail-value">${customer.tanggal_lahir || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Alamat</div>
//                 <div class="detail-value">${customer.alamat || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Metode Pembayaran</div>
//                 <div class="detail-value">${customer.metode_pembayaran || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Tahu dari</div>
//                 <div class="detail-value">${customer.tahu_dari || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Source</div>
//                 <div class="detail-value"><span class="badge ${customer.source.toLowerCase()}">${customer.source}</span></div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Status</div>
//                 <div class="detail-value"><span class="badge ${customer.status.toLowerCase()}">${customer.status}</span></div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Tanggal Daftar</div>
//                 <div class="detail-value">${date}</div>
//             </div>
//         `;
        
//         modal.classList.add('show');
//     }

//     window.closeModal = function() {
//         document.getElementById('customerModal').classList.remove('show');
//     };

//     // Close modal on backdrop click
//     document.getElementById('customerModal').addEventListener('click', (e) => {
//         if (e.target.id === 'customerModal') {
//             closeModal();
//         }
//     });

//     // ============================================
//     // MESSAGES PAGE
//     // ============================================

//     async function loadMessages() {
//         const container = document.getElementById('messagesTable');
//         container.innerHTML = '<div class="loading">Loading...</div>';

//         const result = await apiCall('/admin/messages');
        
//         if (result && result.success) {
//             allMessages = result.data;
//             displayMessages(allMessages);
//         } else {
//             container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
//         }
//     }

//     function displayMessages(messages) {
//         const container = document.getElementById('messagesTable');
        
//         if (messages.length === 0) {
//             container.innerHTML = '<div class="no-data">Belum ada pesan</div>';
//             return;
//         }

//         let html = `
//             <table>
//                 <thead>
//                     <tr>
//                         <th>No</th>
//                         <th>Nama Customer</th>
//                         <th>WhatsApp</th>
//                         <th>Arah</th>
//                         <th>Pesan</th>
//                         <th>Waktu</th>
//                     </tr>
//                 </thead>
//                 <tbody>
//         `;

//         messages.forEach((msg, index) => {
//             const time = formatWaktu(msg.sent_at);
//             const directionClass = msg.direction;
//             const directionText = msg.direction === 'in' ? 'Masuk' : 'Keluar';
            
//             html += `
//                 <tr>
//                     <td>${index + 1}</td>
//                     <td>${msg.nama_lengkap}</td>
//                     <td>${msg.whatsapp}</td>
//                     <td><span class="badge ${directionClass}">${directionText}</span></td>
//                     <td style="max-width: 300px;">${msg.message}</td>
//                     <td>${time}</td>
//                 </tr>
//             `;
//         });

//         html += '</tbody></table>';
//         container.innerHTML = html;
//     }

//     // ============================================
//     // LOGOUT
//     // ============================================

//     window.logout = function() {
//         localStorage.removeItem('token');
//         localStorage.removeItem('admin');
//         window.location.href = 'index.html';
//     };

//     // ============================================
//     // INITIAL LOAD
//     // ============================================

//     loadDashboard();
// }

// console.log('✅ Admin Panel initialized');
// console.log('📡 API URL:', API_URL);

// ============================================
// ADMIN PANEL JAVASCRIPT
// ============================================

const API_URL = '/api';
const TIMEZONE = 'Asia/Makassar'; // WITA (UTC+8) - Gorontalo

// Helper: get date string YYYY-MM-DD in WITA timezone
function toWITADate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('sv-SE', { timeZone: TIMEZONE }); // sv-SE gives YYYY-MM-DD
}

// Helper: format date in Indonesian locale with WITA timezone
function formatTanggal(date, options = {}) {
    const defaults = { timeZone: TIMEZONE };
    return new Date(date).toLocaleDateString('id-ID', { ...defaults, ...options });
}

// Helper: format date+time in Indonesian locale with WITA timezone
function formatWaktu(date) {
    return new Date(date).toLocaleString('id-ID', { timeZone: TIMEZONE });
}

// Global state
let token = localStorage.getItem('token');
let admin = JSON.parse(localStorage.getItem('admin') || '{}');
let allCustomers = [];
let allMessages = [];

// ============================================
// LOGOUT FUNCTION (Global - dipindah ke sini agar bisa dipanggil dari HTML)
// ============================================

window.logout = function() {
    console.log('🚪 Logging out...');
    localStorage.removeItem('token');
    localStorage.removeItem('admin');
    window.location.href = 'index.html';
};

// ============================================
// LOGIN PAGE
// ============================================

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    const loginBtn = document.getElementById('loginBtn');
    const loginAlert = document.getElementById('loginAlert');
    console.log('🔐 Admin login script initialized. Found loginForm:', !!loginForm);

    function showLoginAlert(message, type = 'error') {
        loginAlert.textContent = message;
        loginAlert.className = `alert ${type} show`;
        
        setTimeout(() => {
            loginAlert.classList.remove('show');
        }, 5000);
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        loginBtn.disabled = true;
        loginBtn.textContent = 'Loading...';

        try {
            console.log('📡 Attempting login...');
            const response = await fetch(`${API_URL}/admin/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const result = await response.json();
            console.log('📨 Login response:', result);

            if (result.success) {
                localStorage.setItem('token', result.token);
                localStorage.setItem('admin', JSON.stringify(result.admin));
                console.log('✅ Login successful, redirecting...');
                window.location.href = 'dashboard.html';
            } else {
                showLoginAlert('❌ ' + result.message, 'error');
            }
        } catch (error) {
            console.error('❌ Login error:', error);
            showLoginAlert('❌ Tidak dapat terhubung ke server. Pastikan backend sudah jalan!', 'error');
        }

        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    });
}

// ============================================
// DASHBOARD PAGE
// ============================================

// Support both URL forms: /dashboard and /dashboard.html
if (window.location.pathname.includes('dashboard') || window.location.pathname.includes('dashboard.html')) {
    console.log('📊 Loading dashboard...');
    
    // Check authentication
    if (!token) {
        console.warn('⚠️ No token found, redirecting to login...');
        window.location.href = 'index.html';
    }

    // Display admin greeting
    function renderAdminName() {
        const name = admin.nama || admin.username || 'Admin';
        document.getElementById('adminName').textContent = `Welcome back, ${name}`;
    }

    renderAdminName();
    console.log('👤 Admin:', admin.nama || admin.username || 'Admin');

    // ============================================
    // NAVIGATION
    // ============================================

    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            const targetPage = item.dataset.page;
            console.log('📄 Navigating to:', targetPage);
            
            // Update nav
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Update page
            pages.forEach(page => page.classList.remove('active'));
            document.getElementById(targetPage + 'Page').classList.add('active');
            
            // Load page data
            if (targetPage === 'dashboard') {
                loadDashboard();
            } else if (targetPage === 'customers') {
                loadCustomers();
            } else if (targetPage === 'analytics') {
                loadAnalytics();
            } else if (targetPage === 'birthday') {
                loadBirthdayPage();
            } else if (targetPage === 'waconnect') {
                loadWAStatus();
                loadWAAutoReply();
                loadFailedWA();
            } else if (targetPage === 'messages') {
                loadMessages();
                loadCleanupStatus();
            }
        });
    });

    // ============================================
    // API CALLS
    // ============================================

    async function apiCall(endpoint, options = {}) {
        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    ...options.headers
                }
            });

            if (response.status === 401) {
                logout();
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('API error:', error);
            return null;
        }
    }

    // ============================================
    // DASHBOARD
    // ============================================

    async function loadDashboard() {
        try {
            console.log('📊 Loading dashboard stats...');
            
            // Load statistics
            const stats = await apiCall('/admin/stats');
            
            if (stats && stats.success) {
                console.log('✅ Stats loaded:', stats.data);
                document.getElementById('totalCustomers').textContent = stats.data.total_customers || 0;
                document.getElementById('fromInstagram').textContent = stats.data.from_instagram || 0;
                document.getElementById('fromWebsite').textContent = stats.data.from_website || 0;
                document.getElementById('newCustomers').textContent = stats.data.new_customers || 0;
                document.getElementById('contactedCustomers').textContent = stats.data.contacted_customers || 0;
                document.getElementById('followupCustomers').textContent = stats.data.followup_customers || 0;
                document.getElementById('completedCustomers').textContent = stats.data.completed_customers || 0;
                document.getElementById('inactiveCustomers').textContent = stats.data.inactive_customers || 0;

                // Source stats
                document.getElementById('fromFacebook').textContent = stats.data.from_facebook || 0;
                document.getElementById('fromTikTok').textContent = stats.data.from_tiktok || 0;
                document.getElementById('fromFriends').textContent = stats.data.from_friends || 0;
                document.getElementById('fromOthers').textContent = stats.data.from_others || 0;

                // Pipeline stats
                const d = stats.data;
                const formatRp = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0);
                const bulanNow = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: TIMEZONE });

                document.getElementById('pipelinePeriod').textContent = bulanNow;
                document.getElementById('pipelineActive').textContent = d.pipeline_active || 0;
                document.getElementById('pipelineSuccess').textContent = d.pipeline_success || 0;
                document.getElementById('totalOmzet').textContent = formatRp(d.total_omzet);
                document.getElementById('omzetBulanIni').textContent = formatRp(d.omzet_bulan_ini);

                // Compare helper
                function compareHTML(cur, prev, isRp) {
                    cur = Number(cur) || 0;
                    prev = Number(prev) || 0;
                    if (prev === 0 && cur === 0) return '';
                    if (prev === 0) return `<span style="color:#4ADE80;">▲ Baru bulan ini</span>`;
                    const diff = cur - prev;
                    const pct = ((diff) / prev * 100).toFixed(1);
                    const valStr = isRp ? formatRp(Math.abs(diff)) : Math.abs(diff);
                    if (diff > 0) return `<span style="color:#4ADE80;">▲ +${pct}% (+${valStr})</span>`;
                    if (diff < 0) return `<span style="color:#FCA5A5;">▼ ${pct}% (${isRp ? '-' + formatRp(Math.abs(diff)) : diff})</span>`;
                    return `<span style="opacity:0.6;">— Sama</span>`;
                }

                // Pipeline Success compare
                const successIni = Number(d.success_bulan_ini) || 0;
                const successLalu = Number(d.success_bulan_lalu) || 0;
                document.getElementById('pipelineSuccessCompare').innerHTML =
                    `Bulan ini: <strong>${successIni}</strong> · Bulan lalu: ${successLalu}<br>${compareHTML(successIni, successLalu, false)}`;

                // Active change
                document.getElementById('pipelineActiveChange').innerHTML = compareHTML(d.active_bulan_ini, d.active_bulan_lalu, false);

                // Active breakdown
                document.getElementById('pipelineActiveDetail').innerHTML =
                    `🔵 New: ${d.status_new || 0}<br>🟡 Contacted: ${d.status_contacted || 0}<br>🟠 Follow Up: ${d.status_follow_up || 0}`;

                // Omzet compare
                const omzetIni = Number(d.omzet_bulan_ini) || 0;
                const omzetLalu = Number(d.omzet_bulan_lalu) || 0;
                document.getElementById('omzetCompare').innerHTML =
                    `Bulan lalu: ${formatRp(omzetLalu)}<br>${compareHTML(omzetIni, omzetLalu, true)}`;

                // Conversion rate
                const totalAll = Number(d.total_customers) || 0;
                const successAll = Number(d.pipeline_success) || 0;
                const rate = totalAll > 0 ? (successAll / totalAll * 100).toFixed(1) : 0;
                document.getElementById('conversionRate').textContent = `${rate}%`;
                document.getElementById('conversionBar').style.width = `${Math.min(rate, 100)}%`;
            } else {
                console.warn('⚠️ Failed to load stats');
            }

            // Load today's customers
            console.log('📊 Loading today customers...');
            const customers = await apiCall('/admin/customers');

            if (customers && customers.success) {
                const today = toWITADate(new Date());
                dashTodayCustomers = customers.data.filter(c => c.created_at && toWITADate(c.created_at) === today);
                console.log(`✅ Loaded ${dashTodayCustomers.length} customers today`);
                displayRecentCustomers();
            } else {
                document.getElementById('recentCustomers').innerHTML = '<div class="no-data">Belum ada customer</div>';
            }
        } catch (error) {
            console.error('❌ Load dashboard error:', error);
            document.getElementById('recentCustomers').innerHTML = '<div class="no-data">Gagal memuat data</div>';
        }
    }

    let dashTodayCustomers = [];
    let dashActiveTab = 'Belanja';

    window.switchDashTab = function(tab) {
        dashActiveTab = tab;
        const tabBelanja = document.getElementById('dashTabBelanja');
        const tabChatOnly = document.getElementById('dashTabChatOnly');
        if (tab === 'Belanja') {
            tabBelanja.style.borderBottomColor = '#B91C1C';
            tabBelanja.style.color = '#B91C1C';
            tabChatOnly.style.borderBottomColor = 'transparent';
            tabChatOnly.style.color = '#8C8078';
        } else {
            tabChatOnly.style.borderBottomColor = '#B91C1C';
            tabChatOnly.style.color = '#B91C1C';
            tabBelanja.style.borderBottomColor = 'transparent';
            tabBelanja.style.color = '#8C8078';
        }
        displayRecentCustomers();
    };

    function displayRecentCustomers() {
        const container = document.getElementById('recentCustomers');
        const customers = dashTodayCustomers.filter(c => (c.tipe || 'Belanja') === dashActiveTab);

        if (customers.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada customer hari ini</div>';
            return;
        }

        const isBelanja = dashActiveTab === 'Belanja';
        let html = `<table><thead><tr>
            <th>Nama</th>
            <th>WhatsApp</th>`;
        if (isBelanja) {
            html += `<th>Sales</th><th>Produk</th><th>Harga</th>`;
        } else {
            html += `<th>Catatan</th>`;
        }
        html += `<th>Source</th><th>Status</th><th>Jam</th><th>Aksi</th>
            </tr></thead><tbody>`;

        customers.forEach(customer => {
            const time = new Date(customer.created_at).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'});
            const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');

            html += `<tr>
                <td>${customer.nama_lengkap}</td>
                <td style="white-space:nowrap;">${customer.whatsapp} <a href="https://wa.me/${customer.whatsapp}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;background:#25D366;color:#fff;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;text-decoration:none;vertical-align:middle;margin-left:4px;">WA</a></td>`;

            if (isBelanja) {
                const produk = customer.merk_unit && customer.tipe_unit
                    ? `${customer.merk_unit} ${customer.tipe_unit}` : '-';
                const harga = customer.harga
                    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(customer.harga) : '-';
                html += `<td>${customer.nama_sales || '-'}</td>
                    <td>${produk}</td>
                    <td>${harga}</td>`;
            } else {
                html += `<td>${customer.catatan || '-'}</td>`;
            }

            html += `<td><span class="badge ${sourceClass}">${customer.source}</span></td>
                <td><span class="badge ${statusClass}">${customer.status}</span></td>
                <td>${time}</td>
                <td><button class="btn-small" onclick="viewCustomer(${customer.id})">Detail</button></td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ============================================
    // CUSTOMERS PAGE
    // ============================================

    async function loadCustomers() {
        const container = document.getElementById('customersTable');
        container.innerHTML = '<div class="loading">Loading...</div>';

        const result = await apiCall('/admin/customers');

        if (result && result.success) {
            allCustomers = result.data;
            applyFilters();
        } else {
            container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
        }
    }

    window.refreshCustomers = async function() {
        await loadCustomers();
    };

    window.refreshDashboard = async function() {
        pipelineMonthlyData = null;
        await loadDashboard();
    };

    window.refreshAll = async function() {
        const btn = document.getElementById('refreshAllBtn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Loading...';
        btn.disabled = true;

        try {
            // Cari halaman yang aktif
            const activePage = document.querySelector('.nav-item.active');
            const page = activePage ? activePage.dataset.page : 'dashboard';

            // Refresh semua data inti
            pipelineMonthlyData = null;
            await loadDashboard();
            loadCleanupBanner();
            checkWADisconnectBanner();

            // Refresh halaman yang sedang aktif
            if (page === 'customers') await loadCustomers();
            else if (page === 'analytics') loadAnalytics();
            else if (page === 'birthday') loadBirthdayPage();
            else if (page === 'waconnect') { loadWAStatus(); loadWAAutoReply(); loadFailedWA(); }
            else if (page === 'broadcast') { loadDailySentCount(); const s = await apiCall('/admin/broadcast/status'); if (s && s.status) renderBroadcastStatus(s.status); }
            else if (page === 'messages') { await loadMessages(); loadCleanupStatus(); }
        } catch (e) {
            console.error('Refresh error:', e);
        }

        btn.innerHTML = originalHTML;
        btn.disabled = false;
    };

    let activeTab = 'Belanja';
    let currentPage = 1;
    const rowsPerPage = 15;
    let filteredCustomers = [];

    window.switchCustomerTab = function(tab) {
        activeTab = tab;
        currentPage = 1;
        const tabBelanja = document.getElementById('tabBelanja');
        const tabChatOnly = document.getElementById('tabChatOnly');
        if (tab === 'Belanja') {
            tabBelanja.style.borderBottomColor = '#B91C1C';
            tabBelanja.style.color = '#B91C1C';
            tabChatOnly.style.borderBottomColor = 'transparent';
            tabChatOnly.style.color = '#8C8078';
        } else {
            tabChatOnly.style.borderBottomColor = '#B91C1C';
            tabChatOnly.style.color = '#B91C1C';
            tabBelanja.style.borderBottomColor = 'transparent';
            tabBelanja.style.color = '#8C8078';
        }
        applyFilters();
    };

    window.goToPage = function(page) {
        currentPage = page;
        displayCustomers(filteredCustomers);
    };

    function displayCustomers(customers) {
        const container = document.getElementById('customersTable');
        filteredCustomers = customers;

        if (customers.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada customer</div>';
            return;
        }

        const totalPages = Math.ceil(customers.length / rowsPerPage);
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * rowsPerPage;
        const end = start + rowsPerPage;
        const pageData = customers.slice(start, end);
        const isBelanja = activeTab === 'Belanja';

        // Pagination info
        let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:13px;color:#8C8078;">
            <span>Menampilkan ${start + 1}–${Math.min(end, customers.length)} dari <strong>${customers.length}</strong> customer</span>
        </div>`;

        html += `<table><thead><tr>
            <th>No</th>
            <th>Nama</th>
            <th>WhatsApp</th>`;
        if (isBelanja) {
            html += `<th>Sales</th><th>Produk</th><th>Harga</th><th>Metode</th>`;
        } else {
            html += `<th>Catatan</th>`;
        }
        html += `<th>Source</th><th>Status</th><th>WA</th><th>Tanggal</th><th>Aksi</th>
            </tr></thead><tbody>`;

        pageData.forEach((customer, index) => {
            const date = formatTanggal(customer.created_at);
            const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');

            const pCount = customer.purchase_count || 0;
            const repeatBadge = pCount > 1 ? ` <span style="background:#B91C1C;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;">${pCount}x</span>` : '';

            // WA sent indicator
            let waIcon = '<span style="color:#ccc;" title="Belum diketahui">—</span>';
            if (customer.wa_sent === true) waIcon = '<span style="color:#25D366;" title="WA terkirim">&#10003;</span>';
            else if (customer.wa_sent === false) waIcon = '<span style="color:#DC2626;" title="WA gagal terkirim">&#10007;</span>';

            html += `<tr>
                <td>${start + index + 1}</td>
                <td>${customer.nama_lengkap}${repeatBadge}</td>
                <td style="white-space:nowrap;">${customer.whatsapp} <a href="https://wa.me/${customer.whatsapp}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;background:#25D366;color:#fff;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;text-decoration:none;vertical-align:middle;margin-left:4px;" title="Chat WhatsApp">WA</a></td>`;

            if (isBelanja) {
                const produk = customer.merk_unit && customer.tipe_unit
                    ? `${customer.merk_unit} ${customer.tipe_unit}` : '-';
                const harga = customer.harga
                    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga) : '-';
                html += `<td>${customer.nama_sales || '-'}</td>
                    <td>${produk}</td>
                    <td>${harga}</td>
                    <td>${customer.metode_pembayaran || '-'}</td>`;
            } else {
                // Catatan editable for Chat Only
                const catVal = (customer.catatan || '').replace(/"/g, '&quot;');
                html += `<td><input type="text" value="${catVal}" placeholder="Tulis catatan..." style="border:1px solid #EDE8E3;padding:6px 10px;border-radius:6px;font-size:13px;width:100%;min-width:180px;background:#FAFAF8;" onblur="saveCatatan(${customer.id}, this.value)" onkeydown="if(event.key==='Enter'){this.blur();}"></td>`;
            }

            html += `<td><span class="badge ${sourceClass}">${customer.source}</span></td>
                <td><span class="badge ${statusClass}">${customer.status}</span></td>
                <td style="text-align:center;font-size:18px;">${waIcon}</td>
                <td>${date}</td>
                <td><div class="table-actions">
                    <button class="btn-small" onclick="viewCustomer(${customer.id})">Detail</button>
                </div></td>
            </tr>`;
        });

        html += '</tbody></table>';

        // Pagination controls
        if (totalPages > 1) {
            html += `<div style="display:flex;justify-content:center;align-items:center;gap:6px;margin-top:16px;flex-wrap:wrap;">`;

            // Previous
            html += `<button onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}
                style="padding:6px 12px;border:1px solid #EDE8E3;border-radius:6px;background:${currentPage === 1 ? '#F5F3F0' : '#fff'};color:${currentPage === 1 ? '#ccc' : '#5C534B'};cursor:${currentPage === 1 ? 'default' : 'pointer'};font-size:13px;">‹ Prev</button>`;

            // Page numbers
            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

            if (startPage > 1) {
                html += `<button onclick="goToPage(1)" style="padding:6px 10px;border:1px solid #EDE8E3;border-radius:6px;background:#fff;color:#5C534B;cursor:pointer;font-size:13px;">1</button>`;
                if (startPage > 2) html += `<span style="color:#ccc;font-size:13px;">...</span>`;
            }

            for (let i = startPage; i <= endPage; i++) {
                const isActive = i === currentPage;
                html += `<button onclick="goToPage(${i})" style="padding:6px 10px;border:1px solid ${isActive ? '#B91C1C' : '#EDE8E3'};border-radius:6px;background:${isActive ? '#B91C1C' : '#fff'};color:${isActive ? '#fff' : '#5C534B'};cursor:pointer;font-size:13px;font-weight:${isActive ? '600' : '400'};">${i}</button>`;
            }

            if (endPage < totalPages) {
                if (endPage < totalPages - 1) html += `<span style="color:#ccc;font-size:13px;">...</span>`;
                html += `<button onclick="goToPage(${totalPages})" style="padding:6px 10px;border:1px solid #EDE8E3;border-radius:6px;background:#fff;color:#5C534B;cursor:pointer;font-size:13px;">${totalPages}</button>`;
            }

            // Next
            html += `<button onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}
                style="padding:6px 12px;border:1px solid #EDE8E3;border-radius:6px;background:${currentPage === totalPages ? '#F5F3F0' : '#fff'};color:${currentPage === totalPages ? '#ccc' : '#5C534B'};cursor:${currentPage === totalPages ? 'default' : 'pointer'};font-size:13px;">Next ›</button>`;

            html += `</div>`;
        }

        container.innerHTML = html;
    }

    // Combined filter function
    function applyFilters() {
        const search = document.getElementById('searchCustomer').value.toLowerCase().trim();
        const source = document.getElementById('filterSource').value;
        const status = document.getElementById('filterStatus').value;
        const dateFrom = document.getElementById('filterDateFrom').value;
        const dateTo = document.getElementById('filterDateTo').value;

        // Filter by active tab
        let filtered = allCustomers.filter(c => (c.tipe || 'Belanja') === activeTab);
        if (search) filtered = filtered.filter(c => c.nama_lengkap.toLowerCase().includes(search));
        if (source) filtered = filtered.filter(c => c.source === source);
        if (status) filtered = filtered.filter(c => c.status === status);
        if (dateFrom) filtered = filtered.filter(c => new Date(c.created_at) >= new Date(dateFrom));
        if (dateTo) {
            const to = new Date(dateTo);
            to.setDate(to.getDate() + 1);
            filtered = filtered.filter(c => new Date(c.created_at) < to);
        }
        currentPage = 1;
        displayCustomers(filtered);
    }

    document.getElementById('searchCustomer').addEventListener('input', applyFilters);
    document.getElementById('filterSource').addEventListener('change', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('filterDateFrom').addEventListener('change', applyFilters);
    document.getElementById('filterDateTo').addEventListener('change', applyFilters);

    // Status is now fully automatic — no manual update needed

    // View customer detail
    window.viewCustomer = async function(customerId) {
        console.log(`👁️ Viewing customer ${customerId}`);
        const result = await apiCall(`/admin/customers/${customerId}`);
        
        if (result && result.success) {
            showCustomerDetail(result.data);
        }
    };

    function showCustomerDetail(customer) {
        const modal = document.getElementById('customerModal');
        const detail = document.getElementById('customerDetail');
        const formatRpDetail = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0);

        const date = formatWaktu(customer.created_at);
        const harga = customer.harga ? formatRpDetail(customer.harga) : '-';
        const tanggalLahir = customer.tanggal_lahir ? formatTanggal(customer.tanggal_lahir) : '-';
        const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
        const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');

        const purchases = customer.purchases || [];
        const purchaseCount = customer.purchase_count || 0;
        const messages = customer.messages || [];

        // Purchase history section
        let purchaseHtml = '';
        if (purchaseCount > 0) {
            purchaseHtml = `
                <div style="margin-top:20px;padding-top:20px;border-top:2px solid #EDE8E3;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                        <h4 style="margin:0;font-size:15px;color:#1A1412;">Riwayat Pembelian</h4>
                        <span style="background:#B91C1C;color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">${purchaseCount}x</span>
                    </div>
                    <table style="width:100%;font-size:13px;">
                        <thead><tr>
                            <th style="text-align:left;padding:8px 6px;border-bottom:1px solid #EDE8E3;color:#8C8078;font-weight:500;">Tanggal</th>
                            <th style="text-align:left;padding:8px 6px;border-bottom:1px solid #EDE8E3;color:#8C8078;font-weight:500;">Produk</th>
                            <th style="text-align:right;padding:8px 6px;border-bottom:1px solid #EDE8E3;color:#8C8078;font-weight:500;">Harga</th>
                            <th style="text-align:left;padding:8px 6px;border-bottom:1px solid #EDE8E3;color:#8C8078;font-weight:500;">Sales</th>
                        </tr></thead>
                        <tbody>
                            ${purchases.map(p => `
                                <tr>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;">${formatTanggal(p.created_at)}</td>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-weight:500;">${(p.merk_unit || '') + (p.tipe_unit ? ' ' + p.tipe_unit : '') || '-'}</td>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;text-align:right;">${p.harga ? formatRpDetail(p.harga) : '-'}</td>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;">${p.nama_sales || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // Chat history section
        let chatHtml = '';
        if (messages.length > 0) {
            const chatRows = messages.reverse().map(m => {
                const time = formatWaktu(m.sent_at || m.created_at);
                const isIncoming = m.direction === 'incoming';
                const dirBadge = isIncoming
                    ? '<span style="background:#DBEAFE;color:#2563EB;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;">Masuk</span>'
                    : '<span style="background:#DCFCE7;color:#16A34A;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;">Keluar</span>';
                const msgText = (m.message || '').length > 80 ? m.message.substring(0, 80) + '...' : (m.message || '-');
                return `<tr>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:12px;color:#8C8078;white-space:nowrap;">${time}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;text-align:center;">${dirBadge}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:12px;word-break:break-word;">${msgText}</td>
                </tr>`;
            }).join('');

            chatHtml = `
                <div style="margin-top:20px;padding-top:20px;border-top:2px solid #EDE8E3;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                        <h4 style="margin:0;font-size:15px;color:#1A1412;">Riwayat Chat WA</h4>
                        <span style="background:#25D366;color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;">${messages.length} pesan</span>
                    </div>
                    <div style="max-height:250px;overflow-y:auto;border:1px solid #EDE8E3;border-radius:8px;">
                        <table style="width:100%;font-size:13px;border-collapse:collapse;">
                            <thead><tr style="position:sticky;top:0;background:#FAFAF8;">
                                <th style="text-align:left;padding:8px 6px;border-bottom:1px solid #EDE8E3;color:#8C8078;font-weight:500;font-size:11px;">WAKTU</th>
                                <th style="text-align:center;padding:8px 6px;border-bottom:1px solid #EDE8E3;color:#8C8078;font-weight:500;font-size:11px;">ARAH</th>
                                <th style="text-align:left;padding:8px 6px;border-bottom:1px solid #EDE8E3;color:#8C8078;font-weight:500;font-size:11px;">PESAN</th>
                            </tr></thead>
                            <tbody>${chatRows}</tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            chatHtml = `
                <div style="margin-top:20px;padding-top:20px;border-top:2px solid #EDE8E3;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                        <h4 style="margin:0;font-size:15px;color:#1A1412;">Riwayat Chat WA</h4>
                    </div>
                    <div style="text-align:center;padding:20px;color:#8C8078;font-size:13px;">Belum ada riwayat chat</div>
                </div>
            `;
        }

        detail.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
                <div class="detail-group">
                    <div class="detail-label">Nama Lengkap</div>
                    <div class="detail-value">${customer.nama_lengkap}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">WhatsApp</div>
                    <div class="detail-value" style="display:flex;align-items:center;gap:8px;">
                        ${customer.whatsapp}
                        <a href="https://wa.me/${customer.whatsapp}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:#fff;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Chat</a>
                    </div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tanggal Lahir</div>
                    <div class="detail-value">${tanggalLahir}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Alamat</div>
                    <div class="detail-value">${customer.alamat || '-'}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Produk Terakhir</div>
                    <div class="detail-value">${(customer.merk_unit || '') + (customer.tipe_unit ? ' ' + customer.tipe_unit : '') || '-'}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Harga Terakhir</div>
                    <div class="detail-value">${harga}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Metode Bayar</div>
                    <div class="detail-value">${customer.metode_pembayaran || '-'}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Sales</div>
                    <div class="detail-value">${customer.nama_sales || '-'}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tahu dari</div>
                    <div class="detail-value">${customer.tahu_dari || '-'}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Source</div>
                    <div class="detail-value"><span class="badge ${sourceClass}">${customer.source}</span></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Status</div>
                    <div class="detail-value">
                        <select class="status-select ${statusClass}" onchange="updateStatus(${customer.id}, this.value, this)">
                            ${['New','Contacted','Follow Up','Completed','Inactive'].map(s =>
                                `<option value="${s}" ${customer.status === s ? 'selected' : ''}>${s}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tipe</div>
                    <div class="detail-value"><span style="background:${customer.tipe === 'Chat Only' ? 'rgba(37,99,235,0.1);color:#2563EB' : 'rgba(185,28,28,0.08);color:#B91C1C'};padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;">${customer.tipe || 'Belanja'}</span></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Total Pembelian</div>
                    <div class="detail-value" style="font-weight:600;color:#B91C1C;">${purchaseCount}x transaksi</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Terdaftar</div>
                    <div class="detail-value">${date}</div>
                </div>
            </div>
            <!-- Status Legend -->
            <div style="margin-top:16px;padding:12px 16px;background:#FAFAF8;border:1px solid #EDE8E3;border-radius:8px;">
                <div style="font-size:11px;font-weight:600;color:#8C8078;margin-bottom:6px;">KETERANGAN STATUS:</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;color:#5C534B;">
                    <span><strong style="color:#D97706;">New</strong> = Baru masuk</span>
                    <span><strong style="color:#2563EB;">Contacted</strong> = Sudah dihubungi</span>
                    <span><strong style="color:#9333EA;">Follow Up</strong> = Perlu ditindaklanjuti</span>
                    <span><strong style="color:#16A34A;">Completed</strong> = Deal/selesai</span>
                    <span><strong style="color:#8C8078;">Inactive</strong> = Tidak aktif</span>
                </div>
            </div>
            ${purchaseHtml}
            ${chatHtml}
        `;

        modal.classList.add('show');
    }

    window.closeModal = function() {
        document.getElementById('customerModal').classList.remove('show');
    };

    window.updateStatus = async function(customerId, newStatus, selectEl) {
        const res = await apiCall(`/admin/customers/${customerId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        if (res && res.success) {
            selectEl.className = 'status-select ' + newStatus.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            if (allCustomers.length > 0) loadCustomers();
        }
    };

    window.saveCatatan = async function(customerId, value) {
        const res = await apiCall(`/admin/customers/${customerId}/catatan`, {
            method: 'PATCH',
            body: JSON.stringify({ catatan: value })
        });
        if (res && res.success) {
            const c = allCustomers.find(c => c.id === customerId);
            if (c) c.catatan = value;
        }
    };

    // Close modal on backdrop click
    document.getElementById('customerModal').addEventListener('click', (e) => {
        if (e.target.id === 'customerModal') {
            closeModal();
        }
    });

    // ============================================
    // MESSAGES PAGE + DATA CLEANUP
    // ============================================

    // --- Cleanup functions ---

    window.loadCleanupStatus = async function() {
        const container = document.getElementById('cleanupContainer');
        const res = await apiCall('/admin/cleanup/status');

        if (!res || !res.success) {
            container.innerHTML = '<p class="muted">Gagal memuat status cleanup.</p>';
            return;
        }

        const d = res.data;
        const hasOldData = d.totalOldRecords > 0;

        let urgencyColor = '#8C8078';
        let urgencyText = 'Aman';
        if (d.daysUntilCleanup !== null) {
            if (d.daysUntilCleanup <= 0) {
                urgencyColor = '#DC2626';
                urgencyText = 'Perlu dihapus sekarang!';
            } else if (d.daysUntilCleanup <= 3) {
                urgencyColor = '#F59E0B';
                urgencyText = `${d.daysUntilCleanup} hari lagi`;
            } else if (d.daysUntilCleanup <= 7) {
                urgencyColor = '#F59E0B';
                urgencyText = `${d.daysUntilCleanup} hari lagi`;
            } else {
                urgencyText = `${d.daysUntilCleanup} hari lagi`;
            }
        }

        container.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
                <div style="background:#F5F3F0;padding:14px;border-radius:8px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#B91C1C;">${d.oldMessages}</div>
                    <div style="font-size:11px;color:#8C8078;">Chat Log Lama</div>
                </div>
                <div style="background:#F5F3F0;padding:14px;border-radius:8px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#B91C1C;">${d.oldBroadcastJobs}</div>
                    <div style="font-size:11px;color:#8C8078;">Broadcast Job Lama</div>
                </div>
                <div style="background:#F5F3F0;padding:14px;border-radius:8px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#B91C1C;">${d.oldBroadcastRecipients}</div>
                    <div style="font-size:11px;color:#8C8078;">Log Penerima Lama</div>
                </div>
                <div style="background:#F5F3F0;padding:14px;border-radius:8px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:${urgencyColor};">${urgencyText}</div>
                    <div style="font-size:11px;color:#8C8078;">Waktu Cleanup</div>
                </div>
            </div>
            ${hasOldData ? `
                <p style="font-size:13px;color:#5C534B;margin:0 0 12px;">Ada <strong>${d.totalOldRecords}</strong> data lebih dari ${d.cleanupDays} hari. Data customer & pembelian <strong>tidak akan dihapus</strong>, hanya chat log dan broadcast log.</p>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button class="btn-primary" style="width:auto;font-size:13px;" onclick="exportThenDelete()">Export CSV lalu Hapus</button>
                    <button class="btn-small" style="font-size:13px;padding:8px 16px;background:rgba(220,38,38,0.08);color:#DC2626;border:1px solid rgba(220,38,38,0.2);" onclick="deletePermanent()">Hapus Permanen</button>
                    <button class="btn-small" style="font-size:13px;padding:8px 16px;" onclick="exportLogsOnly()">Export CSV Saja</button>
                </div>
            ` : `<p class="muted" style="margin:0;">Tidak ada data lama yang perlu dibersihkan.</p>`}
        `;

        // Update banner di dashboard
        updateCleanupBanner(d);
    };

    function updateCleanupBanner(d) {
        const banner = document.getElementById('cleanupBanner');
        if (!banner) return;

        if (d.totalOldRecords > 0 && d.daysUntilCleanup !== null && d.daysUntilCleanup <= 7) {
            banner.style.display = 'block';
            const title = document.getElementById('cleanupBannerTitle');
            const text = document.getElementById('cleanupBannerText');

            if (d.daysUntilCleanup <= 0) {
                banner.style.background = 'linear-gradient(135deg,#FEE2E2,#FECACA)';
                banner.style.borderColor = '#DC2626';
                title.textContent = 'Data Perlu Dihapus!';
                title.style.color = '#DC2626';
                text.style.color = '#DC2626';
                text.textContent = `${d.totalOldRecords} data chat & broadcast sudah lebih dari ${d.cleanupDays} hari. Silakan export atau hapus untuk menghemat storage.`;
            } else {
                title.textContent = `Cleanup dalam ${d.daysUntilCleanup} hari`;
                text.textContent = `${d.totalOldRecords} data chat & broadcast akan perlu dihapus. Klik "Kelola Data" untuk export atau hapus.`;
            }
        } else {
            banner.style.display = 'none';
        }
    }

    window.navigateToCleanup = function() {
        // Navigate ke Chat Log page
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-page="messages"]').classList.add('active');
        document.getElementById('messagesPage').classList.add('active');
        loadMessages();
        loadCleanupStatus();
    };

    window.exportLogsOnly = async function() {
        try {
            const response = await fetch(`${API_URL}/admin/cleanup/export`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-logs-${toWITADate(new Date())}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            alert('Export berhasil! File CSV sudah didownload.');
        } catch (e) {
            alert('Gagal export: ' + e.message);
        }
    };

    window.exportThenDelete = async function() {
        if (!confirm('Data chat log & broadcast log yang lebih dari 30 hari akan di-export ke CSV lalu dihapus permanen. Lanjutkan?')) return;

        // Export dulu
        try {
            const response = await fetch(`${API_URL}/admin/cleanup/export`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-logs-${toWITADate(new Date())}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('Gagal export, hapus dibatalkan: ' + e.message);
            return;
        }

        // Tunggu sebentar biar download mulai
        await new Promise(r => setTimeout(r, 1000));

        // Lalu hapus
        const res = await apiCall('/admin/cleanup/delete', { method: 'POST', body: '{}' });
        if (res && res.success) {
            alert(`Berhasil! ${res.deleted.total} data lama sudah dihapus.\n\nFile backup CSV sudah didownload.`);
            loadCleanupStatus();
            loadMessages();
        } else {
            alert('Export berhasil tapi gagal menghapus: ' + (res?.message || 'Unknown error'));
        }
    };

    window.deletePermanent = async function() {
        if (!confirm('PERHATIAN: Data chat log & broadcast log yang lebih dari 30 hari akan DIHAPUS PERMANEN tanpa backup. Yakin?')) return;
        if (!confirm('Benar-benar yakin? Data tidak bisa dikembalikan.')) return;

        const res = await apiCall('/admin/cleanup/delete', { method: 'POST', body: '{}' });
        if (res && res.success) {
            alert(`${res.deleted.total} data lama berhasil dihapus permanen.`);
            loadCleanupStatus();
            loadMessages();
        } else {
            alert('Gagal menghapus: ' + (res?.message || 'Unknown error'));
        }
    };

    // Load cleanup status saat dashboard load
    async function loadCleanupBanner() {
        const res = await apiCall('/admin/cleanup/status');
        if (res && res.success) updateCleanupBanner(res.data);
    }

    async function checkWADisconnectBanner() {
        const banner = document.getElementById('waDisconnectBanner');
        if (!banner) return;

        try {
            const [waRes, failedRes] = await Promise.all([
                apiCall('/admin/wa/status'),
                apiCall('/admin/wa/failed')
            ]);

            const isConnected = waRes && waRes.success && waRes.status === 'ready';
            const failedCount = (failedRes && failedRes.success) ? failedRes.count : 0;

            const titleEl = banner.querySelector('strong');
            const textEl = document.getElementById('waDisconnectText');

            if (!isConnected) {
                // WA terputus — banner MERAH
                banner.style.display = 'block';
                banner.style.background = 'linear-gradient(135deg,#FEE2E2,#FECACA)';
                banner.style.borderColor = '#DC2626';
                titleEl.style.color = '#DC2626';
                titleEl.textContent = 'WhatsApp Terputus!';
                textEl.style.color = '#DC2626';
                if (failedCount > 0) {
                    textEl.innerHTML = `Auto-reply tidak aktif. Ada <strong>${failedCount}</strong> pesan gagal terkirim.`;
                } else {
                    textEl.innerHTML = 'Auto-reply dan broadcast tidak aktif.';
                }
            } else if (failedCount > 0) {
                // WA connected tapi ada pesan gagal — banner KUNING
                banner.style.display = 'block';
                banner.style.background = 'linear-gradient(135deg,#FEF3C7,#FDE68A)';
                banner.style.borderColor = '#F59E0B';
                titleEl.style.color = '#92400E';
                titleEl.textContent = 'Pesan Gagal Terkirim';
                textEl.style.color = '#92400E';
                textEl.innerHTML = `Ada <strong>${failedCount}</strong> pesan gagal terkirim. Buka WA Connect untuk kirim ulang.`;
            } else {
                // Semua OK — sembunyikan banner
                banner.style.display = 'none';
            }
        } catch (e) {
            banner.style.display = 'none';
        }
    }

    // --- Messages functions ---

    async function loadMessages() {
        const container = document.getElementById('messagesTable');
        container.innerHTML = '<div class="loading">Loading...</div>';

        console.log('💬 Loading messages...');
        const result = await apiCall('/admin/messages');
        
        if (result && result.success) {
            console.log(`✅ Loaded ${result.data.length} messages`);
            allMessages = result.data;
            displayMessages(allMessages);
        } else {
            console.error('❌ Failed to load messages');
            container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
        }
    }

    function displayMessages(messages) {
        const container = document.getElementById('messagesTable');
        
        if (messages.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada pesan</div>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>No</th>
                        <th>Nama Customer</th>
                        <th>WhatsApp</th>
                        <th>Arah</th>
                        <th>Pesan</th>
                        <th>Waktu</th>
                    </tr>
                </thead>
                <tbody>
        `;

        messages.forEach((msg, index) => {
            const time = formatWaktu(msg.sent_at);
            const directionClass = msg.direction;
            const directionText = msg.direction === 'in' ? 'Masuk' : 'Keluar';
            
            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${msg.nama_lengkap}</td>
                    <td>${msg.whatsapp}</td>
                    <td><span class="badge ${directionClass}">${directionText}</span></td>
                    <td style="max-width: 300px;">${msg.message}</td>
                    <td>${time}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ============================================
    // EXPORT CONTACTS
    // ============================================

    function getExportParams() {
        const source = document.getElementById('filterSource').value;
        const status = document.getElementById('filterStatus').value;
        const dateFrom = document.getElementById('filterDateFrom').value;
        const dateTo = document.getElementById('filterDateTo').value;
        let params = '';
        if (source) params += `&source=${encodeURIComponent(source)}`;
        if (status) params += `&status=${encodeURIComponent(status)}`;
        if (dateFrom) params += `&date_from=${dateFrom}`;
        if (dateTo) params += `&date_to=${dateTo}`;
        return params;
    }

    async function doExport(format) {
        try {
            const filterParams = getExportParams();
            const res = await fetch(`${API_URL}/admin/customers/export?format=${format}${filterParams}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => null);
                alert(err && err.message ? err.message : 'Gagal export CSV (status ' + res.status + ')');
                return;
            }

            const contentType = res.headers.get('Content-Type') || '';
            if (contentType.includes('application/json')) {
                const err = await res.json();
                alert(err.message || 'Gagal export CSV');
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const today = toWITADate(new Date());
            const prefix = format === 'simple' ? 'contacts' : 'customers';
            link.href = url;
            link.download = `${prefix}_${today}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Export error:', e);
            alert('Gagal export. Pastikan koneksi ke server OK.');
        }
    }

    document.getElementById('exportBtn').addEventListener('click', () => doExport('full'));
    document.getElementById('exportSimpleBtn').addEventListener('click', () => doExport('simple'));

    // Export vCard (.vcf) — direct phone contact import
    document.getElementById('exportVcfBtn').addEventListener('click', async () => {
        try {
            const filterParams = getExportParams();
            const res = await fetch(`${API_URL}/admin/customers/export/vcf?${filterParams.replace(/^&/, '')}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => null);
                alert(err && err.message ? err.message : 'Gagal export vCard (status ' + res.status + ')');
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const today = toWITADate(new Date());
            link.href = url;
            link.download = `cahaya_phone_contacts_${today}.vcf`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Export vCard error:', e);
            alert('Gagal export vCard. Pastikan koneksi ke server OK.');
        }
    });

    // ============================================
    // WA CONNECT
    // ============================================

    let waStatusInterval = null;

    window.loadWAStatus = async function() {
        const container = document.getElementById('waStatusContainer');
        const res = await apiCall('/admin/wa/status');

        if (!res || !res.success) {
            const errorMsg = res?.error || 'Tidak bisa terhubung ke WA Bridge';
            container.innerHTML = `
                <div style="text-align:center;padding:30px;">
                    <div style="font-size:48px;margin-bottom:12px;">&#x26A0;</div>
                    <h4 style="margin:0 0 8px;color:#DC2626;">WA Bridge Tidak Tersedia</h4>
                    <p class="muted" style="margin:0 0 16px;">${errorMsg}</p>
                    <p class="muted" style="font-size:12px;">Pastikan WA Bridge sudah di-deploy di Railway dan WA_BRIDGE_URL sudah diset di environment variables.</p>
                </div>
            `;
            // Stop polling
            if (waStatusInterval) { clearInterval(waStatusInterval); waStatusInterval = null; }
            return;
        }

        const { status, qr, info, messagesSentToday, dailyLimit } = res;

        // Update daily stats on the settings section
        const sentEl = document.getElementById('waSentToday');
        if (sentEl) sentEl.textContent = `${messagesSentToday || 0} / ${dailyLimit || 200}`;
        const limitEl = document.getElementById('waDailyLimit');
        if (limitEl && dailyLimit) limitEl.value = dailyLimit;

        if (status === 'ready' && info) {
            // Connected
            container.innerHTML = `
                <div style="text-align:center;padding:20px;">
                    <div style="width:80px;height:80px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.66 0-3.203-.51-4.484-1.375l-.316-.191-2.789.828.779-2.715-.215-.336A7.943 7.943 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>
                    </div>
                    <h3 style="margin:0 0 4px;color:#25D366;">WhatsApp Terhubung</h3>
                    <p style="margin:0 0 4px;font-size:16px;font-weight:600;">${info.name || '-'}</p>
                    <p class="muted" style="margin:0 0 4px;">+${info.phone}</p>
                    <p class="muted" style="margin:0;font-size:12px;">Platform: ${info.platform || '-'}</p>
                    <div style="margin-top:16px;padding:12px;background:rgba(37,211,102,0.08);border-radius:8px;">
                        <span style="font-size:13px;">Pesan terkirim hari ini: <strong style="color:#25D366;">${messagesSentToday || 0}</strong> / ${dailyLimit || 200}</span>
                    </div>
                </div>
            `;
            // Stop polling when connected
            if (waStatusInterval) { clearInterval(waStatusInterval); waStatusInterval = null; }

        } else if (status === 'qr_pending' && qr) {
            // Show QR code
            container.innerHTML = `
                <div style="text-align:center;padding:20px;">
                    <h4 style="margin:0 0 12px;">Scan QR Code dengan WhatsApp</h4>
                    <p class="muted" style="margin:0 0 16px;font-size:13px;">Buka WhatsApp > Menu > Linked Devices > Link a Device</p>
                    <img src="${qr}" alt="QR Code" style="width:280px;height:280px;border:2px solid #EDE8E3;border-radius:12px;">
                    <p class="muted" style="margin:16px 0 0;font-size:12px;">QR akan refresh otomatis...</p>
                </div>
            `;
            // Start polling for status updates (every 3 seconds while QR is showing)
            if (!waStatusInterval) {
                waStatusInterval = setInterval(loadWAStatus, 3000);
            }

        } else if (status === 'authenticated') {
            container.innerHTML = `
                <div style="text-align:center;padding:30px;">
                    <div class="loading">Menghubungkan WhatsApp...</div>
                    <p class="muted" style="margin-top:8px;">Authenticated, sedang loading...</p>
                </div>
            `;
            if (!waStatusInterval) {
                waStatusInterval = setInterval(loadWAStatus, 3000);
            }

        } else {
            // Disconnected or error
            container.innerHTML = `
                <div style="text-align:center;padding:30px;">
                    <div style="font-size:48px;margin-bottom:12px;">&#x1F4F1;</div>
                    <h4 style="margin:0 0 8px;">WhatsApp Belum Terhubung</h4>
                    <p class="muted" style="margin:0 0 16px;">Status: ${status}${res.lastError ? ' - ' + res.lastError : ''}</p>
                    <button class="btn-primary" style="width:auto;" onclick="restartWA()">Mulai Koneksi (Generate QR)</button>
                </div>
            `;
            if (waStatusInterval) { clearInterval(waStatusInterval); waStatusInterval = null; }
        }
    };

    window.loadWAAutoReply = async function() {
        const res = await apiCall('/admin/wa/auto-reply');
        if (res && res.success) {
            const toggle = document.getElementById('waAutoReplyToggle');
            const slider = document.getElementById('waAutoReplySlider');
            const statusEl = document.getElementById('waAutoReplyStatus');
            const msgEl = document.getElementById('waAutoReplyMessage');

            toggle.checked = res.autoReply;
            slider.style.background = res.autoReply ? '#25D366' : '#ccc';
            statusEl.textContent = res.autoReply ? 'Aktif' : 'Nonaktif';
            statusEl.style.color = res.autoReply ? '#25D366' : '#8C8078';
            if (res.autoReplyMessage) msgEl.value = res.autoReplyMessage;
        }
    };

    window.toggleWAAutoReply = async function() {
        const toggle = document.getElementById('waAutoReplyToggle');
        const slider = document.getElementById('waAutoReplySlider');
        const statusEl = document.getElementById('waAutoReplyStatus');

        const enabled = toggle.checked;
        slider.style.background = enabled ? '#25D366' : '#ccc';
        statusEl.textContent = enabled ? 'Aktif' : 'Nonaktif';
        statusEl.style.color = enabled ? '#25D366' : '#8C8078';

        await apiCall('/admin/wa/auto-reply', {
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
    };

    window.saveWAAutoReply = async function() {
        const message = document.getElementById('waAutoReplyMessage').value.trim();
        const enabled = document.getElementById('waAutoReplyToggle').checked;
        if (!message) { alert('Pesan auto-reply tidak boleh kosong!'); return; }

        const res = await apiCall('/admin/wa/auto-reply', {
            method: 'POST',
            body: JSON.stringify({ enabled, message })
        });
        if (res && res.success) {
            alert('Auto-reply berhasil disimpan!');
        } else {
            alert('Gagal menyimpan: ' + (res?.error || 'Unknown error'));
        }
    };

    window.saveWASettings = async function() {
        const dailyLimit = parseInt(document.getElementById('waDailyLimit').value);
        if (!dailyLimit || dailyLimit < 10) { alert('Limit minimal 10 pesan/hari'); return; }

        const res = await apiCall('/admin/wa/settings', {
            method: 'POST',
            body: JSON.stringify({ dailyLimit })
        });
        if (res && res.success) {
            alert('Settings berhasil disimpan!');
        } else {
            alert('Gagal menyimpan: ' + (res?.error || 'Unknown error'));
        }
    };

    window.disconnectWA = async function() {
        if (!confirm('Yakin mau disconnect WhatsApp? Anda perlu scan QR ulang nanti.')) return;

        const res = await apiCall('/admin/wa/disconnect', { method: 'POST', body: '{}' });
        if (res && res.success) {
            alert('WhatsApp berhasil di-disconnect.');
            loadWAStatus();
        } else {
            alert('Gagal disconnect: ' + (res?.error || 'Unknown error'));
        }
    };

    window.restartWA = async function() {
        const container = document.getElementById('waStatusContainer');
        container.innerHTML = '<div class="loading">Restarting WhatsApp client...</div>';

        const res = await apiCall('/admin/wa/restart', { method: 'POST', body: '{}' });
        if (res && res.success) {
            // Start polling for QR
            setTimeout(loadWAStatus, 2000);
        } else {
            alert('Gagal restart: ' + (res?.error || 'Unknown error'));
            loadWAStatus();
        }
    };

    // ============================================
    // FAILED WA MESSAGES - RETRY
    // ============================================

    window.loadFailedWA = async function() {
        const container = document.getElementById('failedWAContainer');
        if (!container) return;
        const res = await apiCall('/admin/wa/failed');
        if (!res || !res.success || res.count === 0) {
            container.innerHTML = '<div class="no-data" style="color:#25D366;">Semua pesan berhasil terkirim ✓</div>';
            return;
        }
        let html = `<p style="font-size:13px;color:#B91C1C;margin:0 0 12px;font-weight:600;">${res.count} pesan gagal terkirim</p>`;
        html += '<div style="max-height:300px;overflow-y:auto;">';
        html += '<table><thead><tr><th>Nama</th><th>WhatsApp</th><th>Tipe</th><th>Aksi</th></tr></thead><tbody>';
        res.data.forEach(c => {
            html += `<tr>
                <td>${c.nama_lengkap}</td>
                <td>${c.whatsapp}</td>
                <td><span class="badge">${c.tipe || 'Belanja'}</span></td>
                <td><button class="btn-small" style="padding:4px 12px;font-size:11px;" onclick="retrySingleWA(${c.id})">Kirim Ulang</button></td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        container.innerHTML = html;
    };

    window.retrySingleWA = async function(id) {
        const res = await apiCall(`/admin/wa/retry/${id}`, { method: 'POST', body: '{}' });
        alert(res?.message || 'Error');
        loadFailedWA();
    };

    window.retryAllWA = async function() {
        if (!confirm('Kirim ulang semua pesan yang gagal?')) return;
        const res = await apiCall('/admin/wa/retry-all', { method: 'POST', body: '{}' });
        alert(res?.message || 'Error');
        loadFailedWA();
    };

    // ============================================
    // BROADCAST
    // ============================================

    const broadcastStartBtn = document.getElementById('broadcastStartBtn');
    const broadcastPauseBtn = document.getElementById('broadcastPauseBtn');
    const broadcastResumeBtn = document.getElementById('broadcastResumeBtn');
    const broadcastStopBtn  = document.getElementById('broadcastStopBtn');
    const broadcastStatusEl = document.getElementById('broadcastStatus');
    const dailySentCountEl = document.getElementById('dailySentCount');

    // Load daily sent count on page load
    async function loadDailySentCount() {
        const res = await apiCall('/admin/broadcast/daily-count');
        if (res && res.success) {
            const count = res.daily_sent || 0;
            dailySentCountEl.textContent = count;
            // Color based on count
            if (count >= 300) {
                dailySentCountEl.style.color = '#e74c3c';
            } else if (count >= 100) {
                dailySentCountEl.style.color = '#f39c12';
            } else {
                dailySentCountEl.style.color = '#2ecc71';
            }
        }
    }
    loadDailySentCount();

    function renderBroadcastStatus(status) {
        if (!status) {
            broadcastStatusEl.innerHTML = '<p class="muted">Belum ada broadcast aktif.</p>';
            return;
        }
        const progressPct = status.total > 0 ? Math.round(((status.sent + status.failed) / status.total) * 100) : 0;
        const logHtml = (status.log || []).slice(-20).reverse().map(entry => {
            if (entry.info) return `<div class="muted" style="font-size:12px;">${entry.info}</div>`;
            const icon = entry.success ? '✅' : '❌';
            return `<div style="font-size:12px;">${icon} ${entry.name || entry.phone} — ${entry.success ? 'Terkirim' : 'Gagal: ' + (entry.error || '')}</div>`;
        }).join('');

        // Anti-spam: soft warning at 100 messages/day
        const dailySent = status.daily_sent || 0;
        // Update top counter too
        if (dailySentCountEl) {
            dailySentCountEl.textContent = dailySent;
            dailySentCountEl.style.color = dailySent >= 300 ? '#e74c3c' : dailySent >= 100 ? '#f39c12' : '#2ecc71';
        }
        let warningHtml = '';
        if (dailySent >= 100) {
            const warningColor = dailySent >= 300 ? '#e74c3c' : '#f39c12';
            const warningIcon = dailySent >= 300 ? '🔴' : '🟡';
            const warningText = dailySent >= 300
                ? `${warningIcon} RISIKO TINGGI! Sudah ${dailySent} pesan hari ini. Sangat berisiko banned.`
                : `${warningIcon} Perhatian: Sudah ${dailySent} pesan hari ini. Hati-hati risiko banned.`;
            warningHtml = `<div style="background:${warningColor}15;border:1px solid ${warningColor};color:${warningColor};padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:13px;font-weight:600;">${warningText}</div>`;
        }

        broadcastStatusEl.innerHTML = `
            ${warningHtml}
            <div style="margin-bottom:12px;">
                <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
                    <span><strong>Status:</strong> ${status.running ? (status.paused ? '⏸ Dijeda' : '▶ Berjalan') : '⏹ Selesai/Berhenti'}</span>
                    <span><strong>Total:</strong> ${status.total}</span>
                    <span><strong>Terkirim:</strong> <span style="color:green">${status.sent}</span></span>
                    <span><strong>Gagal:</strong> <span style="color:red">${status.failed}</span></span>
                    <span><strong>Antrian:</strong> ${status.queued}</span>
                    <span><strong>Hari ini:</strong> ${dailySent} pesan</span>
                </div>
                <div style="background:#eee;border-radius:4px;height:8px;">
                    <div style="background:#27ae60;width:${progressPct}%;height:8px;border-radius:4px;transition:width 0.3s;"></div>
                </div>
                <small class="muted">${progressPct}% selesai — delay 3-8 detik antar pesan (anti-spam)</small>
            </div>
            <div style="max-height:200px;overflow-y:auto;border:1px solid #eee;padding:8px;border-radius:4px;">
                ${logHtml || '<span class="muted">Log kosong</span>'}
            </div>
        `;

        // Update button states
        broadcastStartBtn.disabled = status.running && !status.paused;
        broadcastPauseBtn.disabled = !status.running || status.paused;
        broadcastResumeBtn.disabled = !status.paused;
        broadcastStopBtn.disabled = !status.running && status.queued === 0;
    }

    let broadcastProcessing = false; // flag to prevent double-processing

    // Process broadcast in batches (frontend drives the loop)
    async function processBroadcastLoop() {
        if (broadcastProcessing) return;
        broadcastProcessing = true;
        broadcastStartBtn.disabled = true;

        let errorCount = 0;
        const MAX_ERRORS = 5; // Stop after 5 consecutive errors

        while (broadcastProcessing) {
            const res = await apiCall('/admin/broadcast/process', { method: 'POST', body: '{}' });
            if (!res || !res.success) {
                errorCount++;
                if (errorCount >= MAX_ERRORS) {
                    console.warn('⚠️ Broadcast loop stopped: too many consecutive errors');
                    broadcastProcessing = false;
                    break;
                }
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }
            errorCount = 0; // reset on success
            renderBroadcastStatus(res.status);

            // Stop loop if broadcast is done or paused
            if (!res.status.running || res.status.paused) {
                broadcastProcessing = false;
                break;
            }

            // Server handles 3-8s random delay per message (anti-spam)
            // No extra frontend delay needed
        }
    }

    broadcastStartBtn.addEventListener('click', async () => {
        const message = document.getElementById('broadcastMessage').value.trim();
        const source = document.getElementById('broadcastSource').value;
        const merk = document.getElementById('broadcastMerk').value;
        const metode = document.getElementById('broadcastMetode').value;
        if (!message) {
            alert('Pesan broadcast tidak boleh kosong!');
            return;
        }
        const filterInfo = [source ? 'source: ' + source : '', merk ? 'merk: ' + merk : '', metode ? 'metode: ' + metode : ''].filter(Boolean).join(', ');
        if (!confirm(`Yakin mau kirim broadcast ke customer${filterInfo ? ' (' + filterInfo + ')' : ' (semua)'}?\n\nPesan:\n${message}`)) return;

        broadcastStartBtn.disabled = true;
        broadcastStartBtn.textContent = 'Memulai...';

        const body = { message };
        if (source) body.source_filter = source;
        if (merk) body.merk_filter = merk;
        if (metode) body.metode_filter = metode;

        const res = await apiCall('/admin/broadcast/start', { method: 'POST', body: JSON.stringify(body) });
        broadcastStartBtn.textContent = '▶ Mulai Broadcast';

        if (res && res.success) {
            renderBroadcastStatus(res.status);
            broadcastPauseBtn.disabled = false;
            broadcastStopBtn.disabled = false;
            // Start processing loop
            processBroadcastLoop();
        } else {
            alert('Gagal memulai broadcast: ' + (res?.message || 'Unknown error'));
            broadcastStartBtn.disabled = false;
        }
    });

    broadcastPauseBtn.addEventListener('click', async () => {
        broadcastProcessing = false; // stop the loop
        const res = await apiCall('/admin/broadcast/pause', { method: 'POST', body: '{}' });
        if (res) {
            const s = await apiCall('/admin/broadcast/status');
            if (s && s.status) renderBroadcastStatus(s.status);
        }
    });

    broadcastResumeBtn.addEventListener('click', async () => {
        const res = await apiCall('/admin/broadcast/resume', { method: 'POST', body: '{}' });
        if (res) {
            // Restart the processing loop
            processBroadcastLoop();
        }
    });

    broadcastStopBtn.addEventListener('click', async () => {
        if (!confirm('Yakin mau menghentikan broadcast?')) return;
        broadcastProcessing = false; // stop the loop
        const res = await apiCall('/admin/broadcast/stop', { method: 'POST', body: '{}' });
        if (res) {
            const s = await apiCall('/admin/broadcast/status');
            if (s && s.status) renderBroadcastStatus(s.status);
        }
    });

    document.getElementById('refreshStatusBtn').addEventListener('click', async () => {
        const res = await apiCall('/admin/broadcast/status');
        if (res && res.status) renderBroadcastStatus(res.status);
    });


    // ============================================
    // BIRTHDAY GREETING PAGE
    // ============================================

    async function loadBirthdayPage() {
        loadBirthdayToday();
        loadBirthdayHistory();
    }

    window.refreshBirthday = loadBirthdayPage;

    async function loadBirthdayToday() {
        const container = document.getElementById('birthdayTodayList');
        container.innerHTML = '<div class="loading">Loading...</div>';
        try {
            const result = await apiCall('/admin/birthday/today');
            if (!result || !result.success) {
                container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
                return;
            }

            const { customers, message, autoSend } = result.data;
            document.getElementById('birthdayAutoSend').checked = autoSend;
            document.getElementById('birthdayMessageTemplate').value = message;

            if (customers.length === 0) {
                container.innerHTML = '<div class="no-data" style="text-align:center;padding:30px;color:#8C8078;">Tidak ada customer yang ulang tahun hari ini</div>';
                document.getElementById('sendAllBirthdayBtn').style.display = 'none';
                return;
            }

            const pending = customers.filter(c => !c.greeting_id || c.greeting_status === 'failed');
            document.getElementById('sendAllBirthdayBtn').style.display = pending.length > 0 ? '' : 'none';

            let html = `<table style="width:100%;border-collapse:collapse;"><thead><tr>
                <th style="text-align:left;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">NAMA</th>
                <th style="text-align:left;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">WHATSAPP</th>
                <th style="text-align:left;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">TGL LAHIR</th>
                <th style="text-align:center;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">STATUS</th>
                <th style="text-align:center;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">AKSI</th>
            </tr></thead><tbody>`;

            customers.forEach(c => {
                const tgl = c.tanggal_lahir ? new Date(c.tanggal_lahir).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
                let statusBadge = '';
                let actionBtn = '';

                if (c.greeting_status === 'sent') {
                    statusBadge = '<span style="background:#DCFCE7;color:#16A34A;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Terkirim</span>';
                    if (c.sent_at) {
                        try {
                            const d = new Date(c.sent_at);
                            const jam = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' });
                            statusBadge += `<br><span style="font-size:10px;color:#8C8078;">${jam} WITA</span>`;
                        } catch(e) {}
                    }
                    actionBtn = `<button class="btn-small" onclick="sendBirthdayGreeting(${c.id})" style="font-size:11px;padding:4px 12px;">Kirim Ulang</button>`;
                } else if (c.greeting_status === 'failed') {
                    statusBadge = '<span style="background:#FEE2E2;color:#DC2626;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Gagal</span>';
                    if (c.greeting_error) {
                        statusBadge += `<br><span style="font-size:10px;color:#DC2626;" title="${c.greeting_error}">${c.greeting_error.length > 30 ? c.greeting_error.substring(0, 30) + '...' : c.greeting_error}</span>`;
                    }
                    actionBtn = `<button class="btn-small" onclick="sendBirthdayGreeting(${c.id})" style="font-size:11px;padding:4px 12px;">Kirim Ulang</button>`;
                } else {
                    statusBadge = '<span style="background:#FEF3C7;color:#D97706;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Belum</span>';
                    actionBtn = `<button class="btn-small" onclick="sendBirthdayGreeting(${c.id})" style="font-size:11px;padding:4px 12px;">Kirim</button>`;
                }

                html += `<tr>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;font-weight:500;">${c.nama_lengkap}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;font-size:13px;">${c.whatsapp}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;font-size:13px;">${tgl}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${statusBadge}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${actionBtn}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = '<div class="no-data">Error: ' + err.message + '</div>';
        }
    }

    window.sendBirthdayGreeting = async function(customerId) {
        const result = await apiCall('/admin/birthday/send', {
            method: 'POST',
            body: JSON.stringify({ customer_id: customerId })
        });
        if (result && result.success) {
            alert('Ucapan berhasil dikirim!');
        } else {
            const errMsg = result?.message || result?.error || 'Error';
            if (errMsg.toLowerCase().includes('tidak terdaftar')) {
                alert('⚠️ Gagal kirim: ' + errMsg + '\n\nNomor ini tidak bisa menerima pesan WhatsApp.');
            } else {
                alert('Gagal mengirim: ' + errMsg);
            }
        }
        loadBirthdayToday();
        loadBirthdayHistory();
    };

    window.sendAllBirthdayGreetings = async function() {
        if (!confirm('Kirim ucapan ulang tahun ke semua customer yang belum terkirim?')) return;
        const btn = document.getElementById('sendAllBirthdayBtn');
        btn.disabled = true;
        btn.textContent = 'Mengirim...';

        const result = await apiCall('/admin/birthday/send-all', { method: 'POST' });
        if (result && result.success) {
            alert(`Selesai! Terkirim: ${result.sent}, Gagal: ${result.failed}`);
        } else {
            alert('Error: ' + (result?.message || 'Gagal'));
        }

        btn.disabled = false;
        btn.textContent = 'Kirim Semua';
        loadBirthdayToday();
        loadBirthdayHistory();
    };

    window.saveBirthdayMessage = async function() {
        const message = document.getElementById('birthdayMessageTemplate').value;
        const result = await apiCall('/admin/birthday/message', {
            method: 'PUT',
            body: JSON.stringify({ message })
        });
        if (result && result.success) {
            alert('Template pesan berhasil disimpan!');
        } else {
            alert('Gagal menyimpan: ' + (result?.message || 'Error'));
        }
    };

    window.toggleBirthdayAutoSend = async function(enabled) {
        await apiCall('/admin/birthday/auto-send', {
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
    };

    async function loadBirthdayHistory() {
        const container = document.getElementById('birthdayHistory');
        container.innerHTML = '<div class="loading">Loading...</div>';
        try {
            const result = await apiCall('/admin/birthday/history');
            if (!result || !result.success || result.data.length === 0) {
                container.innerHTML = '<div class="no-data">Belum ada riwayat ucapan</div>';
                return;
            }

            let html = `<table style="width:100%;border-collapse:collapse;"><thead><tr>
                <th style="text-align:left;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">NAMA</th>
                <th style="text-align:left;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">TGL LAHIR</th>
                <th style="text-align:center;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">TAHUN</th>
                <th style="text-align:center;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">STATUS</th>
                <th style="text-align:left;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">DIKIRIM</th>
            </tr></thead><tbody>`;

            result.data.forEach(h => {
                const tgl = h.tanggal_lahir ? new Date(h.tanggal_lahir).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-';
                let sentAt = '-';
                if (h.sent_at) {
                    try {
                        const d = new Date(h.sent_at);
                        const tglSent = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' });
                        const jam = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' });
                        sentAt = `${tglSent} ${jam} WITA`;
                    } catch(e) {}
                }
                let badge;
                if (h.status === 'sent') {
                    badge = '<span style="background:#DCFCE7;color:#16A34A;padding:2px 8px;border-radius:6px;font-size:11px;">Terkirim</span>';
                } else {
                    badge = '<span style="background:#FEE2E2;color:#DC2626;padding:2px 8px;border-radius:6px;font-size:11px;">Gagal</span>';
                    if (h.error) {
                        badge += `<br><span style="font-size:10px;color:#DC2626;" title="${h.error}">${h.error.length > 25 ? h.error.substring(0, 25) + '...' : h.error}</span>`;
                    }
                }

                html += `<tr>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:13px;">${h.nama_lengkap}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:13px;">${tgl}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:13px;text-align:center;">${h.greeting_year}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;text-align:center;">${badge}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:12px;color:#8C8078;">${sentAt}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = '<div class="no-data">Error</div>';
        }
    }

    // ============================================
    // ANALYTICS PAGE
    // ============================================

    let analyticsTab = 'buyers';
    let analyticsCache = {};

    async function loadAnalytics() {
        analyticsCache = {};
        await renderAnalyticsTab();
    }

    window.refreshAnalytics = async function() {
        analyticsCache = {};
        await renderAnalyticsTab();
    };

    window.switchAnalyticsTab = function(tab) {
        analyticsTab = tab;
        const tabs = { buyers: 'tabTopBuyers', products: 'tabTopProducts', brands: 'tabTopBrands' };
        Object.entries(tabs).forEach(([key, id]) => {
            const el = document.getElementById(id);
            if (key === tab) {
                el.style.borderBottomColor = '#B91C1C';
                el.style.color = '#B91C1C';
            } else {
                el.style.borderBottomColor = 'transparent';
                el.style.color = '#8C8078';
            }
        });
        renderAnalyticsTab();
    };

    async function renderAnalyticsTab() {
        const container = document.getElementById('analyticsContent');
        container.innerHTML = '<div class="loading">Loading...</div>';
        const formatRp = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0);

        if (analyticsTab === 'buyers') {
            if (!analyticsCache.buyers) {
                const res = await apiCall('/admin/analytics/top-buyers');
                analyticsCache.buyers = (res && res.success) ? res.data : [];
            }
            const data = analyticsCache.buyers;
            if (data.length === 0) {
                container.innerHTML = '<div class="no-data">Belum ada data pembelian</div>';
                return;
            }
            let html = `<table><thead><tr>
                <th>No</th><th>Nama</th><th>WhatsApp</th><th>Total Beli</th><th>Total Belanja</th><th>Aksi</th>
            </tr></thead><tbody>`;
            data.forEach((row, i) => {
                html += `<tr>
                    <td>${i + 1}</td>
                    <td><strong>${row.nama_lengkap}</strong></td>
                    <td>${row.whatsapp}</td>
                    <td><span style="background:#B91C1C;color:#fff;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600;">${row.total_purchases}x</span></td>
                    <td style="font-weight:600;">${formatRp(row.total_spent)}</td>
                    <td><button class="btn-small" onclick="viewCustomer(${row.id})">Detail</button></td>
                </tr>`;
            });
            html += '</tbody></table>';
            container.innerHTML = html;

        } else if (analyticsTab === 'products') {
            if (!analyticsCache.products) {
                const res = await apiCall('/admin/analytics/top-products');
                analyticsCache.products = (res && res.success) ? res.data : [];
            }
            const data = analyticsCache.products;
            if (data.length === 0) {
                container.innerHTML = '<div class="no-data">Belum ada data produk</div>';
                return;
            }
            const maxSold = Math.max(...data.map(d => Number(d.total_sold)));
            let html = `<table><thead><tr>
                <th>No</th><th>Produk</th><th>Terjual</th><th>Total Revenue</th><th>Popularitas</th>
            </tr></thead><tbody>`;
            data.forEach((row, i) => {
                const pct = maxSold > 0 ? (Number(row.total_sold) / maxSold * 100) : 0;
                html += `<tr>
                    <td>${i + 1}</td>
                    <td><strong>${row.merk_unit || '-'}</strong> ${row.tipe_unit || ''}</td>
                    <td><span style="background:rgba(185,28,28,0.08);color:#B91C1C;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600;">${row.total_sold}x</span></td>
                    <td style="font-weight:500;">${formatRp(row.total_revenue)}</td>
                    <td style="width:150px;">
                        <div style="background:#F5F3F0;border-radius:6px;height:8px;overflow:hidden;">
                            <div style="background:linear-gradient(90deg,#B91C1C,#DC2626);height:100%;width:${pct}%;border-radius:6px;transition:width 0.4s;"></div>
                        </div>
                    </td>
                </tr>`;
            });
            html += '</tbody></table>';
            container.innerHTML = html;

        } else if (analyticsTab === 'brands') {
            if (!analyticsCache.brands) {
                const res = await apiCall('/admin/analytics/top-brands');
                analyticsCache.brands = (res && res.success) ? res.data : [];
            }
            const data = analyticsCache.brands;
            if (data.length === 0) {
                container.innerHTML = '<div class="no-data">Belum ada data merk</div>';
                return;
            }
            const totalAll = data.reduce((sum, d) => sum + Number(d.total_sold), 0);
            const colors = ['#B91C1C','#DC2626','#EF4444','#F87171','#FCA5A5','#FECACA','#FEE2E2','#D97706','#2563EB','#16A34A'];
            let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:20px;">`;
            data.forEach((row, i) => {
                const pct = totalAll > 0 ? (Number(row.total_sold) / totalAll * 100).toFixed(1) : 0;
                const color = colors[i % colors.length];
                html += `
                    <div style="background:#fff;border:1px solid #EDE8E3;border-radius:12px;padding:16px;transition:box-shadow 0.2s;" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.06)'" onmouseout="this.style.boxShadow='none'">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                            <span style="font-weight:600;font-size:15px;">${row.brand}</span>
                            <span style="background:${color};color:#fff;padding:3px 10px;border-radius:8px;font-size:12px;font-weight:600;">${row.total_sold}x</span>
                        </div>
                        <div style="font-size:13px;color:#5C534B;margin-bottom:8px;">
                            Revenue: <strong>${formatRp(row.total_revenue)}</strong>
                        </div>
                        <div style="background:#F5F3F0;border-radius:6px;height:8px;overflow:hidden;">
                            <div style="background:${color};height:100%;width:${pct}%;border-radius:6px;transition:width 0.4s;"></div>
                        </div>
                        <div style="font-size:11px;color:#8C8078;margin-top:4px;">${pct}% dari total penjualan</div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
        }
    }

    // ============================================
    // PIPELINE DETAIL MODAL
    // ============================================

    let pipelineMonthlyData = null;

    window.showPipelineDetail = async function(type) {
        const modal = document.getElementById('pipelineModal');
        const title = document.getElementById('pipelineModalTitle');
        const body = document.getElementById('pipelineModalBody');

        // Load monthly data if not cached
        if (!pipelineMonthlyData) {
            body.innerHTML = '<div class="loading">Loading...</div>';
            modal.classList.add('show');
            const resp = await apiCall('/admin/pipeline/monthly');
            if (resp && resp.success) {
                pipelineMonthlyData = resp.data;
            } else {
                body.innerHTML = '<div class="no-data">Gagal memuat data</div>';
                return;
            }
        }

        modal.classList.add('show');
        const months = pipelineMonthlyData;
        const formatRp = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0);

        if (type === 'success') {
            title.textContent = 'Detail Transaksi Sukses Per Bulan';
            let html = '<table style="width:100%;"><thead><tr><th>Bulan</th><th>Sukses</th><th>Total</th><th>Rate</th><th>Perubahan</th></tr></thead><tbody>';
            months.forEach((m, i) => {
                const prev = months[i + 1];
                const rate = Number(m.total) > 0 ? (Number(m.sukses) / Number(m.total) * 100).toFixed(1) : '0.0';
                let change = '-';
                if (prev) {
                    const diff = Number(m.sukses) - Number(prev.sukses);
                    if (diff > 0) change = `<span style="color:#16A34A;">▲ +${diff}</span>`;
                    else if (diff < 0) change = `<span style="color:#DC2626;">▼ ${diff}</span>`;
                    else change = `<span style="color:#8C8078;">—</span>`;
                }
                html += `<tr><td>${m.label}</td><td><strong>${m.sukses}</strong></td><td>${m.total}</td><td>${rate}%</td><td>${change}</td></tr>`;
            });
            html += '</tbody></table>';
            body.innerHTML = html;

        } else if (type === 'omzet') {
            title.textContent = 'Detail Omzet Per Bulan';
            let html = '<table style="width:100%;"><thead><tr><th>Bulan</th><th>Omzet</th><th>Transaksi</th><th>Perubahan</th></tr></thead><tbody>';
            months.forEach((m, i) => {
                const prev = months[i + 1];
                const omzet = Number(m.omzet) || 0;
                let change = '-';
                if (prev) {
                    const prevOmzet = Number(prev.omzet) || 0;
                    const diff = omzet - prevOmzet;
                    if (prevOmzet > 0) {
                        const pct = ((diff / prevOmzet) * 100).toFixed(1);
                        if (diff > 0) change = `<span style="color:#16A34A;">▲ +${pct}% (+${formatRp(diff)})</span>`;
                        else if (diff < 0) change = `<span style="color:#DC2626;">▼ ${pct}% (${formatRp(diff)})</span>`;
                        else change = `<span style="color:#8C8078;">—</span>`;
                    } else if (omzet > 0) {
                        change = `<span style="color:#16A34A;">▲ Baru</span>`;
                    }
                }
                html += `<tr><td>${m.label}</td><td><strong>${formatRp(omzet)}</strong></td><td>${m.sukses}</td><td>${change}</td></tr>`;
            });
            html += '</tbody></table>';
            body.innerHTML = html;
        }
    };

    window.closePipelineModal = function() {
        document.getElementById('pipelineModal').classList.remove('show');
    };

    // ============================================
    // GOOGLE CONTACTS INTEGRATION
    // ============================================

    async function checkGoogleStatus() {
        try {
            const resp = await fetch(`${API_URL}/google/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            const indicator = document.getElementById('googleIndicator');
            const statusText = document.getElementById('googleStatusText');
            const connectBtn = document.getElementById('googleConnectBtn');
            const disconnectBtn = document.getElementById('googleDisconnectBtn');

            if (data.connected) {
                indicator.style.background = '#16A34A';
                statusText.textContent = 'Terhubung — kontak customer otomatis tersimpan ke Google Contacts';
                statusText.style.color = '#16A34A';
                connectBtn.style.display = 'none';
                disconnectBtn.style.display = 'inline-block';
            } else {
                indicator.style.background = '#DC2626';
                statusText.textContent = 'Belum terhubung';
                statusText.style.color = '#DC2626';
                connectBtn.style.display = 'inline-block';
                disconnectBtn.style.display = 'none';
            }
        } catch (err) {
            console.warn('Google status check failed:', err);
            const indicator = document.getElementById('googleIndicator');
            const statusText = document.getElementById('googleStatusText');
            const connectBtn = document.getElementById('googleConnectBtn');
            if (indicator) indicator.style.background = '#ccc';
            if (statusText) {
                statusText.textContent = 'Tidak bisa cek status';
                statusText.style.color = '#5C534B';
            }
            if (connectBtn) connectBtn.style.display = 'inline-block';
        }
    }

    window.connectGoogle = function() {
        window.location.href = `${API_URL}/google/auth`;
    };

    window.disconnectGoogle = async function() {
        if (!confirm('Putuskan Google Contacts? Kontak baru tidak akan otomatis tersimpan.')) return;
        try {
            await fetch(`${API_URL}/google/disconnect`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            checkGoogleStatus();
        } catch (err) {
            alert('Gagal memutuskan: ' + err.message);
        }
    };

    // Check for Google OAuth redirect result
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('google') === 'connected') {
        alert('Google Contacts berhasil terhubung! Kontak customer baru akan otomatis tersimpan.');
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('google') === 'error') {
        alert('Gagal menghubungkan Google: ' + (urlParams.get('msg') || 'Unknown error'));
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkGoogleStatus();

    // ============================================
    // INITIAL LOAD
    // ============================================

    loadDashboard();
    loadCleanupBanner();
    checkWADisconnectBanner();
}

console.log('✅ Admin Panel initialized');
console.log('📡 API URL:', API_URL);