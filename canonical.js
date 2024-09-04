import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { fileURLToPath } from 'url';

// Function to load the config file
function loadConfig() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const configPath = path.join(__dirname, 'config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
}

// Helper function to get the base domain from a URL
function getBaseDomain(url) {
    const { hostname } = new URL(url);
    return hostname;
}

// Function to get the current timestamp
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

// Function to fetch sitemap and parse URLs
async function fetchSitemapUrls(sitemapUrl) {
    console.log(`Fetching sitemap from: ${sitemapUrl}`);
    const response = await fetch(sitemapUrl);
    const xml = await response.text();
    const result = await parseStringPromise(xml);
    console.log('Sitemap fetched successfully.');
    return result.urlset.url.map((urlObj) => urlObj.loc[0]);
}

// Function to run canonical checks for each URL
async function runCanonicalChecks(url) {
    try {
        console.log(`Checking URL: ${url}`);
        const response = await fetch(url);
        const html = await response.text();
        const dom = new JSDOM(html);
        const { document } = dom.window;

        const canonicalLinks = document.querySelectorAll('link[rel="canonical"]');
        let status = 'OK';
        let explanation = '';

        // Check 1: Canonical tag exists
        if (canonicalLinks.length === 0) {
            status = 'FAIL';
            explanation += 'Canonical tag is missing. ';
        } else {
            // Check 2: Only one canonical tag
            if (canonicalLinks.length > 1) {
                status = 'FAIL';
                explanation += 'Multiple canonical tags detected. ';
            }

            const canonicalLink = canonicalLinks[0];
            const href = canonicalLink.getAttribute('href');

            // Check 3: Canonical tag is not empty
            if (!href) {
                status = 'FAIL';
                explanation += 'Canonical tag is empty. ';
            } else {
                const canonicalUrl = new URL(href, url).toString();

                // Check 4: Canonical tag is in the head section
                if (!canonicalLink.closest('head')) {
                    status = 'FAIL';
                    explanation += 'Canonical tag is not in the head section. ';
                }

                // Check 5: Canonical URL returns 200 status
                try {
                    const canonicalResponse = await fetch(canonicalUrl);
                    if (canonicalResponse.status !== 200) {
                        status = 'FAIL';
                        explanation += `Canonical URL returned status ${canonicalResponse.status}. `;
                    }

                    // Check 6: Canonical URL should not redirect
                    if ([301, 302, 307, 308].includes(canonicalResponse.status)) {
                        status = 'FAIL';
                        explanation += 'Canonical URL is redirecting. ';
                    }
                } catch (error) {
                    status = 'FAIL';
                    explanation += `Error fetching canonical URL: ${error.message}. `;
                }

                // Check 9: Canonical URL is self-referenced
                if (canonicalUrl !== url) {
                    status = 'FAIL';
                    explanation += 'Canonical URL does not reference itself. ';
                }

                // Check 10: Canonical URL is absolute
                if (!canonicalUrl.startsWith('http://') && !canonicalUrl.startsWith('https://')) {
                    status = 'FAIL';
                    explanation += 'Canonical URL is not absolute. ';
                }

                // Check 11: Canonical URL uses the same domain
                const urlDomain = new URL(url).hostname;
                const canonicalDomain = new URL(canonicalUrl).hostname;
                if (urlDomain !== canonicalDomain) {
                    status = 'FAIL';
                    explanation += 'Canonical URL uses a different domain. ';
                }

                // Check 12: Canonical URL uses the same protocol
                const urlProtocol = new URL(url).protocol;
                const canonicalProtocol = new URL(canonicalUrl).protocol;
                if (urlProtocol !== canonicalProtocol) {
                    status = 'FAIL';
                    explanation += 'Canonical URL uses a different protocol. ';
                }

                // Check 13: Canonical URL is lowercase
                if (canonicalUrl !== canonicalUrl.toLowerCase()) {
                    status = 'FAIL';
                    explanation += 'Canonical URL is not lowercase. ';
                }
            }
        }

        console.log(`Completed check for URL: ${url}`);
        return { url, status, explanation: explanation.trim() || 'No errors' };
    } catch (error) {
        console.error(`Error checking URL: ${url} - ${error.message}`);
        return { url, status: 'FAIL', explanation: `Fetch error: ${error.message}` };
    }
}

// Function to save results to CSV in a specific directory with a timestamp
function saveResultsToCSV(results, baseDomain, totalUrls, totalOK, totalFail) {
    // Create directories if they don't exist
    const resultsDir = path.join('results', baseDomain);
    fs.mkdirSync(resultsDir, { recursive: true });

    // Generate a timestamp for the file name
    const timestamp = getTimestamp();

    // Path to the output CSV file
    const csvFilePath = path.join(resultsDir, `canonical_check_results_${timestamp}.csv`);

    const csvRows = ['URL,Status,Explanation'];
    results.forEach(({ url, status, explanation }) => {
        csvRows.push(`${url},${status},"${explanation}"`);
    });
    csvRows.push(`\nTotal URLs Checked: ${totalUrls}`);
    csvRows.push(`Total OK: ${totalOK}`);
    csvRows.push(`Total Fail: ${totalFail}`);

    fs.writeFileSync(csvFilePath, csvRows.join('\n'), 'utf8');
    console.log(`Results saved to: ${csvFilePath}`);
}

// Main function to run the audit for multiple sitemaps
(async function runAudit() {
    // Load config
    const config = loadConfig();
    const sitemapUrls = config.sitemapUrls;

    for (const sitemapUrl of sitemapUrls) {
        const baseDomain = getBaseDomain(sitemapUrl);

        console.log(`Starting canonical audit for: ${baseDomain}`);
        const urls = await fetchSitemapUrls(sitemapUrl);

        let totalOK = 0;
        let totalFail = 0;
        const results = [];

        for (const url of urls) {
            const result = await runCanonicalChecks(url);
            if (result.status === 'OK') {
                totalOK += 1;
            } else {
                totalFail += 1;
            }
            results.push(result);
        }

        const totalUrls = urls.length;
        saveResultsToCSV(results, baseDomain, totalUrls, totalOK, totalFail);

        console.log(`Audit completed for ${baseDomain}: ${totalOK} OK, ${totalFail} Fail`);
    }
})();
