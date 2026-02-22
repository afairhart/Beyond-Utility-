const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Callable function: deleteUser
 * Deletes a user's Firebase Auth account and Firestore profile.
 * Only admins can call this.
 */
exports.deleteUser = onCall(async (request) => {
  // Must be authenticated
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const callerUid = request.auth.uid;
  const targetUid = request.data.uid;

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Must provide a uid to delete.");
  }

  if (callerUid === targetUid) {
    throw new HttpsError("invalid-argument", "Cannot delete your own account.");
  }

  // Verify the caller is an admin
  const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can delete users.");
  }

  // Delete Firestore profile
  await admin.firestore().collection("users").doc(targetUid).delete();

  // Delete Firebase Auth account
  try {
    await admin.auth().deleteUser(targetUid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") {
      throw new HttpsError("internal", "Failed to delete auth account.");
    }
  }

  return { success: true };
});
