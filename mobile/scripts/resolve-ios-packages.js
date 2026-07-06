#!/usr/bin/env node
/**
 * Validate iOS prerequisites and resolve Swift Package Manager deps before Xcode opens.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const mobileDir = path.join(__dirname, '..');
const projectDir = path.join(mobileDir, 'ios', 'App');
const capAppSpm = path.join(projectDir, 'CapApp-SPM', 'Package.swift');
const capacitorApp = path.join(mobileDir, 'node_modules', '@capacitor', 'app', 'Package.swift');

function fail(message) {
  console.error(`\n❌ iOS setup failed: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(capAppSpm)) {
  fail('CapApp-SPM/Package.swift is missing. Run: npm run cap:sync:ios');
}

if (!fs.existsSync(capacitorApp)) {
  fail(
    'node_modules is missing or incomplete.\n' +
    '   Run from the mobile folder:\n' +
    '     cd mobile\n' +
    '     npm install\n' +
    '     npm run cap:ios'
  );
}

if (process.platform !== 'darwin') {
  console.log('resolve-ios-packages: prerequisites OK (package resolve runs on macOS only)');
  process.exit(0);
}

console.log('Resolving Swift packages (CapApp-SPM)...');
try {
  execSync(
    'xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App',
    { cwd: projectDir, stdio: 'inherit' }
  );
  console.log('Swift packages resolved.');
} catch (_) {
  fail(
    'Could not resolve Swift packages.\n' +
    '   In Xcode: File → Packages → Reset Package Caches\n' +
    '   Then: File → Packages → Resolve Package Versions\n' +
    '   Make sure you ran npm install before opening Xcode.'
  );
}
