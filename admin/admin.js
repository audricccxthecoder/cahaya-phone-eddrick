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
//             const time = new Date(msg.sent_at).toLocaleString('id-ID');
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

    // Display admin name (click to edit)
    function renderAdminName() {
        document.getElementById('adminName').textContent = `Hello, ${admin.nama || 'Admin'}`;
    }

    renderAdminName();
    console.log('👤 Admin:', admin.nama || 'Admin');

    // Edit admin name button -> open profile modal
    const editBtn = document.getElementById('editAdminNameBtn');
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Populate form (display name + username)
            document.getElementById('adminDisplayName').value = admin.nama || '';
            document.getElementById('adminUsername').value = admin.username || '';
            document.getElementById('adminCurrentPassword').value = '';
            document.getElementById('adminNewPassword').value = '';

            document.getElementById('adminProfileModal').classList.add('show');
        });
    }

    window.closeAdminModal = function() {
        document.getElementById('adminProfileModal').classList.remove('show');
    };

    // Handle profile form submit (name-only OR credentials)
    document.getElementById('adminProfileForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const displayName = document.getElementById('adminDisplayName').value.trim();
        const username = document.getElementById('adminUsername').value.trim();
        const currentPassword = document.getElementById('adminCurrentPassword').value;
        const newPassword = document.getElementById('adminNewPassword').value;
        const alertEl = document.getElementById('adminProfileAlert');

        alertEl.className = 'alert';

        // If username or newPassword present, require currentPassword
        const wantsCredsChange = (username && username !== (admin.username || '')) || newPassword;

        if (wantsCredsChange && !currentPassword) {
            alertEl.textContent = 'Current password is required to change username or password.';
            alertEl.classList.add('error','show');
            return;
        }

        // No changes
        if (!wantsCredsChange && (displayName === (admin.nama || ''))) {
            alertEl.textContent = 'No changes detected.';
            alertEl.classList.add('info','show');
            setTimeout(() => { alertEl.classList.remove('show'); }, 1200);
            return;
        }

        // If only name changed, call /admin/profile
        if (!wantsCredsChange) {
            if (!displayName) {
                alertEl.textContent = 'Display name cannot be empty.';
                alertEl.classList.add('error','show');
                return;
            }

            const res = await apiCall('/admin/profile', {
                method: 'PATCH',
                body: JSON.stringify({ nama: displayName })
            });

            if (res && res.success) {
                admin.nama = res.data.nama || admin.nama;
                localStorage.setItem('admin', JSON.stringify(admin));
                renderAdminName();

                alertEl.textContent = 'Display name updated.';
                alertEl.classList.add('success','show');
                setTimeout(() => {
                    document.getElementById('adminProfileModal').classList.remove('show');
                    alertEl.classList.remove('show');
                }, 1200);
            } else {
                const msg = (res && res.message) ? res.message : 'Failed to update display name.';
                alertEl.textContent = msg;
                alertEl.classList.add('error','show');
            }

            return;
        }

        // Otherwise, change credentials via /admin/credentials
        const payload = { current_password: currentPassword };
        if (username && username !== (admin.username || '')) payload.new_username = username;
        if (newPassword) payload.new_password = newPassword;
        if (displayName) payload.nama = displayName;

        const res2 = await apiCall('/admin/credentials', {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });

        if (res2 && res2.success) {
            // Update token if provided
            if (res2.token) {
                localStorage.setItem('token', res2.token);
            }
            if (res2.data) {
                admin.nama = res2.data.nama || admin.nama;
                admin.username = res2.data.username || admin.username;
                localStorage.setItem('admin', JSON.stringify(admin));
                renderAdminName();
            }

            alertEl.textContent = 'Credentials updated successfully.';
            alertEl.classList.add('success','show');
            setTimeout(() => {
                document.getElementById('adminProfileModal').classList.remove('show');
                alertEl.classList.remove('show');
            }, 1200);
        } else {
            const msg = (res2 && res2.message) ? res2.message : 'Failed to update credentials.';
            alertEl.textContent = msg;
            alertEl.classList.add('error','show');
        }
    });

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
            } else if (targetPage === 'messages') {
                loadMessages();
            }
        });
    });

    // ============================================
    // API CALLS
    // ============================================

    async function apiCall(endpoint, options = {}) {
        try {
            console.log(`📡 API Call: ${endpoint}`);
            const response = await fetch(`${API_URL}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    ...options.headers
                }
            });

            console.log(`📨 Response status: ${response.status}`);

            if (response.status === 401) {
                console.warn('⚠️ Unauthorized, logging out...');
                logout();
                return null;
            }

            const result = await response.json();
            console.log(`✅ API Response:`, result);
            return result;
        } catch (error) {
            console.error('❌ API call error:', error);
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
            } else {
                console.warn('⚠️ Failed to load stats');
            }

            // Load recent customers
            console.log('📊 Loading recent customers...');
            const customers = await apiCall('/admin/customers');
            
            if (customers && customers.success) {
                console.log(`✅ Loaded ${customers.data.length} customers`);
                displayRecentCustomers(customers.data.slice(0, 5));
            } else {
                console.warn('⚠️ Failed to load customers');
            }
        } catch (error) {
            console.error('❌ Load dashboard error:', error);
        }
    }

    function displayRecentCustomers(customers) {
        const container = document.getElementById('recentCustomers');
        
        if (customers.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada customer</div>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Nama</th>
                        <th>WhatsApp</th>
                        <th>Sales</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Tanggal</th>
                    </tr>
                </thead>
                <tbody>
        `;

        customers.forEach(customer => {
            const date = new Date(customer.created_at).toLocaleDateString('id-ID');
            const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            
            html += `
                <tr>
                    <td>${customer.nama_lengkap}</td>
                    <td>${customer.whatsapp}</td>
                    <td>${customer.nama_sales || '-'}</td>
                    <td><span class="badge ${sourceClass}">${customer.source}</span></td>
                    <td><span class="badge ${statusClass}">${customer.status}</span></td>
                    <td>${date}</td>
                </tr>
            `;
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

        console.log('📋 Loading all customers...');
        const result = await apiCall('/admin/customers');
        
        if (result && result.success) {
            console.log(`✅ Loaded ${result.data.length} customers`);
            allCustomers = result.data;
            displayCustomers(allCustomers);
        } else {
            console.error('❌ Failed to load customers');
            container.innerHTML = '<div class="no-data">Gagal memuat data. Pastikan backend jalan!</div>';
        }
    }

    function displayCustomers(customers) {
        const container = document.getElementById('customersTable');
        
        if (customers.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada customer</div>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>No</th>
                        <th>Nama</th>
                        <th>WhatsApp</th>
                        <th>Sales</th>
                        <th>Produk</th>
                        <th>Harga</th>
                        <th>Metode</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Tanggal</th>
                        <th>Aksi</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const validStatuses = ['New', 'Contacted', 'Follow Up', 'Completed', 'Inactive'];

        customers.forEach((customer, index) => {
            const date = new Date(customer.created_at).toLocaleDateString('id-ID');
            const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            const produk = customer.merk_unit && customer.tipe_unit
                ? `${customer.merk_unit} ${customer.tipe_unit}`
                : '-';
            const harga = customer.harga
                ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga)
                : '-';

            const statusOptions = validStatuses.map(s => {
                const selected = customer.status === s ? 'selected' : '';
                return `<option value="${s}" ${selected}>${s}</option>`;
            }).join('');

            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${customer.nama_lengkap}</td>
                    <td>${customer.whatsapp}</td>
                    <td>${customer.nama_sales || '-'}</td>
                    <td>${produk}</td>
                    <td>${harga}</td>
                    <td>${customer.metode_pembayaran || '-'}</td>
                    <td><span class="badge ${sourceClass}">${customer.source}</span></td>
                    <td>
                        <select class="status-select ${statusClass}" onchange="updateStatus(${customer.id}, this.value, this)">
                            ${statusOptions}
                        </select>
                    </td>
                    <td>${date}</td>
                    <td>
                        <div class="table-actions">
                            <button class="btn-small" onclick="viewCustomer(${customer.id})">Detail</button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // Combined filter function
    function applyFilters() {
        const search = document.getElementById('searchCustomer').value.toLowerCase().trim();
        const source = document.getElementById('filterSource').value;
        const status = document.getElementById('filterStatus').value;
        const dateFrom = document.getElementById('filterDateFrom').value;
        const dateTo = document.getElementById('filterDateTo').value;

        let filtered = allCustomers;
        if (search) filtered = filtered.filter(c => c.nama_lengkap.toLowerCase().includes(search));
        if (source) filtered = filtered.filter(c => c.source === source);
        if (status) filtered = filtered.filter(c => c.status === status);
        if (dateFrom) filtered = filtered.filter(c => new Date(c.created_at) >= new Date(dateFrom));
        if (dateTo) {
            const to = new Date(dateTo);
            to.setDate(to.getDate() + 1);
            filtered = filtered.filter(c => new Date(c.created_at) < to);
        }
        displayCustomers(filtered);
    }

    document.getElementById('searchCustomer').addEventListener('input', applyFilters);
    document.getElementById('filterSource').addEventListener('change', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('filterDateFrom').addEventListener('change', applyFilters);
    document.getElementById('filterDateTo').addEventListener('change', applyFilters);

    // Update customer status
    window.updateStatus = async function(customerId, newStatus, selectEl) {
        const result = await apiCall(`/admin/customers/${customerId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        if (result && result.success) {
            // Update local cache
            const cust = allCustomers.find(c => c.id === customerId);
            if (cust) cust.status = newStatus;
            // Update select styling
            const statusClass = newStatus.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            selectEl.className = 'status-select ' + statusClass;
        } else {
            alert('Gagal update status: ' + (result?.message || 'Unknown error'));
            // Revert select
            const cust = allCustomers.find(c => c.id === customerId);
            if (cust) selectEl.value = cust.status;
        }
    };

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
        
        const date = new Date(customer.created_at).toLocaleString('id-ID');
        const harga = customer.harga 
            ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga)
            : '-';
        const tanggalLahir = customer.tanggal_lahir ? new Date(customer.tanggal_lahir).toLocaleDateString('id-ID') : '-';
        const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
        const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
        
        detail.innerHTML = `
            <div class="detail-group">
                <div class="detail-label">Nama Lengkap</div>
                <div class="detail-value">${customer.nama_lengkap}</div>
            </div>
            <div class="detail-group">
                <div class="detail-label">WhatsApp</div>
                <div class="detail-value">${customer.whatsapp}</div>
            </div>
            <div class="detail-group">
                <div class="detail-label">Nama Sales</div>
                <div class="detail-value">${customer.nama_sales || '-'}</div>
            </div>
            <div class="detail-group">
                <div class="detail-label">Merk</div>
                <div class="detail-value">${customer.merk_unit || '-'}</div>
            </div>
            <div class="detail-group">
                <div class="detail-label">Tipe</div>
                <div class="detail-value">${customer.tipe_unit || '-'}</div>
            </div>
            <div class="detail-group">
                <div class="detail-label">Produk</div>
                <div class="detail-value">${(customer.merk_unit || '') + (customer.tipe_unit ? ' ' + customer.tipe_unit : '') || '-'}</div>
            </div>
            <div class="detail-group">
                <div class="detail-label">Harga</div>
                <div class="detail-value">${harga}</div>
            </div>
            <div class="detail-group">
                <div class="detail-label">Qty</div>
                <div class="detail-value">${customer.qty || '-'}</div>
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
                <div class="detail-label">Metode Pembayaran</div>
                <div class="detail-value">${customer.metode_pembayaran || '-'}</div>
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
                <div class="detail-label">Tanggal Daftar</div>
                <div class="detail-value">${date}</div>
            </div>
        `;
        
        modal.classList.add('show');
    }

    window.closeModal = function() {
        document.getElementById('customerModal').classList.remove('show');
    };

    // Close modal on backdrop click
    document.getElementById('customerModal').addEventListener('click', (e) => {
        if (e.target.id === 'customerModal') {
            closeModal();
        }
    });

    // ============================================
    // MESSAGES PAGE
    // ============================================

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
            const time = new Date(msg.sent_at).toLocaleString('id-ID');
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
            const today = new Date().toISOString().slice(0, 10);
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
            const today = new Date().toISOString().slice(0, 10);
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
    // BROADCAST
    // ============================================

    const broadcastStartBtn = document.getElementById('broadcastStartBtn');
    const broadcastPauseBtn = document.getElementById('broadcastPauseBtn');
    const broadcastResumeBtn = document.getElementById('broadcastResumeBtn');
    const broadcastStopBtn  = document.getElementById('broadcastStopBtn');
    const broadcastStatusEl = document.getElementById('broadcastStatus');

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

        broadcastStatusEl.innerHTML = `
            <div style="margin-bottom:12px;">
                <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
                    <span><strong>Status:</strong> ${status.running ? (status.paused ? '⏸ Dijeda' : '▶ Berjalan') : '⏹ Selesai/Berhenti'}</span>
                    <span><strong>Total:</strong> ${status.total}</span>
                    <span><strong>Terkirim:</strong> <span style="color:green">${status.sent}</span></span>
                    <span><strong>Gagal:</strong> <span style="color:red">${status.failed}</span></span>
                    <span><strong>Antrian:</strong> ${status.queued}</span>
                </div>
                <div style="background:#eee;border-radius:4px;height:8px;">
                    <div style="background:#27ae60;width:${progressPct}%;height:8px;border-radius:4px;transition:width 0.3s;"></div>
                </div>
                <small class="muted">${progressPct}% selesai</small>
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

        while (broadcastProcessing) {
            const res = await apiCall('/admin/broadcast/process', { method: 'POST', body: '{}' });
            if (!res || !res.success) {
                broadcastProcessing = false;
                break;
            }
            renderBroadcastStatus(res.status);

            // Stop loop if broadcast is done or paused
            if (!res.status.running || res.status.paused) {
                broadcastProcessing = false;
                break;
            }

            // Small delay before next batch to avoid hammering the API
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    broadcastStartBtn.addEventListener('click', async () => {
        const message = document.getElementById('broadcastMessage').value.trim();
        const source = document.getElementById('broadcastSource').value;
        if (!message) {
            alert('Pesan broadcast tidak boleh kosong!');
            return;
        }
        if (!confirm(`Yakin mau kirim broadcast ke semua customer opted-in${source ? ' dari ' + source : ''}?\n\nPesan:\n${message}`)) return;

        broadcastStartBtn.disabled = true;
        broadcastStartBtn.textContent = 'Memulai...';

        const body = { message };
        if (source) body.source_filter = source;

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
    // INITIAL LOAD
    // ============================================

    loadDashboard();
}

console.log('✅ Admin Panel initialized');
console.log('📡 API URL:', API_URL);