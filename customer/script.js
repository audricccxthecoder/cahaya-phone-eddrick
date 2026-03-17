// ============================================
// CUSTOMER FORM JAVASCRIPT
// ============================================

const API_URL = '/api';

// Form elements
const form = document.getElementById('customerForm');
const submitBtn = document.getElementById('submitBtn');
const alert = document.getElementById('alert');

// Show alert message
function showAlert(message, type = 'success') {
    alert.textContent = message;
    alert.className = `alert ${type} show`;
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        alert.classList.remove('show');
    }, 5000);
    
    // Scroll to alert
    alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Normalize phone number to WhatsApp format (628xxx)
 * Handles: "0812 3456 7890", "+62-812-3456-7890", "62812...", "812..."
 */
function formatWhatsApp(number) {
    // Remove all non-digit characters
    let num = String(number).replace(/\D/g, '');

    if (num.startsWith('62')) return num;
    if (num.startsWith('0'))  return '62' + num.slice(1);
    if (num.startsWith('8') && num.length >= 9) return '62' + num;
    return num;
}

function validateForm(formData) {
    if (!formData.nama_lengkap || !formData.whatsapp) {
        showAlert('Nama lengkap dan WhatsApp wajib diisi', 'error');
        return false;
    }

    const normalized = formatWhatsApp(formData.whatsapp);
    if (!normalized.startsWith('62') || normalized.length < 11 || normalized.length > 15) {
        showAlert('Nomor WhatsApp tidak valid. Contoh: 08123456789 atau +62812345678', 'error');
        return false;
    }

    return true;
}

// Handle form submit
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form data
    const formData = {
        nama_lengkap: document.getElementById('nama_lengkap').value.trim(),
        // Also send `nama` for backward compatibility with backend
        nama: document.getElementById('nama_lengkap').value.trim(),
        nama_sales: document.getElementById('nama_sales').value.trim(),
        merk_unit: document.getElementById('merk_unit').value,
        tipe_unit: document.getElementById('tipe_unit').value.trim(),
        harga: document.getElementById('harga').value,
        qty: document.getElementById('qty').value || 1,
        tanggal_lahir: document.getElementById('tanggal_lahir').value,
        alamat: document.getElementById('alamat').value.trim(),
        whatsapp: document.getElementById('whatsapp').value.trim(),
        metode_pembayaran: document.getElementById('metode_pembayaran').value,
        tahu_dari: document.getElementById('tahu_dari').value,
        opted_in: document.getElementById('opted_in').checked
    };
    
    // Validate
    if (!validateForm(formData)) {
        return;
    }
    
    // Format WhatsApp
    formData.whatsapp = formatWhatsApp(formData.whatsapp);
    
    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = 'Mengirim...';
    
    try {
        const response = await fetch(`${API_URL}/form-submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showAlert('✅ Data berhasil disimpan! Pesan WhatsApp akan segera dikirim.', 'success');
            
            // Reset form
            form.reset();
            
            // Optional: Show WhatsApp status
            if (result.whatsapp_sent) {
                setTimeout(() => {
                    showAlert('✅ Pesan WhatsApp berhasil dikirim!', 'success');
                }, 2000);
            }
        } else {
            showAlert('❌ ' + result.message, 'error');
        }
        
    } catch (error) {
        console.error('Submit error:', error);
        showAlert('❌ Tidak dapat terhubung ke server. Pastikan backend sudah berjalan.', 'error');
    } finally {
        // Enable button
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Pendaftaran';
    }
});

// Auto-format WhatsApp input — allow spaces/dashes while typing, normalize on blur
document.getElementById('whatsapp').addEventListener('blur', (e) => {
    const normalized = formatWhatsApp(e.target.value);
    if (normalized) e.target.value = normalized;
});

// Auto-format price input
document.getElementById('harga').addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    e.target.value = value;
});

console.log('✅ Customer Form initialized');
console.log('📡 API URL:', API_URL);