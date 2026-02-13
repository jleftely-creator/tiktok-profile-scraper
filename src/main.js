/**
 * TikTok Profile Scraper
 *
 * Extracts public profile metrics from TikTok accounts.
 *
 * Input:
 *   - usernames: Array of TikTok usernames (without @)
 *   - urls: Array of TikTok profile URLs
 *   - proxyConfiguration: Apify proxy settings
 *   - maxRetries: Maximum retry attempts (default: 3)
 *   - delayBetweenRequests: Delay between requests in ms (default: 1000)
 *
 * Output:
 *   - Profile data including followers, likes, videos, bio, region, engagement rate, etc.
 *   - Data quality score for each profile
 *   - Account age validation
 *   - Bio and bioLink extraction
 */

import { Actor } from 'apify';
import { TikTokAPI } from './api.js';

/**
 * Validate username format
 * TikTok usernames are alphanumeric, can contain dots and underscores
 * @param {string} username - Username to validate
 * @returns {boolean} - True if valid
 */
function isValidUsername(username) {
    if (!username || typeof username !== 'string') return false;
    if (username.length < 2 || username.length > 30) return false;
    // Allow letters, numbers, dots, underscores
    return /^[a-zA-Z0-9._]+$/.test(username);
}

/**
 * Clean and validate username input
 * @param {string} input - Raw username input
 * @returns {string|null} - Cleaned username or null
 */
function cleanUsername(input) {
    if (!input) return null;

    let username = String(input).trim().toLowerCase().replace(/^@+/, '');

    if (!isValidUsername(username)) {
        return null;
    }

    return username;
}

/**
 * Extract username from TikTok URL
 * Supports multiple URL formats:
 * - https://www.tiktok.com/@username
 * - https://m.tiktok.com/@username
 * - tiktok.com/@username
 *
 * @param {string} url - URL string
 * @returns {string|null} - Username or null
 */
