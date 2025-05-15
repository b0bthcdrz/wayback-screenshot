#!/usr/bin/env node

import fetch from 'node-fetch';
import fs from 'fs';
import puppeteer from 'puppeteer';
import path from 'path';
import os from 'os';
import { program } from 'commander';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIG ---
const TARGET_URL = 'https://interpals.net';
const FROM_DATE = '19990101'; // Format: YYYYMMDD
const TO_DATE = '20251231';
const SCREENSHOT_DIR = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/screenshots');
const CONCURRENT_SCREENSHOTS = 1; // Process one at a time to avoid overwhelming the server
const IMAGE_LOAD_TIMEOUT = 30000; // 30 seconds timeout for image loading
const PAGE_LOAD_TIMEOUT = 60000; // 60 seconds timeout for page load
const MAX_RETRIES = 3; // Maximum number of retries for failed requests
const INITIAL_RETRY_DELAY = 10000; // Initial delay between retries (10 seconds)
const REQUEST_DELAY = 5000; // Delay between requests (5 seconds)

// Helper function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function for exponential backoff
const getRetryDelay = (attempt) => INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);

async function getSnapshots(url, from, to) {
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
    url
  )}&from=${from}&to=${to}&output=json&fl=timestamp,original&filter=statuscode:200`;
  console.log(`[CDX] Fetching snapshots: ${cdxUrl}`);
  const res = await fetch(cdxUrl);
  if (!res.ok) throw new Error(`[CDX] Fetch error: ${res.statusText}`);
  const data = await res.json();
  console.log(`[CDX] Found ${data.length - 1} snapshots.`);
  return data.slice(1); // Skip header row
}

async function takeScreenshot(url, timestamp, idx, total) {
  console.log(`\n[${idx + 1}/${total}] Starting screenshot process for ${timestamp}`);
  
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    console.log(`  📁 Creating screenshots directory: ${SCREENSHOT_DIR}`);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  const filename = path.join(SCREENSHOT_DIR, `${timestamp}.png`);
  
  // Skip if file already exists
  if (fs.existsSync(filename)) {
    console.log(`  ⏩ Skipping existing file: ${filename}`);
    return;
  }

  let retries = 0;
  while (retries < MAX_RETRIES) {
    console.log(`  🚀 Launching browser (attempt ${retries + 1}/${MAX_RETRIES})...`);
    const browser = await puppeteer.launch({ 
      headless: 'new',
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-experiments',
        '--safebrowsing-disable-auto-update'
      ]
    });
    const page = await browser.newPage();
    console.log('  🌐 Setting up page...');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    const archiveUrl = `https://web.archive.org/web/${timestamp}/${url.replace(/^https?:\/\//, '')}`;
    
    try {
      console.log(`  📍 Setting viewport for year ${timestamp.substring(0, 4)}...`);
      const year = parseInt(timestamp.substring(0, 4));
      const viewportWidth = year <= 2008 ? 1024 : 1366;
      await page.setViewport({ width: viewportWidth, height: 768 });
      
      console.log('  🔄 Setting up request interception...');
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          request.continue();
        } else {
          request.continue();
        }
      });

      console.log(`  ⏳ Waiting ${REQUEST_DELAY/1000} seconds before request...`);
      await delay(REQUEST_DELAY);

      console.log('  🌐 Loading page (first attempt with networkidle0)...');
      try {
        await page.goto(archiveUrl, { 
          waitUntil: 'networkidle0', 
          timeout: PAGE_LOAD_TIMEOUT 
        });
      } catch (e) {
        console.log('  ⚠️ First load attempt failed, trying with domcontentloaded...');
        await page.goto(archiveUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: PAGE_LOAD_TIMEOUT 
        });
      }

      console.log('  🔍 Checking page load status...');
      const pageTitle = await page.title();
      console.log(`  📄 Page title: ${pageTitle}`);
      if (!pageTitle || pageTitle.includes('Error') || pageTitle.includes('Not Found')) {
        throw new Error(`Page failed to load properly. Title: ${pageTitle}`);
      }

      console.log('  🖼️ Optimizing image loading...');
      await page.evaluate(() => {
        const fixWaybackUrls = () => {
          const timestamp = window.location.pathname.split('/')[2];
          const baseUrl = `https://web.archive.org/web/${timestamp}/`;
          document.querySelectorAll('img').forEach(img => {
            if (img.src.startsWith('http')) {
              const originalUrl = img.src.replace(/^https?:\/\/web\.archive\.org\/web\/\d+\//, '');
              img.src = `${baseUrl}${originalUrl}`;
            }
          });
        };
        fixWaybackUrls();
      });

      console.log('  ⏳ Waiting for images to load...');
      await Promise.race([
        page.evaluate(() => {
          return Promise.all(
            Array.from(document.images)
              .map(img => new Promise(resolve => {
                if (img.complete) {
                  resolve();
                } else {
                  img.onload = img.onerror = resolve;
                }
              }))
          );
        }),
        new Promise(resolve => setTimeout(resolve, IMAGE_LOAD_TIMEOUT))
      ]);

      console.log('  🧹 Removing toolbar...');
      await page.evaluate(() => {
        const toolbarStart = document.evaluate('//comment()[contains(., "BEGIN WAYBACK TOOLBAR INSERT")]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        const toolbarEnd = document.evaluate('//comment()[contains(., "END WAYBACK TOOLBAR INSERT")]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (toolbarStart && toolbarEnd) {
          let node = toolbarStart.nextSibling;
          while (node && node !== toolbarEnd) {
            const nextNode = node.nextSibling;
            node.remove();
            node = nextNode;
          }
          toolbarStart.remove();
          toolbarEnd.remove();
        }
      });

      console.log('  📸 Taking screenshot...');
      await page.screenshot({ path: filename, fullPage: true, captureBeyondViewport: true });
      console.log(`  ✅ Successfully saved: ${filename}`);
      await browser.close();
      return; // Success, exit the retry loop
    } catch (e) {
      console.error(`  ❌ Error (attempt ${retries + 1}/${MAX_RETRIES}):`, e.message);
      await browser.close();
      retries++;
      if (retries < MAX_RETRIES) {
        const retryDelay = getRetryDelay(retries);
        console.log(`  ⏳ Retrying in ${retryDelay/1000} seconds...`);
        await delay(retryDelay);
      }
    }
  }
  console.error(`  ❌ Failed after ${MAX_RETRIES} attempts`);
}

