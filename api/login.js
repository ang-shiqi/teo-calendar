import admin from 'firebase-admin';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const { passcode } = req.body || {};
    if (!passcode) return json(res, 400, { error: 'Missing passcode' });

    const expected = process.env.CALENDAR_EDIT_PASSCODE;
    if (!expected) return json(res, 500, { error: 'Server not configured' });
    if (passcode !== expected) return json(res, 401, { error: 'Wrong passcode' });

    if (!admin.apps.length) {
      const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (!saRaw) return json(res, 500, { error: 'Missing FIREBASE_SERVICE_ACCOUNT_JSON' });
      const serviceAccount = JSON.parse(saRaw);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }

    const uid = 'calendar-editor';
    const token = await admin.auth().createCustomToken(uid, { editor: true });

    return json(res, 200, { token });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Internal error' });
  }
}
