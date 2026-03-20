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
            } else if (targetPage === 'analytics') {
                loadAnalytics();
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
                const bulanNow = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

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

            // Load recent customers
            console.log('📊 Loading recent customers...');
            const customers = await apiCall('/admin/customers');

            if (customers && customers.success) {
                console.log(`✅ Loaded ${customers.data.length} customers`);
                displayRecentCustomers(customers.data.slice(0, 10));
            } else {
                document.getElementById('recentCustomers').innerHTML = '<div class="no-data">Belum ada customer</div>';
            }
        } catch (error) {
            console.error('❌ Load dashboard error:', error);
            document.getElementById('recentCustomers').innerHTML = '<div class="no-data">Gagal memuat data</div>';
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
        }
        html += `<th>Source</th><th>Status</th><th>Tanggal</th><th>Aksi</th>
            </tr></thead><tbody>`;

        pageData.forEach((customer, index) => {
            const date = new Date(customer.created_at).toLocaleDateString('id-ID');
            const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');

            const pCount = customer.purchase_count || 0;
            const repeatBadge = pCount > 1 ? ` <span style="background:#B91C1C;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;">${pCount}x</span>` : '';

            html += `<tr>
                <td>${start + index + 1}</td>
                <td>${customer.nama_lengkap}${repeatBadge}</td>
                <td>${customer.whatsapp}</td>`;

            if (isBelanja) {
                const produk = customer.merk_unit && customer.tipe_unit
                    ? `${customer.merk_unit} ${customer.tipe_unit}` : '-';
                const harga = customer.harga
                    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga) : '-';
                html += `<td>${customer.nama_sales || '-'}</td>
                    <td>${produk}</td>
                    <td>${harga}</td>
                    <td>${customer.metode_pembayaran || '-'}</td>`;
            }

            html += `<td><span class="badge ${sourceClass}">${customer.source}</span></td>
                <td><span class="badge ${statusClass}">${customer.status}</span></td>
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

        const date = new Date(customer.created_at).toLocaleString('id-ID');
        const harga = customer.harga ? formatRpDetail(customer.harga) : '-';
        const tanggalLahir = customer.tanggal_lahir ? new Date(customer.tanggal_lahir).toLocaleDateString('id-ID') : '-';
        const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
        const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');

        const purchases = customer.purchases || [];
        const purchaseCount = customer.purchase_count || 0;

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
                            <th style="text-align:left;padding:8px 6px;border-bottom:1px solid #EDE8E3;color:#8C8078;font-weight:500;">Metode</th>
                        </tr></thead>
                        <tbody>
                            ${purchases.map(p => `
                                <tr>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;">${new Date(p.created_at).toLocaleDateString('id-ID')}</td>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-weight:500;">${(p.merk_unit || '') + (p.tipe_unit ? ' ' + p.tipe_unit : '') || '-'}</td>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;text-align:right;">${p.harga ? formatRpDetail(p.harga) : '-'}</td>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;">${p.nama_sales || '-'}</td>
                                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;">${p.metode_pembayaran || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
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
                    <div class="detail-value">${customer.whatsapp}</div>
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
                    <div class="detail-label">Total Pembelian</div>
                    <div class="detail-value" style="font-weight:600;color:#B91C1C;">${purchaseCount}x transaksi</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Terdaftar</div>
                    <div class="detail-value">${date}</div>
                </div>
            </div>
            ${purchaseHtml}
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
            // Refresh customer list if loaded
            if (allCustomers.length > 0) loadCustomers();
        }
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
    // SYNC KONTAK
    // ============================================

    const SYNC_KEY = 'cahaya-sync-2026';
    let syncSelectedIds = new Set();
    let syncAllIds = [];

    // Set date picker to today
    const syncDatePicker = document.getElementById('syncDatePicker');
    if (syncDatePicker) {
        syncDatePicker.value = new Date().toISOString().slice(0, 10);
    }

    window.syncAll = function() {
        window.location.href = `${API_URL}/sync/contacts?key=${SYNC_KEY}`;
    };

    window.syncToday = function() {
        const today = new Date().toISOString().slice(0, 10);
        window.location.href = `${API_URL}/sync/contacts?key=${SYNC_KEY}&since=${today}`;
    };

    window.loadSyncByDate = async function() {
        const date = document.getElementById('syncDatePicker').value;
        if (!date) return;

        const container = document.getElementById('syncCustomerList');
        container.innerHTML = '<p class="muted" style="text-align:center;padding:20px;">Memuat...</p>';
        syncSelectedIds.clear();
        syncAllIds = [];

        try {
            const data = await apiCall(`/sync/list?key=${SYNC_KEY}&date=${date}`);

            if (!data || !data.success || data.customers.length === 0) {
                container.innerHTML = '<p class="muted" style="text-align:center;padding:20px;">Tidak ada customer di tanggal ini</p>';
                return;
            }

            syncAllIds = data.customers.map(c => c.id);

            let html = `
                <div class="sync-count">${data.count} customer ditemukan</div>
                <label class="sync-select-all">
                    <input type="checkbox" id="syncSelectAll" onchange="syncToggleAll(this.checked)">
                    Pilih Semua
                </label>
            `;

            data.customers.forEach(c => {
                const time = new Date(c.created_at).toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
                const produk = c.merk_unit && c.tipe_unit ? `${c.merk_unit} ${c.tipe_unit}` : '';
                const phone = formatSyncPhone(c.whatsapp);
                html += `
                    <div class="sync-item" id="sync-${c.id}" onclick="syncToggle(${c.id})">
                        <div class="sync-check">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </div>
                        <div class="sync-info">
                            <div class="sync-name">${c.nama_lengkap}</div>
                            <div class="sync-detail">${produk ? produk + ' &middot; ' : ''}${time}</div>
                        </div>
                        <div class="sync-phone">${phone}</div>
                    </div>
                `;
            });

            html += `
                <div class="sync-actions">
                    <button class="btn-primary" style="width:auto;font-size:12px;padding:10px 16px;" onclick="syncDownloadSelected()" id="syncDlSelectedBtn" disabled>
                        Download Terpilih (0)
                    </button>
                    <button class="btn-small" style="padding:10px 14px;" onclick="syncDownloadDate('${date}')">
                        Download Semua (${data.count})
                    </button>
                </div>
            `;

            container.innerHTML = html;

        } catch (e) {
            container.innerHTML = '<p class="muted" style="text-align:center;padding:20px;">Gagal memuat data</p>';
        }
    };

    window.syncToggle = function(id) {
        const el = document.getElementById(`sync-${id}`);
        if (syncSelectedIds.has(id)) {
            syncSelectedIds.delete(id);
            el.classList.remove('selected');
        } else {
            syncSelectedIds.add(id);
            el.classList.add('selected');
        }
        syncUpdateUI();
    };

    window.syncToggleAll = function(checked) {
        syncAllIds.forEach(id => {
            const el = document.getElementById(`sync-${id}`);
            if (checked) {
                syncSelectedIds.add(id);
                el.classList.add('selected');
            } else {
                syncSelectedIds.delete(id);
                el.classList.remove('selected');
            }
        });
        syncUpdateUI();
    };

    function syncUpdateUI() {
        const btn = document.getElementById('syncDlSelectedBtn');
        if (btn) {
            btn.disabled = syncSelectedIds.size === 0;
            btn.textContent = `Download Terpilih (${syncSelectedIds.size})`;
        }
        const sa = document.getElementById('syncSelectAll');
        if (sa) sa.checked = syncSelectedIds.size === syncAllIds.length && syncAllIds.length > 0;
    }

    window.syncDownloadSelected = async function() {
        if (syncSelectedIds.size === 0) return;
        try {
            const res = await fetch(`${API_URL}/sync/contacts/selected`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ key: SYNC_KEY, ids: Array.from(syncSelectedIds) })
            });
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'cp_contacts_selected.vcf';
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('Gagal download: ' + e.message);
        }
    };

    window.syncDownloadDate = function(date) {
        window.location.href = `${API_URL}/sync/contacts?key=${SYNC_KEY}&since=${date}`;
    };

    function formatSyncPhone(phone) {
        const p = String(phone);
        if (p.startsWith('62') && p.length > 6) {
            return '+62 ' + p.slice(2, 5) + ' ' + p.slice(5, 9) + ' ' + p.slice(9);
        }
        return p;
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
            modal.classList.add('active');
            const resp = await apiCall('/admin/pipeline/monthly');
            if (resp && resp.success) {
                pipelineMonthlyData = resp.data;
            } else {
                body.innerHTML = '<div class="no-data">Gagal memuat data</div>';
                return;
            }
        }

        modal.classList.add('active');
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
        document.getElementById('pipelineModal').classList.remove('active');
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
}

console.log('✅ Admin Panel initialized');
console.log('📡 API URL:', API_URL);