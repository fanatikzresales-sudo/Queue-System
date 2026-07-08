#!/usr/bin/env node
/**
 * cap sync ios only registers npm Capacitor plugins in packageClassList.
 * Local Swift plugins in ios/App/App/ must be appended manually.
 */
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../ios/App/App/capacitor.config.json');
if (!fs.existsSync(configPath)) {
  console.warn('patch-ios-plugins: capacitor.config.json not found (run npx cap sync ios first)');
  process.exit(0);
}

const extraPlugins = ['AppSettingsPlugin'];
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const list = Array.isArray(config.packageClassList) ? config.packageClassList.slice() : [];

for (const name of extraPlugins) {
  if (!list.includes(name)) {
    list.push(name);
  }
}

config.packageClassList = list;
fs.writeFileSync(configPath, `${JSON.stringify(config, null, '\t')}\n`);
console.log('patch-ios-plugins: registered', extraPlugins.join(', '));
