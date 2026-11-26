// RegulaQuest · serverová funkce „ucty“ (Supabase Edge Function)
// Jediné místo, které používá administrátorský klíč. Zakládá účty v Auth a jejich profily.
//
// Akce (POST JSON, volá přihlášený admin ze Studia):
//   { action: "create_students", group_id, count }        → admin; vrátí jména a hesla (zobrazí se jen jednou)
//   { action: "create_admin", username, display_name }    → jen správce; vrátí heslo
//   { action: "reset_password", user_id }                 → admin pro studenty, správce pro adminy
import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_DOMAIN = "admin.regulaquest.cz";
const STUDENT_DOMAIN = "studenti.regulaquest.invalid";
const STUDENT_PREFIX = "rq-";
const ALLOWED_ORIGINS = ["https://regulaquest-studio.pages.dev"];

const NAME_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // bez snadno zaměnitelných znaků
const PW_LOWER = "abcdefghijkmnpqrstuvwxyz";
const PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PW_DIGIT = "23456789";

function cors(origin: string | null) {
  const allowed = origin && (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.regulaquest-studio\.pages\.dev$/.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function pick(chars: string, n: number): string {
  const out: string[] = [];
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (const v of buf) out.push(chars[v % chars.length]);
  return out.join("");
}

// 12 znaků, vždy malé i velké písmeno a číslice (odpovídá nastavení Auth).
function password(): string {
  const all = PW_LOWER + PW_UPPER + PW_DIGIT;
  const chars = (pick(PW_LOWER, 1) + pick(PW_UPPER, 1) + pick(PW_DIGIT, 1) + pick(all, 9)).split("");
  const r = new Uint32Array(chars.length);
  crypto.getRandomValues(r);
  for (let i = chars.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get("Origin")), "Content-Type": "application/json; charset=utf-8" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Nepodporovaná metoda");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Kdo volá: ověřit token a roli v profilu.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) throw new HttpError(401, "Nejste přihlášeni");
    const { data: me } = await admin.from("profiles").select("role,active").eq("user_id", who.user.id).maybeSingle();
    if (!me || !me.active || !["owner", "admin"].includes(me.role)) throw new HttpError(403, "Tuto akci smí provést jen admin");
    const isOwner = me.role === "owner";

    const body = await req.json().catch(() => ({}));
    if (body.action === "create_students") {
      const count = Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > 200) throw new HttpError(400, "Počet účtů musí být 1–200");
      const { data: group } = await admin.from("student_groups").select("id,name,active").eq("id", body.group_id).maybeSingle();
      if (!group) throw new HttpError(400, "Skupina neexistuje");
      if (!group.active) throw new HttpError(400, "Skupina není aktivní");
      const created: { username: string; password: string }[] = [];
      let attempts = 0;
      while (created.length < count) {
        if (++attempts > count * 5) throw new HttpError(500, `Účty se nepodařilo vytvořit (vytvořeno ${created.length})`);
        const username = STUDENT_PREFIX + pick(NAME_CHARS, 6);
        const pw = password();
        const { data: u, error } = await admin.auth.admin.createUser({
          email: `${username}@${STUDENT_DOMAIN}`, password: pw, email_confirm: true,
        });
        if (error) {
          if (/already|registered|exists/i.test(error.message)) continue; // kolize jména, zkusit jiné
          throw new HttpError(500, "Auth: " + error.message);
        }
        const { error: pErr } = await admin.from("profiles").insert({
          user_id: u.user.id, username, role: "student", group_id: group.id,
        });
        if (pErr) { await admin.auth.admin.deleteUser(u.user.id); if (/duplicate/i.test(pErr.message)) continue; throw new HttpError(500, pErr.message); }
        created.push({ username, password: pw });
      }
      return reply(200, { group: group.name, accounts: created });
    }

    if (body.action === "create_admin") {
      if (!isOwner) throw new HttpError(403, "Účty adminů zakládá jen správce");
      const username = String(body.username || "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,40}$/.test(username) || username.startsWith(STUDENT_PREFIX)) {
        throw new HttpError(400, "Jméno: 2–40 znaků, malá písmena bez diakritiky, číslice, tečka, pomlčka; nesmí začínat „rq-“");
      }
      const display = String(body.display_name || "").trim().slice(0, 80);
      const pw = password();
      const { data: u, error } = await admin.auth.admin.createUser({
        email: `${username}@${ADMIN_DOMAIN}`, password: pw, email_confirm: true,
      });
      if (error) throw new HttpError(400, /already|registered|exists/i.test(error.message) ? "Toto jméno už existuje" : "Auth: " + error.message);
      const { error: pErr } = await admin.from("profiles").insert({ user_id: u.user.id, username, display_name: display, role: "admin" });
      if (pErr) { await admin.auth.admin.deleteUser(u.user.id); throw new HttpError(400, pErr.message); }
      return reply(200, { username, password: pw });
    }

    if (body.action === "reset_password") {
      const { data: target } = await admin.from("profiles").select("user_id,username,role").eq("user_id", body.user_id).maybeSingle();
      if (!target) throw new HttpError(400, "Účet neexistuje");
      if (target.role !== "student" && !isOwner) throw new HttpError(403, "Heslo admina mění jen správce");
      if (target.user_id === who.user.id) throw new HttpError(400, "Vlastní heslo si změňte v Supabase nebo požádejte správce");
      const pw = password();
      const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: pw });
      if (error) throw new HttpError(500, "Auth: " + error.message);
      return reply(200, { username: target.username, password: pw });
    }

    throw new HttpError(400, "Neznámá akce");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return reply(status, { error: e instanceof Error ? e.message : String(e) });
  }
});