async function processBatch(snapshots, startIdx, batchSize) {
  console.log(`\n🔄 Processing batch starting at index ${startIdx}`);
  const batch = snapshots.slice(startIdx, startIdx + batchSize);
  await Promise.all(batch.map(([timestamp, originalUrl], idx) => 
    takeScreenshot(originalUrl, timestamp, startIdx + idx, snapshots.length)
  ));
}

async function main() {
  console.log('🚀 Starting Wayback Machine screenshot capture');
  console.log(`📅 Date range: ${FROM_DATE} to ${TO_DATE}`);
  console.log(`🎯 Target URL: ${TARGET_URL}`);
  
  const snapshots = await getSnapshots(TARGET_URL, FROM_DATE, TO_DATE);
  const monthlySnapshots = {};
  snapshots.forEach(([timestamp, originalUrl]) => {
    const month = timestamp.substring(0, 6); // YYYYMM
    if (!monthlySnapshots[month]) {
      monthlySnapshots[month] = [timestamp, originalUrl];
    }
  });
  const monthlySnapshotsList = Object.values(monthlySnapshots);
  console.log(`📊 Found ${monthlySnapshotsList.length} unique months to capture`);
  
  // Process snapshots in batches
  for (let i = 0; i < monthlySnapshotsList.length; i += CONCURRENT_SCREENSHOTS) {
    await processBatch(monthlySnapshotsList, i, CONCURRENT_SCREENSHOTS);
  }
  
  console.log('\n✨ Screenshot capture complete!');
}

// Add command-line argument parsing
program
  .name('wayback-screenshot')
  .description('Capture screenshots from the Wayback Machine for a given date range')
  .argument('<url>', 'URL to capture')
  .argument('<startDate>', 'Start date (YYYY-MM-DD)')
  .argument('<endDate>', 'End date (YYYY-MM-DD)')
  .option('-o, --output <directory>', 'Output directory', './screenshots')
  .option('-i, --interval <months>', 'Interval between captures in months', '1')
  .option('-t, --timeout <ms>', 'Timeout for page load in milliseconds', '30000')
  .option('-r, --retries <count>', 'Number of retries for failed captures', '3')
  .option('-d, --delay <ms>', 'Delay between retries in milliseconds', '5000')
  .parse();

const options = program.opts();

// Convert command line arguments to the expected format
const url = program.args[0];
const startDate = new Date(program.args[1]);
const endDate = new Date(program.args[2]);
const outputDir = options.output;
const intervalMonths = parseInt(options.interval);
const timeout = parseInt(options.timeout);
const maxRetries = parseInt(options.retries);
const retryDelay = parseInt(options.delay);

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Run the main function with the parsed arguments
captureWaybackScreenshots(
  url,
  startDate,
  endDate,
  outputDir,
  intervalMonths,
  timeout,
  maxRetries,
  retryDelay
).catch(console.error);
