import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { fileURLToPath } from 'url';

// Note: This is using JSDOM instead of Puppeteer to check canonical tags

// Function to load the config file
function loadConfig() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const configPath = path.join(__dirname, 'config.json');
  const configData = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(configData);
}

// Helper function to extract domain name from sitemap URL
function getDomainName(url) {
  return new URL(url).hostname;
}

// Helper function to extract sitemap name from URL
function getSitemapName(url) {
  return url.replace(/^https?:\/\/[^\/]+\/|\.xml$/g, '').replace(/\//g, '-');
}

// Function to get the current timestamp
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[-T:]/g, '').split('.')[0]; // YYYYMMDD_HHMMSS
}

// Helper function to normalize URLs for comparison
function normalizeUrl(url) {
  try {
    // Parse the URL
    const parsedUrl = new URL(url);

    // Convert to lowercase
    let normalized = parsedUrl.toString().toLowerCase();

    // Remove trailing slash if present (except for domain root)
    if (normalized.endsWith('/') && parsedUrl.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }

    // Remove default ports (80 for http, 443 for https)
    normalized = normalized.replace(':80/', '/').replace(':443/', '/');

    // Remove www. if present
    normalized = normalized.replace('://www.', '://');

    // Remove query parameters
    const urlWithoutQuery = normalized.split('?')[0];

    // Remove hash fragments
    const urlWithoutHash = urlWithoutQuery.split('#')[0];

    return urlWithoutHash;
  } catch (error) {
    console.error(`Error normalizing URL ${url}: ${error.message}`);
    return url;
  }
}

// Function to check if two URLs are semantically equivalent
function areUrlsEquivalent(url1, url2) {
  return normalizeUrl(url1) === normalizeUrl(url2);
}

// Function to fetch sitemap and parse URLs
async function fetchSitemapUrls(sitemapUrl) {
  console.log(`Fetching sitemap from: ${sitemapUrl}`);
  const response = await fetch(sitemapUrl);
  const xml = await response.text();
  const result = await parseStringPromise(xml);
  const urls = result.urlset.url.map((urlObj) => urlObj.loc[0]);
  console.log(
    `Sitemap fetched successfully. Found ${urls.length} URLs to check.`
  );
  return urls;
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

    if (canonicalLinks.length === 0) {
      status = 'FAIL';
      explanation += 'Canonical tag is missing. ';
    } else {
      if (canonicalLinks.length > 1) {
        status = 'FAIL';
        explanation += 'Multiple canonical tags detected. ';
      }

      const canonicalLink = canonicalLinks[0];
      const href = canonicalLink.getAttribute('href');

      if (!href) {
        status = 'FAIL';
        explanation += 'Canonical tag is empty. ';
      } else {
        const canonicalUrl = new URL(href, url).toString();

        if (!canonicalLink.closest('head')) {
          status = 'FAIL';
          explanation += 'Canonical tag is not in the head section. ';
        }

        try {
          const canonicalResponse = await fetch(canonicalUrl);
          if (canonicalResponse.status !== 200) {
            status = 'FAIL';
            explanation += `Canonical URL returned status ${canonicalResponse.status}. `;
          }

          if ([301, 302, 307, 308].includes(canonicalResponse.status)) {
            status = 'FAIL';
            explanation += 'Canonical URL is redirecting. ';
          }
        } catch (error) {
          status = 'FAIL';
          explanation += `Error fetching canonical URL: ${error.message}. `;
        }

        // Check if canonical URL and page URL are on different domains
        if (new URL(url).hostname !== new URL(canonicalUrl).hostname) {
          status = 'FAIL';
          explanation += 'Canonical URL uses a different domain. ';
        }

        // Check if canonical URL and page URL use different protocols
        if (new URL(url).protocol !== new URL(canonicalUrl).protocol) {
          status = 'FAIL';
          explanation += 'Canonical URL uses a different protocol. ';
        }

        // Check if canonical URL is absolute
        if (
          !canonicalUrl.startsWith('http://') &&
          !canonicalUrl.startsWith('https://')
        ) {
          status = 'FAIL';
          explanation += 'Canonical URL is not absolute. ';
        }

        // Check if canonical URL is lowercase
        if (canonicalUrl !== canonicalUrl.toLowerCase()) {
          status = 'FAIL';
          explanation += 'Canonical URL is not lowercase. ';
        }
      }
    }

    console.log(`Completed check for URL: ${url}`);
    return {
      url,
      status,
      explanation: explanation.trim() || 'No errors',
    };
  } catch (error) {
    console.error(`Error checking URL: ${url} - ${error.message}`);
    return {
      url,
      status: 'FAIL',
      explanation: `Fetch error: ${error.message}`,
    };
  }
}

// Function to save results to CSV
function saveResultsToCSV(results, domain, sitemapName) {
  const resultsDir = path.join('results', domain);
  fs.mkdirSync(resultsDir, { recursive: true });

  const timestamp = getTimestamp();
  const csvFilePath = path.join(resultsDir, `${sitemapName}_${timestamp}.csv`);

  let totalOK = 0;
  let totalFail = 0;

  const csvRows = ['URL,Status,Explanation'];
  results.forEach(({ url, status, explanation }) => {
    csvRows.push(`${url},${status},"${explanation}"`);
    if (status === 'OK') totalOK++;
    else totalFail++;
  });

  // Append summary
  csvRows.push(`\nTotal URLs Checked: ${results.length}`);
  csvRows.push(`Total OK: ${totalOK}`);
  csvRows.push(`Total FAIL (Canonical Issues): ${totalFail}`);

  fs.writeFileSync(csvFilePath, csvRows.join('\n'), 'utf8');
  console.log(`Results saved to: ${csvFilePath}`);

  return {
    totalOK,
    totalFail,
    totalChecked: results.length,
  };
}

// Main function to run the audit for multiple sitemaps
(async function runAudit() {
  const config = loadConfig();
  const sitemapUrls = config.sitemapUrls;
  let grandTotalOK = 0;
  let grandTotalFail = 0;
  let grandTotalChecked = 0;

  for (const sitemapUrl of sitemapUrls) {
    const domain = getDomainName(sitemapUrl);
    const sitemapName = getSitemapName(sitemapUrl);

    console.log(`Starting canonical audit for: ${sitemapName} on ${domain}`);
    const urls = await fetchSitemapUrls(sitemapUrl);

    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`Processing URL ${i + 1}/${urls.length}: ${url}`);
      results.push(await runCanonicalChecks(url));
      console.log(
        `Completed ${i + 1}/${urls.length} (${Math.round(
          ((i + 1) / urls.length) * 100
        )}%)`
      );
    }

    const { totalOK, totalFail, totalChecked } = saveResultsToCSV(
      results,
      domain,
      sitemapName
    );

    grandTotalOK += totalOK;
    grandTotalFail += totalFail;
    grandTotalChecked += totalChecked;

    console.log(`Audit completed for ${sitemapName}:`);
    console.log(`  ✅ OK: ${totalOK}`);
    console.log(`  ❌ FAIL (Canonical Issues): ${totalFail}`);
    console.log(`  🔢 Total Checked: ${totalChecked}`);
  }

  console.log('\n📊 Overall Summary');
  console.log(`  ✅ Total OK: ${grandTotalOK}`);
  console.log(`  ❌ Total FAIL (Canonical Issues): ${grandTotalFail}`);
  console.log(`  🔢 Grand Total URLs Checked: ${grandTotalChecked}`);
})();
