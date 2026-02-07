/**
 * TikTok Profile Scraper
 * 
 * Extracts public profile metrics from TikTok accounts.
 * 
 * Input:
 *   - usernames: Array of TikTok usernames (without @)
 *   - proxyConfiguration: Apify proxy settings
 * 
 * Output:
 *   - Profile data including followers, likes, videos, bio, etc.
 */

import { Actor } from 'apify';
import { TikTokAPI } from './api.js';

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    usernames = [],
    urls = [],
    proxyConfiguration,
    maxRetries = 3,
    delayBetweenRequests = 1000,
} = input;

// Validate input
const allUsernames = [...usernames];

// Extract usernames from URLs
for (const url of urls) {
    const match = url.match(/tiktok\.com\/@([^/?]+)/);
    if (match) {
        allUsernames.push(match[1]);
    }
}

if (allUsernames.length === 0) {
    throw new Error('No usernames provided. Please provide usernames array or urls array.');
}

console.log(`Processing ${allUsernames.length} TikTok profiles...`);

// Setup proxy if configured
let proxyUrl = null;
if (proxyConfiguration) {
    const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
    proxyUrl = await proxyConfig?.newUrl();
}

// Initialize API client
const api = new TikTokAPI({
    proxy: proxyUrl,
});

// Initialize session (get cookies)
console.log('Initializing TikTok session...');
await api.initSession();

// Process each username
const results = [];
const errors = [];

for (const username of allUsernames) {
    const cleanUsername = username.replace('@', '').trim();
    
    if (!cleanUsername) {
        continue;
    }
    
    console.log(`Fetching profile: @${cleanUsername}`);
    
    let lastError = null;
    let profile = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            profile = await api.scrapeUserProfile(cleanUsername);
            break;
        } catch (error) {
            lastError = error;
            console.warn(`Attempt ${attempt}/${maxRetries} failed for @${cleanUsername}: ${error.message}`);
            
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
        // Calculate engagement rate if we have the data
        if (profile.followers && profile.likes && profile.videos && profile.videos > 0) {
            const avgLikesPerVideo = profile.likes / profile.videos;
            profile.engagementRate = Math.round((avgLikesPerVideo / profile.followers) * 10000) / 100;
        }
        
        // Remove raw data from output (keep it clean)
        const { _raw, ...cleanProfile } = profile;
        
        results.push({
            success: true,
            input: cleanUsername,
            data: cleanProfile,
            scrapedAt: new Date().toISOString(),
        });
        
        // Push to dataset
        await Actor.pushData({
            platform: 'tiktok',
            ...cleanProfile,
            scrapedAt: new Date().toISOString(),
        });
        
        console.log(`✓ @${cleanUsername}: ${profile.followers?.toLocaleString() || 'N/A'} followers`);
    } else {
        errors.push({
            username: cleanUsername,
            error: lastError?.message || 'Unknown error',
        });
        
        console.error(`✗ @${cleanUsername}: ${lastError?.message || 'Failed'}`);
    }
    
    // Delay between requests
    if (allUsernames.indexOf(username) < allUsernames.length - 1) {
        await new Promise(r => setTimeout(r, delayBetweenRequests));
    }
}

// Summary
console.log('\n--- Summary ---');
console.log(`Successful: ${results.length}/${allUsernames.length}`);
console.log(`Failed: ${errors.length}/${allUsernames.length}`);

if (errors.length > 0) {
    console.log('\nFailed profiles:');
    for (const err of errors) {
        console.log(`  - @${err.username}: ${err.error}`);
    }
}

// Store summary in key-value store
await Actor.setValue('summary', {
    totalRequested: allUsernames.length,
    successful: results.length,
    failed: errors.length,
    errors: errors,
    completedAt: new Date().toISOString(),
});

await Actor.exit();
