#!/usr/bin/env node
/** Write org.gradle.java.home into project gradle.properties (fixes stale jdk-17 in user ~/.gradle). */

const fs = require('fs');
const path = require('path');

const androidDir = path.join(__dirname, '..', 'android');
const gradleProps = path.join(androidDir, 'gradle.properties');
const javaHome = process.env.JAVA_HOME;

if (!javaHome) {
  console.error('JAVA_HOME not set');
  process.exit(1);
}

const javaExe = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
if (!fs.existsSync(javaExe)) {
  console.error('Invalid JAVA_HOME:', javaHome);
  process.exit(1);
}

const fwd = javaHome.replace(/\\/g, '/');
let content = fs.existsSync(gradleProps) ? fs.readFileSync(gradleProps, 'utf8') : '';
const lines = content.split(/\r?\n/).filter((l) => !/^org\.gradle\.java\.home=/.test(l));
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
lines.push(`org.gradle.java.home=${fwd}`);
lines.push('');
fs.writeFileSync(gradleProps, lines.join('\n'));
console.log('Set org.gradle.java.home=' + fwd);
