const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Active Shift Global State
let activeShiftState = {
    shift_name: 'Shift 01',
    shift_leader: 'Mr. Mangala'
};

// Live TV Broadcast Announcement Ticker
let activeBroadcast = {
    message: '',
    type: 'info'
};

const db = new sqlite3.Database('./qc_database.db', (err) => {
    if (err) console.error('Database Connection Error:', err);
    else console.log('Connected to SQLite Database.');
});

db.serialize(() => {
    // QC Records Table
    db.run(`CREATE TABLE IF NOT EXISTS qc_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant_name TEXT,
        machine_name TEXT,
        product_name TEXT,
        batch_number TEXT,
        bag_size TEXT,
        packing_size TEXT,
        product_colour TEXT,
        weight_grams REAL,
        qc_inspector TEXT,
        shift_name TEXT,
        shift_leader TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`ALTER TABLE qc_records ADD COLUMN shift_name TEXT`, () => {});
    db.run(`ALTER TABLE qc_records ADD COLUMN shift_leader TEXT`, () => {});

    // System Settings Table (Stores Encrypted/Config Passwords)
    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT
    )`);

    // Insert Default Passwords if not exists
    db.run(`INSERT OR IGNORE INTO system_settings (setting_key, setting_value) VALUES 
        ('input_password', '1234'),
        ('reports_password', '1234'),
        ('admin_password', 'admin123')`);
});

// Page Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/input', (req, res) => res.sendFile(path.join(__dirname, 'public', 'input.html')));
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reports.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// API: Verify Password
app.post('/api/verify-password', (req, res) => {
    const { module_name, password } = req.body;
    const keyMap = {
        'input': 'input_password',
        'reports': 'reports_password',
        'admin': 'admin_password'
    };
    const key = keyMap[module_name];
    if (!key) return res.status(400).json({ success: false, error: 'Invalid module' });

    db.get(`SELECT setting_value FROM system_settings WHERE setting_key = ?`, [key], (err, row) => {
        if (err || !row) return res.status(500).json({ success: false, error: 'Database error' });
        if (row.setting_value === password) {
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'Incorrect Password!' });
        }
    });
});

// API: Change Password
app.post('/api/change-password', (req, res) => {
    const { target_module, new_password } = req.body;
    const keyMap = {
        'input': 'input_password',
        'reports': 'reports_password',
        'admin': 'admin_password'
    };
    const key = keyMap[target_module];
    if (!key || !new_password) return res.status(400).json({ success: false, error: 'Invalid request' });

    db.run(`UPDATE system_settings SET setting_value = ? WHERE setting_key = ?`, [new_password, key], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// API: Shift Update & Get
app.post('/api/update-shift', (req, res) => {
    const { shift_name, shift_leader } = req.body;
    if (shift_name) activeShiftState.shift_name = shift_name;
    if (shift_leader) activeShiftState.shift_leader = shift_leader;
    res.json({ success: true, currentShift: activeShiftState });
});

app.get('/api/active-shift', (req, res) => {
    res.json(activeShiftState);
});

// API: TV Broadcast Ticker
app.post('/api/broadcast', (req, res) => {
    const { message, type } = req.body;
    activeBroadcast.message = message || '';
    activeBroadcast.type = type || 'info';
    res.json({ success: true, broadcast: activeBroadcast });
});

app.get('/api/broadcast', (req, res) => {
    res.json(activeBroadcast);
});

// API: Save QC Records
app.post('/api/save-qc', (req, res) => {
    const records = req.body;
    const stmt = db.prepare(`INSERT INTO qc_records 
        (plant_name, machine_name, product_name, batch_number, bag_size, packing_size, product_colour, weight_grams, qc_inspector, shift_name, shift_leader) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    records.forEach(r => {
        stmt.run([
            r.plant || 'Plant 1', 
            r.machine, 
            r.product, 
            r.batch, 
            r.bag_size, 
            r.packing_size, 
            r.colour, 
            r.weight, 
            r.inspector,
            r.shift_name || activeShiftState.shift_name,
            r.shift_leader || activeShiftState.shift_leader
        ]);
    });

    stmt.finalize((err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// API: Latest Machine Records for TV
app.get('/api/latest-per-machine', (req, res) => {
    const { plant } = req.query;
    let query = `
        SELECT * FROM qc_records 
        WHERE id IN (SELECT MAX(id) FROM qc_records GROUP BY machine_name)
    `;
    let params = [];

    if (plant && plant !== 'all') {
        query += ` AND LOWER(plant_name) = LOWER(?)`;
        params.push(plant);
    }

    query += ` ORDER BY plant_name ASC, machine_name ASC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: History Records for Reports
app.get('/api/qc-history', (req, res) => {
    db.all(`SELECT * FROM qc_records ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`QC System Server running on http://localhost:${PORT}`);
});