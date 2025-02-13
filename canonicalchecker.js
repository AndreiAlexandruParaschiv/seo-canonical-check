import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

// Note: This is using Puppeteer to check canonical tags

// Load config file
function loadConfig() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configPath = path.join(__dirname, 'config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
}

// Extract base domain from a URL
function getBaseDomain(url) {
    return new URL(url).hostname;
}

// Generate a timestamp for folder/file naming
function getTimestamp() {
    return new Date().toISOString().replace(/[-T:]/g, '').split('.')[0]; // YYYYMMDD_HHMMSS
}

// Fetch sitemap and extract URLs
async function fetchSitemapUrls(sitemapUrl) {
    console.log(`Fetching sitemap from: ${sitemapUrl}`);
    const response = await fetch(sitemapUrl);
    const xml = await response.text();
    const result = await parseStringPromise(xml);
    return result.urlset.url.map((urlObj) => urlObj.loc[0]);
}

// Run canonical checks for a given URL
async function runCanonicalChecks(url) {
    let browser;
    try {
        console.log(`Checking URL: ${url}`);
        browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });

        const canonicalLinks = await page.evaluate(() =>
            Array.from(document.querySelectorAll('link[rel="canonical"]')).map(link => link.href)
        );

        let status = 'OK';
        let explanation = '';

        if (canonicalLinks.length === 0) {
            status = 'FAIL';
            explanation += 'Canonical tag is missing. ';
        } else if (canonicalLinks.length > 1) {
            status = 'FAIL';
            explanation += 'Multiple canonical tags detected. ';
        } else {
            const canonicalUrl = canonicalLinks[0];
            if (!canonicalUrl) {
                status = 'FAIL';
                explanation += 'Canonical tag is empty. ';
            } else {
                try {
                    const canonicalResponse = await fetch(canonicalUrl);
                    if (canonicalResponse.status !== 200) {
                        status = 'FAIL';
                        explanation += `Canonical URL returned status ${canonicalResponse.status}. `;
                    }
                } catch (error) {
                    status = 'FAIL';
                    explanation += `Error fetching canonical URL: ${error.message}. `;
                }

                if (canonicalUrl !== url) {
                    status = 'FAIL';
                    explanation += 'Canonical URL does not reference itself. ';
                }
            }
        }

        return { url, status, explanation: explanation.trim() || 'No errors' };
    } catch (error) {
        return { url, status: 'FAIL', explanation: `Fetch error: ${error.message}` };
    } finally {
        if (browser) await browser.close();
    }
}

// Save results to CSV inside a structured directory
function saveResultsToCSV(results, sitemapName, totalChecked, totalOK, totalFail) {
    const timestamp = getTimestamp();
    const resultsDir = path.join('resultscanonical', `${sitemapName}_${timestamp}`);
    fs.mkdirSync(resultsDir, { recursive: true });

    const csvFilePath = path.join(resultsDir, 'canonical_check_results.csv');
    const csvRows = ['URL,Status,Explanation'];

    results.forEach(({ url, status, explanation }) => {
        csvRows.push(`${url},${status},"${explanation}"`);
    });

    csvRows.push(`\nTotal URLs Checked: ${totalChecked}`);
    csvRows.push(`Total OK: ${totalOK}`);
    csvRows.push(`Total FAIL (Canonical Issues): ${totalFail}`);

    fs.writeFileSync(csvFilePath, csvRows.join('\n'), 'utf8');
    console.log(`Results saved to: ${csvFilePath}`);
}

// Main function to audit multiple sitemaps
(async function runAudit() {
    const config = loadConfig();
    const sitemapUrls = config.sitemapUrls;

    let grandTotalOK = 0;
    let grandTotalFail = 0;
    let grandTotalChecked = 0;

    for (const sitemapUrl of sitemapUrls) {
        const baseDomain = getBaseDomain(sitemapUrl);
        const sitemapName = path.basename(sitemapUrl, '.xml');

        console.log(`\n🚀 Starting audit for: ${sitemapName} (${baseDomain})`);
        const urls = await fetchSitemapUrls(sitemapUrl);

        let totalOK = 0;
        let totalFail = 0;
        const results = [];

        for (const url of urls) {
            const result = await runCanonicalChecks(url);
            result.status === 'OK' ? totalOK++ : totalFail++;
            results.push(result);
        }

        const totalChecked = urls.length;
        saveResultsToCSV(results, sitemapName, totalChecked, totalOK, totalFail);

        // Per-sitemap summary
        console.log(`\n📌 Audit completed for ${sitemapName}:`);
        console.log(`  ✅ OK: ${totalOK}`);
        console.log(`  ❌ FAIL (Canonical Issues): ${totalFail}`);
        console.log(`  🔢 Total Checked: ${totalChecked}`);

        grandTotalOK += totalOK;
        grandTotalFail += totalFail;
        grandTotalChecked += totalChecked;
    }

    // Final overall summary
    console.log('\n📊 Overall Summary');
    console.log(`  ✅ Total OK: ${grandTotalOK}`);
    console.log(`  ❌ Total FAIL (Canonical Issues): ${grandTotalFail}`);
    console.log(`  🔢 Grand Total URLs Checked: ${grandTotalChecked}`);
})();
