const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Callable function: networkSearch
 * Uses Claude to surface the most relevant LinkedIn connections for a query.
 * Reads the Claude API key from Firestore settings/apiKeys.
 */
exports.networkSearch = onCall({ timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const { query, context, connections } = request.data;

  if (!query || typeof query !== "string") {
    throw new HttpsError("invalid-argument", "Must provide a query string.");
  }
  if (!Array.isArray(connections) || connections.length === 0) {
    throw new HttpsError("invalid-argument", "Must provide a connections array.");
  }

  // Read Claude API key from Firestore (admin-only document)
  const settingsDoc = await admin
    .firestore()
    .collection("settings")
    .doc("apiKeys")
    .get();

  if (!settingsDoc.exists || !settingsDoc.data().claude) {
    throw new HttpsError(
      "failed-precondition",
      "Claude api key not configured. Add it in the Settings tab."
    );
  }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic.default({ apiKey: settingsDoc.data().claude });

  // Build a context preamble based on the user's use-case
  const contextPrompts = {
    water: "Focus on connections useful for water infrastructure consulting, municipal utilities, wastewater treatment, desalination, or water technology.",
    vc: "Focus on connections useful for a water-tech venture fund: founders, investors, limited partners, water tech company executives, and domain experts who can source or evaluate deals.",
    general: "Consider all professional use cases — both water consulting and venture investing.",
  };
  const contextHint = contextPrompts[context] || contextPrompts.general;

  // Format connections as a compact list for the prompt
  const connList = connections
    .slice(0, 200)
    .map((c, i) => `${i + 1}. ${c.name} | ${c.position || "Unknown role"} | ${c.company || "Unknown company"} | ${c.category || "Other"}`)
    .join("\n");

  const prompt = `You are a network intelligence assistant for Beyond Utility Water Ventures — a venture fund and water consulting practice.

Context: ${contextHint}

Here are the user's LinkedIn connections (name | position | company | category):
${connList}

Query: "${query}"

Return a JSON object with a "results" array containing the top 10 most relevant connections for this query.
Each result must have these exact fields:
- name: string (full name as given)
- position: string (job title)
- company: string (company name)
- category: string (industry category)
- reason: string (2–3 sentences explaining specifically why this person is relevant to the query)
- score: number (1–10 relevance score)

Sort by score descending. Return ONLY the JSON object, no other text.`;

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.text ?? "{}";

  // Parse the JSON response from Claude
  let results = [];
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      results = Array.isArray(parsed.results) ? parsed.results : [];
    }
  } catch (e) {
    return { results: [], error: "Could not parse AI response." };
  }

  return { results };
});

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
