const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

// --- Usage tracking & auto-block ---
// Free tier: 2M invocations/month. Block at 95% (1,900,000).
const FREE_TIER_LIMIT = 2000000;
const BLOCK_THRESHOLD = Math.floor(FREE_TIER_LIMIT * 0.95); // 1,900,000

/**
 * Increments the monthly invocation counter and blocks if over 95% of free tier.
 * Stores counts in Firestore at usage/functions-{YYYY-MM}.
 * Returns the updated count.
 */
async function checkAndIncrementUsage() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const docRef = admin.firestore().collection("usage").doc(`functions-${monthKey}`);

  const result = await admin.firestore().runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    const data = doc.exists ? doc.data() : { invocations: 0, alertSent: false };
    const newCount = (data.invocations || 0) + 1;

    if (newCount >= BLOCK_THRESHOLD) {
      tx.set(docRef, { invocations: newCount, alertSent: true, blockedAt: newCount }, { merge: true });
      return { blocked: true, count: newCount, alertSent: data.alertSent };
    }

    tx.set(docRef, { invocations: newCount }, { merge: true });
    return { blocked: false, count: newCount, alertSent: data.alertSent };
  });

  return result;
}

/**
 * Guard that runs at the top of each function.
 * Throws if usage has hit 95% of the free tier.
 */
async function usageGate() {
  const { blocked, count } = await checkAndIncrementUsage();
  if (blocked) {
    throw new HttpsError(
      "resource-exhausted",
      `Monthly invocation limit reached (${count.toLocaleString()}/${FREE_TIER_LIMIT.toLocaleString()}). ` +
      `Functions are paused to stay within the free tier. Resets next month.`
    );
  }
}

/**
 * Scheduled function: resets the usage counter on the 1st of each month.
 */
exports.resetMonthlyUsage = onSchedule("0 0 1 * *", async () => {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  await admin.firestore().collection("usage").doc(`functions-${monthKey}`).set({
    invocations: 0,
    alertSent: false,
  });
});

/**
 * Callable function: networkSearch
 * Uses Claude to surface the most relevant LinkedIn connections for a query.
 * Reads the Claude API key from Firestore settings/apiKeys.
 */
exports.networkSearch = onCall({ timeoutSeconds: 120 }, async (request) => {
  await usageGate();

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
  await usageGate();

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

// ── Calendar URLs (server-side only) ──
const CALENDAR_URL_1 = "https://calendar.google.com/calendar/ical/afairhart%40gmail.com/private-943700855df32a888cd071a97b8fa556/basic.ics";
const CALENDAR_URL_2 = "https://calendar.google.com/calendar/ical/alex%40beyondutilitywaterventures.com/public/basic.ics";

/**
 * Extracts all VEVENT blocks from a raw ICS string.
 */
function extractEvents(ics) {
  const events = [];
  const regex = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g;
  let match;
  while ((match = regex.exec(ics)) !== null) {
    events.push(match[0]);
  }
  return events;
}

/**
 * Merges two ICS feeds into a single VCALENDAR string.
 */
function mergeICS(ics1, ics2) {
  const events = [...extractEvents(ics1), ...extractEvents(ics2)];
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Beyond Utility Water Ventures//Unified Calendar//EN",
    "X-WR-CALNAME:Beyond Utility Water Ventures",
    "X-WR-CALDESC:Unified calendar for Beyond Utility Water Ventures",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * HTTP function: calendarFeed
 * Returns a merged ICS feed from both calendars.
 * Suitable for direct calendar app subscription (webcal://).
 */
exports.calendarFeed = onRequest({ cors: true }, async (req, res) => {
  try {
    const [r1, r2] = await Promise.all([fetch(CALENDAR_URL_1), fetch(CALENDAR_URL_2)]);
    const [ics1, ics2] = await Promise.all([r1.text(), r2.text()]);
    const merged = mergeICS(ics1, ics2);
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="beyond-utility.ics"');
    res.send(merged);
  } catch (err) {
    console.error("calendarFeed error:", err);
    res.status(500).send("Failed to fetch calendar feeds.");
  }
});
