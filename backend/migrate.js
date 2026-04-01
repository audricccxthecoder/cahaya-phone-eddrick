const { Client } = require('pg');
require('dotenv').config();

async function migrate() {
  console.log('🚀 Starting database migration (PostgreSQL)...');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Buat tabel admins
    console.log('Creating table: admins...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nama VARCHAR(100) NOT NULL,
        email VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table admins created/verified');

    // Buat tabel admin_reset_tokens
    console.log('Creating table: admin_reset_tokens...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_reset_tokens (
        id SERIAL PRIMARY KEY,
        admin_id INT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        token VARCHAR(128) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table admin_reset_tokens created/verified');

    // Buat tabel customers
    console.log('Creating table: customers...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        nama_lengkap VARCHAR(100) NOT NULL,
        nama_sales VARCHAR(100),
        merk_unit VARCHAR(100),
        tipe_unit VARCHAR(100),
        harga NUMERIC(15,2),
        qty INT DEFAULT 1,
        tanggal_lahir DATE,
        alamat TEXT,
        whatsapp VARCHAR(20) NOT NULL,
        metode_pembayaran VARCHAR(50),
        tahu_dari VARCHAR(50),
        source VARCHAR(20) NOT NULL DEFAULT 'Unknown',
        status VARCHAR(20) DEFAULT 'New',
        opted_in BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp ON customers (whatsapp)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_source ON customers (source)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_status ON customers (status)`);
    console.log('✅ Table customers created/verified');

    // Buat tabel messages
    console.log('Creating table: messages...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        direction VARCHAR(3) CHECK (direction IN ('in', 'out')) NOT NULL,
        message TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_msg_customer ON messages (customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_msg_direction ON messages (direction)`);
    console.log('✅ Table messages created/verified');

    // Buat tabel purchases (riwayat pembelian)
    console.log('Creating table: purchases...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        merk_unit VARCHAR(100),
        tipe_unit VARCHAR(100),
        harga NUMERIC(15,2),
        qty INT DEFAULT 1,
        nama_sales VARCHAR(100),
        metode_pembayaran VARCHAR(50),
        source VARCHAR(20) DEFAULT 'Website',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_purchases_customer ON purchases (customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_purchases_merk ON purchases (merk_unit)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases (created_at)`);
    console.log('✅ Table purchases created/verified');

    // Buat tabel invoices (nota digital)
    console.log('Creating table: invoices...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        token VARCHAR(64) UNIQUE NOT NULL,
        customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        purchase_id INT REFERENCES purchases(id) ON DELETE SET NULL,
        items JSONB NOT NULL DEFAULT '[]',
        subtotal NUMERIC(15,2) DEFAULT 0,
        diskon NUMERIC(15,2) DEFAULT 0,
        total NUMERIC(15,2) DEFAULT 0,
        metode_pembayaran VARCHAR(50),
        catatan TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_token ON invoices (token)`);
    console.log('✅ Table invoices created/verified');

    // ============================================
    // CLEANUP: Hapus duplikat & nomor WA internal tidak valid
    // ============================================
    console.log('Cleaning up invalid & duplicate customers...');

    // Hapus customer dengan nomor WA internal (bukan nomor Indonesia valid)
    // Nomor valid Indonesia: 62xxx, panjang 11-15 digit
    const { rows: invalidRows } = await client.query(`
      DELETE FROM customers
      WHERE whatsapp !~ '^62[0-9]{9,13}$'
        AND tipe = 'Chat Only'
      RETURNING id, nama_lengkap, whatsapp
    `);
    if (invalidRows.length > 0) {
      console.log(`  Removed ${invalidRows.length} Chat Only records with invalid phone numbers`);
      invalidRows.forEach(r => console.log(`    - #${r.id} ${r.nama_lengkap} (${r.whatsapp})`));
    }

    // Hapus duplikat: keep record terlama (atau yang tipe='Belanja'), hapus sisanya
    const { rows: dupRows } = await client.query(`
      DELETE FROM customers
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY whatsapp
              ORDER BY
                CASE WHEN tipe = 'Belanja' THEN 0 ELSE 1 END,
                created_at ASC
            ) as rn
          FROM customers
        ) ranked
        WHERE rn > 1
      )
      RETURNING id, nama_lengkap, whatsapp
    `);
    if (dupRows.length > 0) {
      console.log(`  Removed ${dupRows.length} duplicate records (kept oldest/Belanja)`);
      dupRows.forEach(r => console.log(`    - #${r.id} ${r.nama_lengkap} (${r.whatsapp})`));
    }

    // Tambah UNIQUE constraint pada kolom whatsapp (cegah duplikat di masa depan)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_customers_whatsapp'
        ) THEN
          ALTER TABLE customers ADD CONSTRAINT uq_customers_whatsapp UNIQUE (whatsapp);
        END IF;
      END $$
    `);
    console.log('✅ Unique constraint on whatsapp verified');

    // Ensure opted_in column exists and backfill NULLs
    console.log('Ensuring opted_in column...');
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS opted_in BOOLEAN DEFAULT TRUE`);
    await client.query(`UPDATE customers SET opted_in = TRUE WHERE opted_in IS NULL`);

    // Ensure tipe column exists (Belanja / Chat Only)
    console.log('Ensuring tipe column...');
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS tipe VARCHAR(20) DEFAULT 'Belanja'`);
    await client.query(`UPDATE customers SET tipe = 'Belanja' WHERE tipe IS NULL`);
    console.log('✅ opted_in column verified');

    // Ensure catatan column exists (notes for Chat Only customers)
    console.log('Ensuring catatan column...');
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS catatan TEXT`);

    // Ensure wa_sent column exists (WhatsApp delivery status)
    console.log('Ensuring wa_sent column...');
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS wa_sent BOOLEAN DEFAULT NULL`);

    // Migrate old status values to new system
    console.log('Migrating status values...');
    await client.query(`UPDATE customers SET status = 'Contacted' WHERE status = 'Existing'`);
    await client.query(`UPDATE customers SET status = 'Inactive' WHERE status = 'Old'`);
    await client.query(`UPDATE customers SET status = 'New' WHERE status NOT IN ('New','Contacted','Follow Up','Completed','Inactive')`);
    console.log('✅ Status values migrated');

    // Broadcast tables (DB-backed queue for serverless)
    console.log('Creating table: broadcast_jobs...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS broadcast_jobs (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        source_filter VARCHAR(50),
        status VARCHAR(20) DEFAULT 'running',
        total INT DEFAULT 0,
        sent INT DEFAULT 0,
        failed INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table broadcast_jobs created/verified');

    console.log('Creating table: broadcast_recipients...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS broadcast_recipients (
        id SERIAL PRIMARY KEY,
        job_id INT NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
        customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        status VARCHAR(20) DEFAULT 'pending',
        error TEXT,
        sent_at TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_br_job ON broadcast_recipients (job_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_br_status ON broadcast_recipients (job_id, status)`);
    console.log('✅ Table broadcast_recipients created/verified');

    // Birthday greetings log
    console.log('Creating table: birthday_greetings...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS birthday_greetings (
        id SERIAL PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        greeting_year INT NOT NULL,
        message TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        error TEXT,
        sent_at TIMESTAMP,
        UNIQUE(customer_id, greeting_year)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bg_customer ON birthday_greetings (customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bg_year ON birthday_greetings (greeting_year)`);
    console.log('✅ Table birthday_greetings created/verified');

    // App settings (key-value store for birthday message, etc.)
    console.log('Creating table: app_settings...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table app_settings created/verified');

    // Buat view statistik
    console.log('Creating view: customer_stats...');
    await client.query(`DROP VIEW IF EXISTS customer_stats`);
    await client.query(`
      CREATE VIEW customer_stats AS
      SELECT
        COUNT(*) as total_customers,
        SUM(CASE WHEN source = 'Website' THEN 1 ELSE 0 END) as from_website,
        SUM(CASE WHEN source = 'Instagram' THEN 1 ELSE 0 END) as from_instagram,
        SUM(CASE WHEN source = 'Facebook' THEN 1 ELSE 0 END) as from_facebook,
        SUM(CASE WHEN source = 'TikTok' THEN 1 ELSE 0 END) as from_tiktok,
        SUM(CASE WHEN source LIKE '%Teman%' OR source LIKE '%Keluarga%' THEN 1 ELSE 0 END) as from_friends,
        SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) as new_customers,
        SUM(CASE WHEN status = 'Contacted' THEN 1 ELSE 0 END) as contacted_customers,
        SUM(CASE WHEN status = 'Follow Up' THEN 1 ELSE 0 END) as followup_customers,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed_customers,
        SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END) as inactive_customers,
        SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as today_customers,
        SUM(CASE WHEN source NOT IN ('Website','Instagram','Facebook','TikTok','Teman/Keluarga') THEN 1 ELSE 0 END) as from_others
      FROM customers
    `);
    console.log('✅ View customer_stats created/verified');

    // Buat default admin jika belum ada, atau update existing
    const { rows: adminRows } = await client.query('SELECT COUNT(*) as count FROM admins');
    if (parseInt(adminRows[0].count) === 0) {
      console.log('Creating default admin...');
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);

      await client.query(
        'INSERT INTO admins (username, password, nama, email) VALUES ($1, $2, $3, $4)',
        ['superadmin', hashedPassword, 'Cahaya Phone Superadmin', 'admin@localhost']
      );
      console.log('✅ Default admin created');
      console.log('   Username: superadmin');
      console.log('   Password: admin123');
    } else {
      // Update existing admin username & nama to latest
      await client.query(
        `UPDATE admins SET username = 'superadmin', nama = 'Cahaya Phone Superadmin' WHERE id = (SELECT id FROM admins ORDER BY id LIMIT 1)`
      );
      console.log('✅ Admin updated: superadmin / Cahaya Phone Superadmin');
    }

    // Tampilkan ringkasan
    const { rows: cc } = await client.query('SELECT COUNT(*) as count FROM customers');
    const { rows: ac } = await client.query('SELECT COUNT(*) as count FROM admins');
    const { rows: mc } = await client.query('SELECT COUNT(*) as count FROM messages');
    const { rows: pc } = await client.query('SELECT COUNT(*) as count FROM purchases');
    const { rows: ic } = await client.query('SELECT COUNT(*) as count FROM invoices');

    console.log('\n📊 Database Summary:');
    console.log(`   Customers: ${cc[0].count}`);
    console.log(`   Admins: ${ac[0].count}`);
    console.log(`   Messages: ${mc[0].count}`);
    console.log(`   Purchases: ${pc[0].count}`);
    console.log(`   Invoices: ${ic[0].count}`);
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

migrate()
  .then(() => {
    console.log('✅ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
