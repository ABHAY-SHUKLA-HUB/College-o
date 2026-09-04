#!/usr/bin/env node

/**
 * Parse Lighthouse report and extract key metrics
 */

const fs = require('fs');
const path = require('path');

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: node parse-report.js <report-path>');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const audits = report.audits;
const categories = report.categories;

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(ms) {
  if (!ms) return 'N/A';
  return (ms / 1000).toFixed(2) + 's';
}

console.log('\n' + '='.repeat(70));
console.log('LIGHTHOUSE REPORT SUMMARY');
console.log('='.repeat(70));

console.log('\n📊 SCORES:');
console.log(`  Performance:    ${Math.round(categories.performance.score * 100)}/100`);
console.log(`  Accessibility:  ${Math.round(categories.accessibility.score * 100)}/100`);
console.log(`  Best Practices: ${Math.round(categories['best-practices'].score * 100)}/100`);
console.log(`  SEO:            ${Math.round(categories.seo.score * 100)}/100`);

console.log('\n⚡ CORE WEB VITALS:');
console.log(`  LCP: ${formatTime(audits['largest-contentful-paint']?.numericValue)} (score: ${(audits['largest-contentful-paint']?.score * 100).toFixed(1)}/100)`);
console.log(`  FCP: ${formatTime(audits['first-contentful-paint']?.numericValue)} (score: ${(audits['first-contentful-paint']?.score * 100).toFixed(1)}/100)`);
console.log(`  CLS: ${(audits['cumulative-layout-shift']?.numericValue || 0).toFixed(3)} (score: ${(audits['cumulative-layout-shift']?.score * 100).toFixed(1)}/100)`);
console.log(`  INP: ${formatTime(audits['interaction-to-next-paint']?.numericValue)}`);
console.log(`  TBT: ${formatTime(audits['total-blocking-time']?.numericValue)}`);
console.log(`  TTI: ${formatTime(audits['interactive']?.numericValue)}`);

console.log('\n📦 RESOURCE SUMMARY:');
const summary = audits['resource-summary']?.details?.items || [];
summary.forEach(item => {
  if (item.label && item.requestCount !== undefined) {
    console.log(`  ${item.label}: ${item.requestCount} requests, ${formatBytes(item.size)}`);
  }
});

const totalBytes = audits['total-byte-weight']?.numericValue || 0;
console.log(`  TOTAL: ${formatBytes(totalBytes)}`);

console.log('\n💡 TOP OPTIMIZATION OPPORTUNITIES:');
const opportunities = [
  { key: 'offscreen-images', label: 'Offscreen images' },
  { key: 'modern-image-formats', label: 'Modern image formats' },
  { key: 'unminified-css', label: 'Unminified CSS' },
  { key: 'unminified-javascript', label: 'Unminified JS' },
  { key: 'unused-css-rules', label: 'Unused CSS' },
  { key: 'unused-javascript', label: 'Unused JS' },
  { key: 'oversized-images', label: 'Oversized images' }
];

opportunities.forEach(opp => {
  const value = audits[opp.key]?.numericValue;
  if (value && value > 0) {
    console.log(`  ${opp.label}: ${formatBytes(value)}`);
  }
});

console.log('\n');
