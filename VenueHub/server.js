require('dotenv').config();
const express = require('express');
const oracledb = require('oracledb');
const path = require('path');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VENUE_SQL = `
    SELECT id AS "id",
           name AS "name",
           category AS "category",
           capacity AS "capacity",
           price_per_hour AS "pricePerHour",
           location AS "location",
           image AS "image"
    FROM venues`;

const BOOKING_SQL = `
    SELECT b.id AS "id",
           b.venue_id AS "venueId",
           v.name AS "venueName",
           b.applicant_name AS "applicantName",
           b.applicant_email AS "applicantEmail",
           b.event_title AS "eventTitle",
           TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS "bookingDate",
           b.start_time AS "startTime",
           b.end_time AS "endTime",
           b.total_price AS "totalPrice",
           b.status AS "status",
           TO_CHAR(b.created_at, 'DD/MM/YYYY') AS "createdAt"
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id`;

const wrap = fn => (req, res) =>
    fn(req, res).catch(err => {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    });

async function query(sql, binds = [], options = {}) {
    let conn;
    try {
        conn = await oracledb.getConnection();
        return await conn.execute(sql, binds, { autoCommit: true, ...options });
    } finally {
        if (conn) await conn.close();
    }
}

// ---------- VENUES ----------
app.get('/api/venues', wrap(async (req, res) => {
    const result = await query(VENUE_SQL + ' ORDER BY name');
    res.json(result.rows);
}));

app.post('/api/venues', wrap(async (req, res) => {
    const { id, name, category, capacity, pricePerHour, location, image } = req.body;
    if (!name || !category || !capacity || !pricePerHour || !location) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const venueId = id || 'v-' + Date.now();

    await query(
        `MERGE INTO venues target
         USING (SELECT :id AS id FROM dual) src
         ON (target.id = src.id)
         WHEN MATCHED THEN
             UPDATE SET name = :name,
                        category = :category,
                        capacity = :capacity,
                        price_per_hour = :pricePerHour,
                        location = :location,
                        image = :image
         WHEN NOT MATCHED THEN
             INSERT (id, name, category, capacity, price_per_hour, location, image)
             VALUES (:id, :name, :category, :capacity, :pricePerHour, :location, :image)`,
        {
            id: venueId,
            name,
            category,
            capacity: Number(capacity),
            pricePerHour: Number(pricePerHour),
            location,
            image: image || null
        }
    );
    res.status(201).json({ id: venueId });
}));

app.delete('/api/venues/:id', wrap(async (req, res) => {
    await query('DELETE FROM venues WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
}));

// ---------- BOOKINGS ----------
app.get('/api/bookings', wrap(async (req, res) => {
    const result = await query(BOOKING_SQL + ' ORDER BY b.created_at DESC');
    res.json(result.rows);
}));

app.post('/api/bookings', wrap(async (req, res) => {
    const { venueId, applicantName, applicantEmail, eventTitle, bookingDate, startTime, endTime } = req.body;
    if (!venueId || !applicantName || !applicantEmail || !eventTitle || !bookingDate || !startTime || !endTime) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (startTime >= endTime) {
        return res.status(400).json({ error: 'End time must be after start time.' });
    }

    const conn = await oracledb.getConnection();
    try {
        const venueRes = await conn.execute(
            `SELECT name AS "name", price_per_hour AS "pricePerHour"
             FROM venues WHERE id = :venueId FOR UPDATE`,
            { venueId }
        );

        if (venueRes.rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Venue not found' });
        }

        const clashRes = await conn.execute(
            `SELECT 1 FROM bookings
             WHERE venue_id = :venueId
               AND booking_date = TO_DATE(:bookingDate, 'YYYY-MM-DD')
               AND status <> 'Cancelled'
               AND start_time < :endTime
               AND end_time > :startTime
               FETCH FIRST 1 ROWS ONLY`,
            { venueId, bookingDate, endTime, startTime }
        );

        if (clashRes.rows.length > 0) {
            await conn.rollback();
            return res.status(409).json({
                error: `CONFLICT DETECTED: ${venueRes.rows[0].name} is already reserved for ${startTime} - ${endTime} on this date. Please choose a different slot or date.`
            });
        }

        const toMin = t => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
        const hours = (toMin(endTime) - toMin(startTime)) / 60;
        const totalPrice = Math.round(hours * venueRes.rows[0].pricePerHour);
        const id = 'VH-' + Math.floor(100000 + Math.random() * 900000);

        await conn.execute(
            `INSERT INTO bookings (id, venue_id, applicant_name, applicant_email, event_title,
                                   booking_date, start_time, end_time, total_price, status)
             VALUES (:id, :venueId, :applicantName, :applicantEmail, :eventTitle,
                     TO_DATE(:bookingDate, 'YYYY-MM-DD'), :startTime, :endTime, :totalPrice, 'Approved')`,
            { id, venueId, applicantName, applicantEmail, eventTitle, bookingDate, startTime, endTime, totalPrice },
            { autoCommit: false }
        );

        await conn.commit();

        const createdRes = await conn.execute(BOOKING_SQL + ' WHERE b.id = :id', { id });
        res.status(201).json(createdRes.rows[0]);
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        await conn.close();
    }
}));

app.patch('/api/bookings/:id/status', wrap(async (req, res) => {
    const { status } = req.body;
    if (!['Pending', 'Approved', 'Cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    await query(
        'UPDATE bookings SET status = :status WHERE id = :id',
        { status, id: req.params.id }
    );
    res.json({ ok: true });
}));

async function startServer() {
    try {
        await oracledb.createPool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectString: process.env.DB_CONNECT_STRING,
            poolMin: 2,
            poolMax: 10,
            poolIncrement: 1
        });
        console.log('Oracle Database connection pool started');

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log(`VenueHub running at http://localhost:${PORT}`));
    } catch (err) {
        console.error('Failed to initialize Oracle pool:', err);
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    try {
        await oracledb.getPool().close(0);
    } finally {
        process.exit(0);
    }
});

startServer();