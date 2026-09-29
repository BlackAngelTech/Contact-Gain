const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Demo defaults requested by the site owner.
// BEFORE PUBLIC DEPLOYMENT, set ADMIN_PASSWORD and ADMIN_SESSION_TOKEN as environment variables.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "858280";
const ADMIN_SESSION_TOKEN = process.env.ADMIN_SESSION_TOKEN || "local-demo-token";

const dataDir = path.join(__dirname, "data");
const contactsFile = path.join(dataDir, "contacts.json");
const settingsFile = path.join(dataDir, "settings.json");
const activityFile = path.join(dataDir, "activity.json");
fs.mkdirSync(dataDir, { recursive: true });

if (!fs.existsSync(contactsFile)) fs.writeFileSync(contactsFile, "[]");
if (!fs.existsSync(activityFile)) fs.writeFileSync(activityFile, "[]");

const defaults = {
  downloadsEnabled: true,
  registrationEnabled: true,
  maintenanceMode: false,
  siteTitle: "Contact Gain",
  welcomeText: "Grow your network and gain contacts.",
  countryCode: "263",
  maxRegistrationsPerIpPerHour: 30
};

let settings = { ...defaults };
if (fs.existsSync(settingsFile)) {
  try { settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) }; } catch {}
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function readContacts() { return readJson(contactsFile, []); }
function writeContacts(data) { writeJson(contactsFile, data); }
function saveSettings() { writeJson(settingsFile, settings); }
function logActivity(action, meta = {}) {
  const items = readJson(activityFile, []);
  items.unshift({ id: crypto.randomUUID(), action, meta, at: new Date().toISOString() });
  writeJson(activityFile, items.slice(0, 500));
}

function normalizePhone(input) {
  let s = String(input || "").trim().replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) {
    const cc = String(settings.countryCode || "263").replace(/\D/g, "");
    if (s.startsWith("0") && s.length >= 9) s = "+" + cc + s.slice(1);
    else s = "+" + s;
  }
  return "+" + s.slice(1).replace(/\D/g, "");
}
function validPhone(phone) { return /^\+[1-9]\d{6,14}$/.test(phone); }

function admin(req, res, next) {
  if ((req.headers["x-admin-token"] || "") !== ADMIN_SESSION_TOKEN)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}

function escapeVCard(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function makeVCF(contacts) {
  return contacts.map(c =>
    `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${escapeVCard(c.name)}\r\nTEL;TYPE=CELL:${escapeVCard(c.phone)}\r\nEND:VCARD\r\n`
  ).join("");
}
function csvEscape(v) {
  return '"' + String(v ?? "").replace(/"/g, '""') + '"';
}
function makeCSV(contacts) {
  return "Name,Phone,Created At\r\n" +
    contacts.map(c => [c.name, c.phone, c.createdAt].map(csvEscape).join(",")).join("\r\n");
}

const rateMap = new Map();
function allowedRate(req) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const hour = 3600000;
  const arr = (rateMap.get(key) || []).filter(t => now - t < hour);
  if (arr.length >= Number(settings.maxRegistrationsPerIpPerHour || 30)) {
    rateMap.set(key, arr);
    return false;
  }
  arr.push(now);
  rateMap.set(key, arr);
  return true;
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => res.json({
  registrationEnabled: !!settings.registrationEnabled,
  maintenanceMode: !!settings.maintenanceMode,
  siteTitle: settings.siteTitle,
  welcomeText: settings.welcomeText
}));

// PUBLIC REGISTRATION
app.post("/api/contacts", (req, res) => {
  if (settings.maintenanceMode) return res.status(503).json({ error: "The site is temporarily under maintenance." });
  if (!settings.registrationEnabled) return res.status(403).json({ error: "New registrations are currently disabled." });
  if (!allowedRate(req)) return res.status(429).json({ error: "Too many registrations from this connection. Try again later." });

  const name = String(req.body.name || "").trim().replace(/\s+/g, " ");
  const rawPhone = String(req.body.phone || "");
  const phone = normalizePhone(rawPhone);
  const consent = req.body.consent === true;

  if (!name || name.length > 80) return res.status(400).json({ error: "Enter a valid name." });
  if (!validPhone(phone)) return res.status(400).json({ error: "Enter a valid phone number." });
  if (!consent) return res.status(400).json({ error: "Consent is required before saving your contact." });

  const contacts = readContacts();

  // DUPLICATE PROTECTION: formatted versions such as 0771234567,
  // 263771234567 and +263 77 123 4567 normalize to the same stored number.
  if (contacts.some(c => normalizePhone(c.phone) === phone)) {
    return res.status(409).json({ error: "That phone number is already registered. Duplicate numbers are not allowed." });
  }

  contacts.push({
    id: crypto.randomUUID(),
    name,
    phone,
    createdAt: new Date().toISOString()
  });
  writeContacts(contacts);
  logActivity("Contact registered", { phone });
  res.json({ ok: true, phone });
});

// ADMIN AUTH
app.post("/api/admin/login", (req, res) => {
  if (String(req.body.password || "") !== ADMIN_PASSWORD) {
    logActivity("Failed admin login");
    return res.status(401).json({ error: "Wrong password." });
  }
  logActivity("Admin login");
  res.json({ ok: true, token: ADMIN_SESSION_TOKEN });
});

app.get("/api/admin/dashboard", admin, (req, res) => {
  const contacts = readContacts();
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = contacts.filter(c => String(c.createdAt).startsWith(today)).length;
  res.json({
    total: contacts.length,
    today: todayCount,
    downloadsEnabled: !!settings.downloadsEnabled,
    registrationEnabled: !!settings.registrationEnabled,
    maintenanceMode: !!settings.maintenanceMode,
    siteTitle: settings.siteTitle,
    welcomeText: settings.welcomeText,
    duplicateCount: findDuplicates(contacts).length,
    activities: readJson(activityFile, []).slice(0, 25)
  });
});

app.get("/api/admin/contacts", admin, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  let list = readContacts();
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  res.json(list);
});

