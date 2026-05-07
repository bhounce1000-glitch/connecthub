const fs = require('fs');

// ── home.js ──────────────────────────────────────────────────────────────────
let txt = fs.readFileSync('src/app/home.js', 'utf8');

const OLD_HOME =
  "  const firstName = useMemo(() => {\n" +
  "    const raw = String(userProfiles[currentEmail]?.displayName || userProfiles[currentEmail]?.name || currentEmail.split('@')[0] || 'there').trim();\n" +
  "    return raw.split(/\\s+/)[0] || 'there';\n" +
  "  }, [currentEmail, userProfiles]);";

const NEW_HOME =
  "  const firstName = useMemo(() => {\n" +
  "    const raw = String(\n" +
  "      userProfiles[currentEmail]?.username ||\n" +
  "      userProfiles[currentEmail]?.displayName ||\n" +
  "      userProfiles[currentEmail]?.name ||\n" +
  "      currentEmail.split('@')[0] ||\n" +
  "      'there'\n" +
  "    ).trim();\n" +
  "    return raw.split(/\\s+/)[0] || 'there';\n" +
  "  }, [currentEmail, userProfiles]);";

if (txt.includes(OLD_HOME)) {
  fs.writeFileSync('src/app/home.js', txt.replace(OLD_HOME, NEW_HOME));
  console.log('home.js: updated');
} else {
  console.log('home.js: pattern not found — no change');
}

// ── profile.js ────────────────────────────────────────────────────────────────
let txt2 = fs.readFileSync('src/app/profile.js', 'utf8');

const OLD_PROF = "profile?.name || currentEmail.split('@')[0]";
const NEW_PROF  = "profile?.username || profile?.name || currentEmail.split('@')[0]";

if (txt2.includes(OLD_PROF)) {
  fs.writeFileSync('src/app/profile.js', txt2.replace(OLD_PROF, NEW_PROF));
  console.log('profile.js: updated');
} else {
  console.log('profile.js: pattern not found — no change');
}
