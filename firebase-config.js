/*
 * Firebase Configuration — Beyond Utility Water Ventures
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://console.firebase.google.com and create a new project
 * 2. Enable Authentication → Sign-in method → Email/Password
 * 3. Enable Cloud Firestore (start in production mode)
 * 4. Go to Project Settings → General → Your apps → Add web app
 * 5. Copy the firebaseConfig object and paste it below
 * 6. Deploy the Firestore security rules from firestore.rules
 *
 * FIRST LOGIN:
 * The very first user to log in is automatically set as admin.
 * Create your account in Firebase Console → Authentication → Add user,
 * then log in on the site. You'll be made admin automatically.
 */

const firebaseConfig = {
  apiKey: "AIzaSyASEr7Cn_YxWgiPZPmvVN2o9c66Sg5z3ng",
  authDomain: "beyond-utility-ventures.firebaseapp.com",
  projectId: "beyond-utility-ventures",
  storageBucket: "beyond-utility-ventures.firebasestorage.app",
  messagingSenderId: "793189015182",
  appId: "1:793189015182:web:22cec49f2757fa669673df",
  measurementId: "G-J5QG4ZTWGR"
};

// ── Initialize Firebase ──
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ── Auth Helpers ──
const BUAuth = {
  /** Returns a promise that resolves with the current user (or null) */
  currentUser() {
    return new Promise(resolve => {
      const unsub = auth.onAuthStateChanged(user => {
        unsub();
        resolve(user);
      });
    });
  },

  /** Returns the Firestore profile for a uid */
  async getProfile(uid) {
    const doc = await db.collection('users').doc(uid).get();
    return doc.exists ? doc.data() : null;
  },

  /** Check if user is admin */
  async isAdmin(uid) {
    const profile = await this.getProfile(uid);
    return profile && profile.role === 'admin';
  },

  /** Sign in with email + password */
  login(email, password) {
    return auth.signInWithEmailAndPassword(email, password);
  },

  /** Sign out */
  logout() {
    return auth.signOut();
  },

  /**
   * Ensure user profile exists in Firestore.
   * If no users exist yet, make this user the admin.
   */
  async ensureProfile(user) {
    const docRef = db.collection('users').doc(user.uid);
    const doc = await docRef.get();
    if (doc.exists) return doc.data();

    // Check if any users exist — first user becomes admin
    const snapshot = await db.collection('users').limit(1).get();
    const role = snapshot.empty ? 'admin' : 'partner';

    const profile = {
      email: user.email,
      role: role,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await docRef.set(profile);
    return profile;
  },

  /**
   * Create a new user (admin only).
   * Uses a secondary Firebase app so the admin stays logged in.
   */
  async createUser(email, password) {
    const secondaryApp = firebase.apps.find(a => a.name === 'Secondary')
      || firebase.initializeApp(firebaseConfig, 'Secondary');
    const secondaryAuth = secondaryApp.auth();

    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;

    // Write profile to Firestore
    await db.collection('users').doc(uid).set({
      email: email,
      role: 'partner',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await secondaryAuth.signOut();
    return uid;
  },

  /** List all users (admin only) */
  async listUsers() {
    const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
  },

  /** Delete a user profile from Firestore (admin only).
   *  Note: This removes their Firestore doc. The Firebase Auth account
   *  can only be fully deleted from the Firebase Console. */
  async removeUser(uid) {
    await db.collection('users').doc(uid).delete();
  },

  /**
   * Auth guard — redirects to login if not authenticated.
   * Returns { user, profile } if authenticated and authorized.
   * If the user's Firestore profile was removed by an admin,
   * they are signed out and sent back to login.
   */
  async guard() {
    const user = await this.currentUser();
    if (!user) {
      window.location.href = 'login.html';
      return null;
    }

    // Check if any users exist at all (first-user bootstrap)
    const snapshot = await db.collection('users').limit(1).get();
    if (snapshot.empty) {
      // No users yet — bootstrap the first admin
      const profile = await this.ensureProfile(user);
      return { user, profile };
    }

    // Users exist — only allow access if this user has a profile
    const profile = await this.getProfile(user.uid);
    if (!profile) {
      await this.logout();
      window.location.href = 'login.html';
      return null;
    }

    return { user, profile };
  }
};
