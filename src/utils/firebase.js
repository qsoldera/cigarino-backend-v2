let admin = null;

function initFirebase() {
  if (!process.env.FIREBASE_PROJECT_ID) return;
  try {
    const firebase = require('firebase-admin');
    if (!firebase.apps.length) {
      firebase.initializeApp({
        credential: firebase.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
    admin = firebase;
  } catch (e) {
    console.warn('Firebase non configuré, notifications désactivées:', e.message);
  }
}

initFirebase();

async function notifyAdmins(db, title, body) {
  if (!admin) return;
  try {
    const { rows } = await db.query(
      `SELECT t.token FROM user_fcm_tokens t
       JOIN users u ON t.user_id = u.id
       WHERE u.is_admin = TRUE`
    );
    for (const row of rows) {
      await admin.messaging().send({
        token: row.token,
        notification: { title, body },
      });
    }
  } catch (e) {
    console.warn('Erreur notification FCM:', e.message);
  }
}

module.exports = { notifyAdmins };
