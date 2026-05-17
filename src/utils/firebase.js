let admin = null;

function initFirebase() {
  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('[FCM] Variables Firebase manquantes — notifications désactivées');
    return;
  }
  try {
    const firebase = require('firebase-admin');
    if (!firebase.apps.length) {
      firebase.initializeApp({
        credential: firebase.credential.cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Railway encode les \n en \\n dans les variables d'env
          privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
      console.log('[FCM] Firebase Admin initialisé');
    }
    admin = firebase;
  } catch (e) {
    console.error('[FCM] Erreur initialisation Firebase:', e.message);
  }
}

initFirebase();

// Envoyer à un utilisateur spécifique
async function sendToUser(db, userId, title, body, data = {}) {
  if (!admin) return;
  try {
    const { rows } = await db.query(
      'SELECT token FROM user_fcm_tokens WHERE user_id=$1',
      [userId]);
    for (const row of rows) {
      await admin.messaging().send({
        token: row.token,
        notification: { title, body },
        data: { ...data },
        android: { priority: 'high' },
        apns: { payload: { aps: { badge: 1, sound: 'default' } } },
      }).catch(e => {
        // Token invalide → supprimer
        if (e.code === 'messaging/registration-token-not-registered') {
          db.query('DELETE FROM user_fcm_tokens WHERE token=$1', [row.token]);
        }
      });
    }
  } catch (e) {
    console.warn('[FCM] sendToUser error:', e.message);
  }
}

// Envoyer à tous les admins
async function notifyAdmins(db, title, body, data = {}) {
  if (!admin) return;
  try {
    const { rows } = await db.query(
      `SELECT t.token FROM user_fcm_tokens t
       JOIN users u ON t.user_id = u.id
       WHERE u.is_admin = TRUE`);
    for (const row of rows) {
      await admin.messaging().send({
        token: row.token,
        notification: { title, body },
        data: { ...data },
        android: { priority: 'high' },
      }).catch(e => {
        if (e.code === 'messaging/registration-token-not-registered') {
          db.query('DELETE FROM user_fcm_tokens WHERE token=$1', [row.token]);
        }
      });
    }
  } catch (e) {
    console.warn('[FCM] notifyAdmins error:', e.message);
  }
}

module.exports = { sendToUser, notifyAdmins };
