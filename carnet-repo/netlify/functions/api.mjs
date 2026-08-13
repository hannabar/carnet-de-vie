import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const db = getDatabase();

const MAX_FAILS = 8;              // tentatives avant blocage
const LOCK_MINUTES = 15;          // durée du blocage
const SESSION_DAYS = 60;          // durée de validité d'une session

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function hashCode(code) {
  const salt = process.env.PIN_SALT || "carnet-de-vie-sel-par-defaut";
  return crypto.scryptSync(String(code), salt, 32).toString("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function getSetting(key) {
  const rows = await db.sql`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await db.sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${String(value)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

async function isAuthed(req) {
  const token = req.headers.get("x-session");
  if (!token) return false;
  const rows = await db.sql`
    SELECT 1 FROM sessions
    WHERE token = ${token}
      AND created_at > NOW() - (${SESSION_DAYS} || ' days')::interval
  `;
  return rows.length > 0;
}

async function checkLock() {
  const until = await getSetting("lock_until");
  if (!until) return 0;
  const remaining = Math.ceil((new Date(until).getTime() - Date.now()) / 60000);
  return remaining > 0 ? remaining : 0;
}

async function registerFail() {
  const count = Number((await getSetting("fail_count")) || 0) + 1;
  await setSetting("fail_count", count);
  if (count >= MAX_FAILS) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    await setSetting("lock_until", until);
    await setSetting("fail_count", 0);
    return LOCK_MINUTES;
  }
  return 0;
}

async function resetFails() {
  await setSetting("fail_count", 0);
  await setSetting("lock_until", "");
}

export default async function handler(req) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "");

  try {
    // ---- CONNEXION ----
    if (route === "login" && req.method === "POST") {
      const locked = await checkLock();
      if (locked > 0) {
        return json({ error: "locked", minutes: locked }, 429);
      }

      const { code } = await req.json();
      if (!code) return json({ error: "missing" }, 400);

      let stored = await getSetting("pin_hash");

      // Premier démarrage : on initialise depuis la variable d'environnement
      if (!stored) {
        const bootstrap = process.env.APP_PIN;
        if (!bootstrap) return json({ error: "not_configured" }, 500);
        if (!safeEqual(String(code), String(bootstrap))) {
          const lock = await registerFail();
          return json({ error: "wrong", lockedMinutes: lock }, 401);
        }
        stored = hashCode(code);
        await setSetting("pin_hash", stored);
      } else if (!safeEqual(hashCode(code), stored)) {
        const lock = await registerFail();
        return json({ error: "wrong", lockedMinutes: lock }, 401);
      }

      await resetFails();
      const token = crypto.randomUUID() + crypto.randomBytes(16).toString("hex");
      await db.sql`INSERT INTO sessions (token) VALUES (${token})`;
      await db.sql`DELETE FROM sessions WHERE created_at < NOW() - (${SESSION_DAYS} || ' days')::interval`;
      return json({ token });
    }

    // ---- VÉRIFIER UNE SESSION ----
    if (route === "session" && req.method === "GET") {
      return json({ valid: await isAuthed(req) });
    }

    // ---- DÉCONNEXION ----
    if (route === "logout" && req.method === "POST") {
      const token = req.headers.get("x-session");
      if (token) await db.sql`DELETE FROM sessions WHERE token = ${token}`;
      return json({ ok: true });
    }

    // Toutes les routes suivantes exigent une session valide
    if (!(await isAuthed(req))) return json({ error: "unauthorized" }, 401);

    // ---- LECTURE DE TOUTES LES DONNÉES ----
    if (route === "data" && req.method === "GET") {
      const rows = await db.sql`SELECT key, value FROM app_data`;
      const out = {};
      for (const r of rows) out[r.key] = r.value;
      return json(out);
    }

    // ---- ÉCRITURE ----
    if (route === "data" && req.method === "PUT") {
      const { entries } = await req.json();
      if (!entries || typeof entries !== "object") return json({ error: "bad_payload" }, 400);
      for (const [key, value] of Object.entries(entries)) {
        await db.sql`
          INSERT INTO app_data (key, value, updated_at)
          VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `;
      }
      return json({ ok: true, count: Object.keys(entries).length });
    }

    // ---- SUPPRESSION D'UNE CLÉ ----
    if (route === "data" && req.method === "DELETE") {
      const { key } = await req.json();
      await db.sql`DELETE FROM app_data WHERE key = ${key}`;
      return json({ ok: true });
    }

    // ---- CHANGEMENT DE CODE ----
    if (route === "pin" && req.method === "POST") {
      const { newCode } = await req.json();
      if (!newCode || String(newCode).length < 4) return json({ error: "too_short" }, 400);
      await setSetting("pin_hash", hashCode(newCode));
      const keep = req.headers.get("x-session");
      await db.sql`DELETE FROM sessions WHERE token <> ${keep}`;
      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error("Erreur API:", err);
    return json({ error: "server_error", detail: String(err?.message || err) }, 500);
  }
}
