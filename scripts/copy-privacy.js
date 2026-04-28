const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'privacy-policy.html');
const dest = path.join(__dirname, '..', 'dist', 'privacy-policy.html');

fs.copyFileSync(src, dest);
console.log('Copied privacy-policy.html to dist/');
