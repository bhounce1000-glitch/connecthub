/**
 * Post-build script: injects SEO meta tags into dist/index.html.
 *
 * Expo exports a minimal HTML shell with only <title> and basic viewport.
 * This script adds the description, Open Graph, Twitter Card, and PWA meta
 * tags that search engines and social platforms expect. Run this after
 * `expo export` and before `firebase deploy`.
 */
const fs = require('fs');
const path = require('path');

const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(distIndex)) {
  console.error('inject-meta: dist/index.html not found — run expo export first.');
  process.exit(1);
}

const META_BLOCK = `
    <!-- SEO / social meta — injected by scripts/inject-meta.js -->
    <title>ConnectHub \u2013 Find &amp; Hire Service Providers</title>
    <meta name="description" content="ConnectHub connects you with verified local service providers. Post a job, get accepted, and pay securely \u2014 all in one place." />
    <meta name="theme-color" content="#0f172a" />
    <meta name="application-name" content="ConnectHub" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="ConnectHub" />
    <meta property="og:title" content="ConnectHub \u2013 Find &amp; Hire Service Providers" />
    <meta property="og:description" content="ConnectHub connects you with verified local service providers. Post a job, get accepted, and pay securely." />
    <meta property="og:url" content="https://connecthub-1873e.web.app" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="ConnectHub \u2013 Find &amp; Hire Service Providers" />
    <meta name="twitter:description" content="ConnectHub connects you with verified local service providers. Post a job, get accepted, and pay securely." />

    <!-- PWA / Apple -->
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="ConnectHub" />
    <!-- end SEO / social meta -->`;

let html = fs.readFileSync(distIndex, 'utf8');

// Replace the bare <title>ConnectHub</title> with the full meta block.
// If the title was already replaced (e.g. re-run), skip gracefully.
if (html.includes('inject-meta.js')) {
  console.log('inject-meta: meta tags already present, skipping.');
  process.exit(0);
}

html = html.replace('<title>ConnectHub</title>', META_BLOCK);
fs.writeFileSync(distIndex, html, 'utf8');
console.log('inject-meta: SEO/OG/PWA meta tags injected into dist/index.html');