function extractUsernameFromUrl(url) {
    if (!url || typeof url !== 'string') return null;

    try {
        // Extract @username from various TikTok URL formats
        const match = url.match(/(?:tiktok\.com|vm\.tiktok\.com)\/@([a-zA-Z0-9._]+)/i);
        if (match && match[1]) {
            return cleanUsername(match[1]);
        }

        // Try direct @username format
        const atMatch = url.match(/@([a-zA-Z0-9._]+)/);
        if (atMatch && atMatch[1]) {
            return cleanUsername(atMatch[1]);
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Validate data quality
 * Returns quality assessment and issues found
 *
 * @param {object} profile - Profile data
 * @returns {object} - Quality assessment
 */
function validateProfileQuality(profile) {
    const issues = [];

    // Check critical data
    if (!profile.bio) issues.push('missing_bio');
    if (!profile.bioLink && profile.bio && !profile.bioLink) issues.push('no_bio_link');
    if (!profile.region) issues.push('missing_region');
    if (profile.diggCount === null || profile.diggCount === 0) issues.push('missing_digg_count');

    // Check engagement rate
    if (profile.engagementRate === null) {
        issues.push('no_engagement_rate');
    } else if (isNaN(profile.engagementRate) || profile.engagementRate < 0) {
        issues.push('invalid_engagement_rate');
    }

    // Check account age
    if (profile.accountAgeDays === null) {
        issues.push('invalid_account_age');
    } else if (profile.accountAgeDays < 0) {
        issues.push('negative_account_age');
    }

    // Check timestamp
    if (!profile.createdAt) issues.push('missing_created_at');

    return {
        dataQualityScore: profile.dataQualityScore || 0,
        issueCount: issues.length,
        issues,
        hasWarnings: issues.length > 0,
    };
}

/**
 * Format profile for output
 * @param {object} profile - Profile data
 * @returns {object} - Formatted profile
 */
function formatProfileOutput(profile) {
    return {
        username: profile.username,
        nickname: profile.nickname,
        userId: profile.userId,
        secUid: profile.secUid,
        bio: profile.bio,
        verified: profile.verified,
        private: profile.private,
        avatarUrl: profile.avatarUrl,
        followers: profile.followers,
        following: profile.following,
        likes: profile.likes,
        videos: profile.videos,
        diggCount: profile.diggCount,
        engagementRate: profile.engagementRate,
        friendCount: profile.friendCount,
        createdAt: profile.createdAt,
        accountAgeDays: profile.accountAgeDays,
        language: profile.language,
        region: profile.region,
        isOrganization: profile.isOrganization,
        bioLink: profile.bioLink,
        bioLinks: profile.bioLinks,
        commerceUser: profile.commerceUser,
        ttSeller: profile.ttSeller,
        settings: profile.settings,
        profileTabs: profile.profileTabs,
        dataQualityScore: profile.dataQualityScore,
    };
}

// Main execution
await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    usernames = [],
    urls = [],
    proxyConfiguration,
    maxRetries = 3,
    delayBetweenRequests = 1000,
} = input;

// Validate input array sizes
if (Array.isArray(usernames) && usernames.length > 10000) {
    throw new Error('Too many usernames. Maximum 10,000 per run.');
}
if (Array.isArray(urls) && urls.length > 10000) {
    throw new Error('Too many URLs. Maximum 10,000 per run.');
}

// Validate input types
if (usernames && !Array.isArray(usernames)) {
    throw new Error('usernames must be an array');
}
if (urls && !Array.isArray(urls)) {
    throw new Error('urls must be an array');
}

// Collect and deduplicate usernames
const allUsernames = new Set();

// Add usernames from input
for (const username of usernames) {
    const cleaned = cleanUsername(username);
    if (cleaned) {
        allUsernames.add(cleaned);
    }
}

// Extract usernames from URLs
for (const url of urls) {
    const extracted = extractUsernameFromUrl(url);
    if (extracted) {
        allUsernames.add(extracted);
    }
}

const uniqueUsernames = Array.from(allUsernames);

if (uniqueUsernames.length === 0) {
    throw new Error('No valid usernames provided. Please provide usernames array or urls array.');
}

console.log(`Processing ${uniqueUsernames.length} unique TikTok profile(s)...`);

// Setup proxy if configured
let proxyUrl = null;
let proxyLocation = null;
if (proxyConfiguration) {
    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
    proxyUrl = await proxyConfig?.newUrl();
    proxyLocation = proxyConfiguration.apifyProxyGroups?.[0] || null;
}

// Initialize API client
const api = new TikTokAPI({
    proxy: proxyUrl,
    proxyLocation: proxyLocation,
});

// Initialize session (get cookies)
console.log('Initializing TikTok session...');
await api.initSession();

// Process each username
const results = [];
const errors = [];
const warnings = [];

for (const username of uniqueUsernames) {
    console.log(`Fetching profile: @${username}`);

    let lastError = null;
    let profile = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            profile = await api.scrapeUserProfile(username);
            break;
        } catch (error) {
            lastError = error;
            console.warn(`Attempt ${attempt}/${maxRetries} failed for @${username}: ${error.message}`);

            if (attempt < maxRetries) {
                // Exponential backoff
                const delay = delayBetweenRequests * Math.pow(2, attempt - 1);
                console.log(`Waiting ${delay}ms before retry...`);
                await new Promise(r => setTimeout(r, delay));

                // Reinitialize session on retry
                await api.initSession();
            }
        }
    }

    if (profile) {
        // Validate and assess data quality
        const quality = validateProfileQuality(profile);

        // Format output
        const outputProfile = formatProfileOutput(profile);

        // Add quality information to output
        const resultObject = {
            success: true,
            input: username,
            data: outputProfile,
            dataQuality: quality,
            scrapedAt: new Date().toISOString(),
        };

        results.push(resultObject);

        // Push to dataset
        await Actor.pushData({
            platform: 'tiktok',
            ...outputProfile,
            dataQuality: quality,
            scrapedAt: new Date().toISOString(),
        });

        // Log quality issues if any
        if (quality.hasWarnings) {
            warnings.push({
                username: username,
                issues: quality.issues,
                qualityScore: quality.dataQualityScore,
            });
            console.warn(`⚠ @${username}: ${quality.issueCount} data quality issue(s): ${quality.issues.join(', ')}`);
        } else {
            console.log(`✓ @${username}: ${profile.followers?.toLocaleString() || 'N/A'} followers, quality: ${quality.dataQualityScore}/100`);
        }
    } else {
        errors.push({
            username: username,
            error: lastError?.message || 'Unknown error',
            attemptsFailed: maxRetries,
        });

        console.error(`✗ @${username}: ${lastError?.message || 'Failed after all retries'}`);
    }

    // Delay between requests
    if (uniqueUsernames.indexOf(username) < uniqueUsernames.length - 1) {
        await new Promise(r => setTimeout(r, delayBetweenRequests));
    }
}

// Summary
console.log('\n--- Summary ---');
console.log(`Total processed: ${uniqueUsernames.length}`);
console.log(`Successful: ${results.length}/${uniqueUsernames.length}`);
console.log(`Failed: ${errors.length}/${uniqueUsernames.length}`);
console.log(`Warnings: ${warnings.length}/${results.length} (data quality issues)`);

if (errors.length > 0) {
    console.log('\nFailed profiles:');
    for (const err of errors) {
        console.log(`  - @${err.username}: ${err.error}`);
    }
}

if (warnings.length > 0) {
    console.log('\nProfiles with data quality warnings:');
    for (const warn of warnings) {
        console.log(`  - @${warn.username} (score: ${warn.qualityScore}/100): ${warn.issues.join(', ')}`);
    }
}

// Store summary in key-value store
await Actor.setValue('summary', {
    totalRequested: uniqueUsernames.length,
    successful: results.length,
    failed: errors.length,
    warnings: warnings.length,
    avgDataQualityScore: results.length > 0
        ? Math.round((results.reduce((sum, r) => sum + (r.data.dataQualityScore || 0), 0) / results.length) * 100) / 100
        : 0,
    errors: errors,
    warnings: warnings,
    completedAt: new Date().toISOString(),
});

await Actor.exit();