app.get("/api/admin/settings", admin, (req, res) => res.json(settings));

app.post("/api/admin/settings", admin, (req, res) => {
  const allowed = [
    "downloadsEnabled", "registrationEnabled", "maintenanceMode",
    "siteTitle", "welcomeText", "countryCode", "maxRegistrationsPerIpPerHour"
  ];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) settings[key] = req.body[key];
  }
  settings.maxRegistrationsPerIpPerHour = Math.max(1, Math.min(1000, Number(settings.maxRegistrationsPerIpPerHour) || 30));
  saveSettings();
  logActivity("Settings updated", { keys: Object.keys(req.body) });
  res.json(settings);
});

// 1) Duplicate scanner
function findDuplicates(contacts) {
  const map = new Map();
  for (const c of contacts) {
    const p = normalizePhone(c.phone);
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(c);
  }
  return [...map.entries()].filter(([, arr]) => arr.length > 1)
    .map(([phone, items]) => ({ phone, items }));
}
app.get("/api/admin/duplicates", admin, (req, res) => {
  res.json(findDuplicates(readContacts()));
});

// 2) Delete one
app.delete("/api/admin/contacts/:id", admin, (req, res) => {
  const old = readContacts();
  const found = old.find(c => c.id === req.params.id);
  if (!found) return res.status(404).json({ error: "Contact not found." });
  writeContacts(old.filter(c => c.id !== req.params.id));
  logActivity("Contact deleted", { id: found.id });
  res.json({ ok: true });
});

// 3) Clear all
app.delete("/api/admin/contacts", admin, (req, res) => {
  if (String(req.body.confirm || "") !== "DELETE ALL") return res.status(400).json({ error: 'Type DELETE ALL to confirm.' });
  const count = readContacts().length;
  writeContacts([]);
  logActivity("All contacts deleted", { count });
  res.json({ ok: true, deleted: count });
});

// 4) VCF download
app.get("/api/admin/download-vcf", admin, (req, res) => {
  if (!settings.downloadsEnabled) return res.status(403).send("Downloads are disabled.");
  const contacts = readContacts();
  logActivity("VCF exported", { count: contacts.length });
  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="contact-gain.vcf"');
  res.send(makeVCF(contacts));
});

// 5) CSV download
app.get("/api/admin/download-csv", admin, (req, res) => {
  if (!settings.downloadsEnabled) return res.status(403).send("Downloads are disabled.");
  const contacts = readContacts();
  logActivity("CSV exported", { count: contacts.length });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="contact-gain.csv"');
  res.send(makeCSV(contacts));
});

// 6) JSON backup
app.get("/api/admin/backup", admin, (req, res) => {
  const payload = { exportedAt: new Date().toISOString(), settings, contacts: readContacts() };
  logActivity("JSON backup exported", { count: payload.contacts.length });
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="contact-gain-backup.json"');
  res.send(JSON.stringify(payload, null, 2));
});

// 7) JSON restore
app.post("/api/admin/restore", admin, (req, res) => {
  const incoming = Array.isArray(req.body.contacts) ? req.body.contacts : null;
  if (!incoming) return res.status(400).json({ error: "Invalid backup format." });
  const clean = [];
  const seen = new Set();
  for (const c of incoming) {
    const name = String(c.name || "").trim();
    const phone = normalizePhone(c.phone);
    if (!name || !validPhone(phone) || seen.has(phone)) continue;
    seen.add(phone);
    clean.push({ id: c.id || crypto.randomUUID(), name, phone, createdAt: c.createdAt || new Date().toISOString() });
  }
  writeContacts(clean);
  logActivity("Contacts restored", { count: clean.length });
  res.json({ ok: true, count: clean.length });
});

// 8) Purge duplicates, keeping the oldest record
app.post("/api/admin/purge-duplicates", admin, (req, res) => {
  const contacts = readContacts();
  const sorted = [...contacts].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  const seen = new Set();
  const clean = [];
  let removed = 0;
  for (const c of sorted) {
    const p = normalizePhone(c.phone);
    if (seen.has(p)) { removed++; continue; }
    seen.add(p);
    clean.push(c);
  }
  writeContacts(clean);
  logActivity("Duplicate contacts purged", { removed });
  res.json({ ok: true, removed });
});

// 9) Update contact
app.patch("/api/admin/contacts/:id", admin, (req, res) => {
  const contacts = readContacts();
  const item = contacts.find(c => c.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Contact not found." });
  const name = String(req.body.name || "").trim().replace(/\s+/g, " ");
  const phone = normalizePhone(req.body.phone);
  if (!name || name.length > 80 || !validPhone(phone)) return res.status(400).json({ error: "Invalid name or phone." });
  if (contacts.some(c => c.id !== item.id && normalizePhone(c.phone) === phone))
    return res.status(409).json({ error: "Another contact already uses that number." });
  item.name = name; item.phone = phone;
  writeContacts(contacts);
  logActivity("Contact edited", { id: item.id });
  res.json({ ok: true, item });
});

// 10) Activity log
app.get("/api/admin/activity", admin, (req, res) => res.json(readJson(activityFile, []).slice(0, 200)));

// 11) Admin logout is client-side token removal; endpoint records it
app.post("/api/admin/logout", admin, (req, res) => {
  logActivity("Admin logout");
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Contact Gain running on http://localhost:${PORT}`));
