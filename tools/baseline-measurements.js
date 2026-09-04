#!/usr/bin/env node

/**
 * Baseline Performance Measurements for College OS
 * Tests homepage on mobile and desktop with Lighthouse
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:3000';
const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'baseline');

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

async function runLighthouse(url, formFactor) {
  console.log(`\n📊 Running Lighthouse audit for ${formFactor}...`);
  
  const reportPath = path.join(
    REPORTS_DIR,
    `baseline-${formFactor}-${new Date().toISOString().slice(0, 10)}.json`
  );

  try {
    const command = `lighthouse ${url} --form-factor=${formFactor} --output=json --output-path="${reportPath}" --chrome-flags="--headless --no-sandbox"`;
    
    console.log(`Running: ${command}`);
    execSync(command, { 
      stdio: 'inherit',
      timeout: 60000 
    });
    
    return reportPath;
  } catch (error) {
    console.error(`Failed to run Lighthouse for ${formFactor}:`, error.message);
    return null;
  }
}

async function parseReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    return null;
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const audits = report.audits;
  
  return {
    url: report.finalUrl,
    fetchTime: report.fetchTime,
    metrics: {
      // Lighthouse scores (0-100)
      performance: Math.round((report.categories.performance?.score || 0) * 100),
      accessibility: Math.round((report.categories.accessibility?.score || 0) * 100),
      bestPractices: Math.round((report.categories['best-practices']?.score || 0) * 100),
      seo: Math.round((report.categories.seo?.score || 0) * 100),
      
      // Core Web Vitals
      lcp: audits['largest-contentful-paint']?.numericValue,
      cls: audits['cumulative-layout-shift']?.numericValue,
      inp: audits['interaction-to-next-paint']?.numericValue,
      tbt: audits['total-blocking-time']?.numericValue,
      fcp: audits['first-contentful-paint']?.numericValue,
      tti: audits['interactive']?.numericValue,
    },
    opportunities: {
      unusedCss: audits['unused-css-rules']?.numericValue,
      unusedJs: audits['unused-javascript']?.numericValue,
      unminifiedCss: audits['unminified-css']?.numericValue,
      unminifiedJs: audits['unminified-javascript']?.numericValue,
      offscreenImages: audits['offscreen-images']?.numericValue,
      modernImageFormats: audits['modern-image-formats']?.numericValue,
      efficientAnimatedContent: audits['efficient-animated-content']?.numericValue,
      unoptimizedImages: audits['uses-optimized-images']?.numericValue,
      oversizedImages: audits['oversized-images']?.numericValue,
    },
    diagnostics: {
      totalByteWeight: audits['total-byte-weight']?.numericValue,
      documentSize: audits['resource-summary']?.details?.items?.[0]?.size || 0,
      scriptSize: audits['resource-summary']?.details?.items?.find(item => item.label === 'Script')?.size || 0,
      stylesheetSize: audits['resource-summary']?.details?.items?.find(item => item.label === 'Stylesheet')?.size || 0,
      imageSize: audits['resource-summary']?.details?.items?.find(item => item.label === 'Image')?.size || 0,
      mediaSize: audits['resource-summary']?.details?.items?.find(item => item.label === 'Media')?.size || 0,
      fontSize: audits['resource-summary']?.details?.items?.find(item => item.label === 'Font')?.size || 0,
    },
    requestCounts: audits['resource-summary']?.details?.items || [],
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatMilliseconds(ms) {
  if (!ms) return 'N/A';
  return (ms / 1000).toFixed(2) + 's';
}

function printMetrics(formFactor, metrics) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📈 ${formFactor.toUpperCase()} BASELINE METRICS`);
  console.log(`${'='.repeat(60)}`);
  
  console.log(`\n🎯 Lighthouse Scores:`);
  console.log(`  Performance:    ${metrics.metrics.performance}/100`);
  console.log(`  Accessibility:  ${metrics.metrics.accessibility}/100`);
  console.log(`  Best Practices: ${metrics.metrics.bestPractices}/100`);
  console.log(`  SEO:            ${metrics.metrics.seo}/100`);
  
  console.log(`\n⚡ Core Web Vitals:`);
  console.log(`  LCP (Largest Contentful Paint):  ${formatMilliseconds(metrics.metrics.lcp)}`);
  console.log(`  FCP (First Contentful Paint):    ${formatMilliseconds(metrics.metrics.fcp)}`);
  console.log(`  CLS (Cumulative Layout Shift):   ${(metrics.metrics.cls || 0).toFixed(3)}`);
  console.log(`  INP (Interaction to Next Paint): ${formatMilliseconds(metrics.metrics.inp)}`);
  console.log(`  TBT (Total Blocking Time):       ${formatMilliseconds(metrics.metrics.tbt)}`);
  console.log(`  TTI (Time to Interactive):       ${formatMilliseconds(metrics.metrics.tti)}`);
  
  console.log(`\n📊 Asset Size Breakdown:`);
  console.log(`  Total:      ${formatBytes(metrics.diagnostics.totalByteWeight)}`);
  console.log(`  Scripts:    ${formatBytes(metrics.diagnostics.scriptSize)}`);
  console.log(`  Stylesheets: ${formatBytes(metrics.diagnostics.stylesheetSize)}`);
  console.log(`  Images:     ${formatBytes(metrics.diagnostics.imageSize)}`);
  console.log(`  Media:      ${formatBytes(metrics.diagnostics.mediaSize)}`);
  console.log(`  Fonts:      ${formatBytes(metrics.diagnostics.fontSize)}`);
  
  console.log(`\n📦 Request Counts:`);
  metrics.requestCounts.forEach(item => {
    if (item.label && item.requestCount !== undefined) {
      console.log(`  ${item.label}: ${item.requestCount} requests`);
    }
  });
  
  console.log(`\n💡 Optimization Opportunities (Potential Savings):`);
  if (metrics.opportunities.offscreenImages) {
    console.log(`  Offscreen Images: ${formatBytes(metrics.opportunities.offscreenImages)}`);
  }
  if (metrics.opportunities.modernImageFormats) {
    console.log(`  Modern Image Formats: ${formatBytes(metrics.opportunities.modernImageFormats)}`);
  }
  if (metrics.opportunities.unminifiedCss) {
    console.log(`  Unminified CSS: ${formatBytes(metrics.opportunities.unminifiedCss)}`);
  }
  if (metrics.opportunities.unminifiedJs) {
    console.log(`  Unminified JS: ${formatBytes(metrics.opportunities.unminifiedJs)}`);
  }
  if (metrics.opportunities.unusedCss) {
    console.log(`  Unused CSS: ${formatBytes(metrics.opportunities.unusedCss)}`);
  }
  if (metrics.opportunities.unusedJs) {
    console.log(`  Unused JS: ${formatBytes(metrics.opportunities.unusedJs)}`);
  }
  if (metrics.opportunities.oversizedImages) {
    console.log(`  Oversized Images: ${formatBytes(metrics.opportunities.oversizedImages)}`);
  }
}

async function main() {
  console.log('🚀 College OS Baseline Performance Measurements');
  console.log(`📍 URL: ${URL}`);
  console.log(`📅 Time: ${new Date().toISOString()}`);
  
  // Test mobile
  const mobileReportPath = await runLighthouse(URL, 'mobile');
  const mobileMetrics = mobileReportPath ? await parseReport(mobileReportPath) : null;
  
  // Test desktop
  const desktopReportPath = await runLighthouse(URL, 'desktop');
  const desktopMetrics = desktopReportPath ? await parseReport(desktopReportPath) : null;
  
  // Print summary
  if (mobileMetrics) printMetrics('mobile', mobileMetrics);
  if (desktopMetrics) printMetrics('desktop', desktopMetrics);
  
  // Save summary
  const summary = {
    timestamp: new Date().toISOString(),
    url: URL,
    mobile: mobileMetrics,
    desktop: desktopMetrics,
    reportPaths: {
      mobile: mobileReportPath,
      desktop: desktopReportPath
    }
  };
  
  const summaryPath = path.join(REPORTS_DIR, `baseline-summary-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n✅ Summary saved to: ${summaryPath}`);
  console.log(`📊 Reports saved to: ${REPORTS_DIR}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
