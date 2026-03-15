import admin from 'firebase-admin';

// Required env vars:
// - FEED_API_KEY: shared key expected in X-API-Key header
// - FIREBASE_SERVICE_ACCOUNT_JSON: Firebase service account JSON string

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function getSingleQueryParam(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseDateString(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

function toDateString(parts) {
  return `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}

function addDays(parts, days) {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function compareDates(a, b) {
  const as = toDateString(a);
  const bs = toDateString(b);
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

function diffDaysInclusive(start, end) {
  const a = Date.UTC(start.y, start.m - 1, start.d);
  const b = Date.UTC(end.y, end.m - 1, end.d);
  return Math.floor((b - a) / 86400000) + 1;
}

function todayInSingapore() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateStr = fmt.format(new Date()); // YYYY-MM-DD in en-CA
  return parseDateString(dateStr);
}

function parseDays(value, defaultDays = 90) {
  if (value == null || value === '') return defaultDays;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function ensureFirebase() {
  if (admin.apps.length) return;
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!saRaw) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  }
  const serviceAccount = JSON.parse(saRaw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    const expectedKey = process.env.FEED_API_KEY;
    if (!expectedKey) return json(res, 500, { error: 'Server not configured' });

    const providedKey = req.headers['x-api-key'];
    if (!providedKey || providedKey !== expectedKey) {
      return json(res, 401, { error: 'Unauthorized' });
    }

    const qStart = getSingleQueryParam(req.query?.start);
    const qEnd = getSingleQueryParam(req.query?.end);
    const qDays = getSingleQueryParam(req.query?.days);
    const qUser = getSingleQueryParam(req.query?.user);
    const user = qUser || 'all';

    let start;
    let end;

    if ((qStart && !qEnd) || (!qStart && qEnd)) {
      return json(res, 400, { error: 'Both start and end are required when either is provided' });
    }

    if (qStart && qEnd) {
      start = parseDateString(qStart);
      end = parseDateString(qEnd);
      if (!start || !end) {
        return json(res, 400, { error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      if (compareDates(start, end) > 0) {
        return json(res, 400, { error: 'Invalid range: start must be <= end' });
      }
    } else {
      const parsedDays = parseDays(qDays, 90);
      if (!parsedDays) return json(res, 400, { error: 'Invalid days. Must be a positive integer' });
      const clampedDays = Math.min(parsedDays, 120);

      start = todayInSingapore();
      end = addDays(start, clampedDays - 1);
    }

    const rangeDays = diffDaysInclusive(start, end);
    if (rangeDays > 120) {
      end = addDays(start, 119);
    }

    ensureFirebase();
    const db = admin.firestore();
    const eventsCol = db
      .collection('artifacts')
      .doc('teo-calendar-v2')
      .collection('public')
      .doc('data')
      .collection('events');

    const startStr = toDateString(start);
    const endStr = toDateString(end);

    const dateList = [];
    let cursor = start;
    while (compareDates(cursor, end) <= 0) {
      dateList.push(toDateString(cursor));
      cursor = addDays(cursor, 1);
    }

    const refs = dateList.map((d) => eventsCol.doc(d));
    const snapshots = refs.length ? await db.getAll(...refs) : [];

    const eventsByDate = {};
    for (const snap of snapshots) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const users = Array.isArray(data.users) ? data.users : [];

      if (user !== 'all' && !users.includes(user)) continue;

      eventsByDate[snap.id] = {
        text: typeof data.text === 'string' ? data.text : '',
        users,
      };
    }

    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      range: { start: startStr, end: endStr },
      user,
      eventsByDate,
    });
  } catch (e) {
    console.error(e);
    if (e?.message === 'Missing FIREBASE_SERVICE_ACCOUNT_JSON') {
      return json(res, 500, { error: 'Missing FIREBASE_SERVICE_ACCOUNT_JSON' });
    }
    return json(res, 500, { error: 'Internal error' });
  }
}
