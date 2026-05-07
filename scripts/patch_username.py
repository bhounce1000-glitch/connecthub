"""Patch home.js and profile.js to use the username field."""

# --- home.js ---
with open('src/app/home.js', 'r', encoding='utf-8') as f:
    txt = f.read()

OLD_HOME = (
    "  const firstName = useMemo(() => {\n"
    "    const raw = String(userProfiles[currentEmail]?.displayName || userProfiles[currentEmail]?.name || currentEmail.split('@')[0] || 'there').trim();\n"
    "    return raw.split(/\\s+/)[0] || 'there';\n"
    "  }, [currentEmail, userProfiles]);"
)

NEW_HOME = (
    "  const firstName = useMemo(() => {\n"
    "    const raw = String(\n"
    "      userProfiles[currentEmail]?.username ||\n"
    "      userProfiles[currentEmail]?.displayName ||\n"
    "      userProfiles[currentEmail]?.name ||\n"
    "      currentEmail.split('@')[0] ||\n"
    "      'there'\n"
    "    ).trim();\n"
    "    return raw.split(/\\s+/)[0] || 'there';\n"
    "  }, [currentEmail, userProfiles]);"
)

if OLD_HOME in txt:
    txt = txt.replace(OLD_HOME, NEW_HOME, 1)
    with open('src/app/home.js', 'w', encoding='utf-8') as f:
        f.write(txt)
    print('home.js: updated')
else:
    print('home.js: pattern NOT found')

# --- profile.js ---
with open('src/app/profile.js', 'r', encoding='utf-8') as f:
    txt2 = f.read()

OLD_PROF = "profile?.name || currentEmail.split('@')[0]"
NEW_PROF = "profile?.username || profile?.name || currentEmail.split('@')[0]"

if OLD_PROF in txt2:
    txt2 = txt2.replace(OLD_PROF, NEW_PROF, 1)
    with open('src/app/profile.js', 'w', encoding='utf-8') as f:
        f.write(txt2)
    print('profile.js: updated')
else:
    print('profile.js: pattern NOT found')
