# SEO Canonical Check

A tool for auditing canonical tags across websites by processing URLs from XML sitemaps.

## Overview

This tool helps SEO professionals and web developers audit canonical tags across a website by:

1. Fetching URLs from XML sitemaps
2. Checking each URL for canonical tag implementation issues
3. Generating detailed CSV reports with results

The tool checks for various canonical tag issues including:

- Missing canonical tags
- Multiple canonical tags
- Empty canonical tags
- Canonical tags not in the head section
- Canonical URLs returning non-200 status codes
- Canonical URLs that redirect
- Canonical URLs that are not absolute
- Canonical URLs using different domains or protocols
- Canonical URLs that are not lowercase

## URL Normalization

The tool intelligently handles URL variations by normalizing URLs before comparison:

- Removing trailing slashes (except for domain root)
- Converting to lowercase
- Removing default ports (80 for HTTP, 443 for HTTPS)
- Removing 'www.' subdomain
- Removing query parameters and hash fragments

This means that URLs like `https://example.com/page/` and `https://example.com/page` are treated as equivalent.

## Requirements

- Node.js (v22 or higher)
- npm or yarn

## Installation

1. Clone this repository:

```
git clone https://github.com/yourusername/seo-canonical-check.git
cd seo-canonical-check
```

2. Install dependencies:

```
npm install
```

## Configuration

Edit the `config.json` file to specify the sitemaps you want to check:

```json
{
  "sitemapUrls": ["https://www.example.com/sitemap.xml"]
}
```

## Usage

Run the tool with:

```
node canonical.js
```

Or use the npm script:

```
npm start
```

## Output

The tool will:

1. Display progress in the console, showing:

   - Number of URLs found in the sitemap
   - Current URL being processed (e.g., "Processing URL 5/67: https://example.com/page")
   - Completion percentage

2. Generate CSV reports in the `results/[domain]/` directory with:
   - URL checked
   - Status (OK or FAIL)
   - Explanation of any issues found
   - Summary statistics

Example output:

```
Starting canonical audit for: sitemap on example.com
Fetching sitemap from: https://example.com/sitemap.xml
Sitemap fetched successfully. Found 67 URLs to check.
Processing URL 1/67: https://example.com/page1
...
Completed 67/67 (100%)
Results saved to: results/example.com/sitemap_20250312210307.csv
Audit completed for sitemap:
  ✅ OK: 50
  ❌ FAIL (Canonical Issues): 17
  🔢 Total Checked: 67
```

## Example Report

The CSV report will contain:

```
URL,Status,Explanation
https://example.com/page1,OK,"No errors"
https://example.com/page2,FAIL,"Canonical tag is missing."
...

Total URLs Checked: 67
Total OK: 50
Total FAIL (Canonical Issues): 17
```
