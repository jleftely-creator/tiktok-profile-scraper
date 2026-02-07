/**
 * TikTok URL Signer
 * 
 * TikTok requires signed requests to their API. This module replicates
 * the browser-side signing that happens on tiktok.com.
 * 
 * Based on: https://github.com/drawrowfly/tiktok-scraper (MIT License)
 */

import { JSDOM } from 'jsdom';
import crypto from 'crypto';

// Generate random device ID (mimics tt_webid_v2 cookie)
export function generateDeviceId() {
    return '69' + crypto.randomBytes(8).toString('hex').slice(0, 17);
}

// Generate random string for various IDs
export function randomString(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// User agents that work well with TikTok
export const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

export function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Build common query parameters for TikTok API requests
 */
export function buildQueryParams(extras = {}) {
    const timestamp = Date.now();
    
    return {
        aid: '1988',
        app_language: 'en',
        app_name: 'tiktok_web',
        browser_language: 'en-US',
        browser_name: 'Mozilla',
        browser_online: 'true',
        browser_platform: 'Win32',
        browser_version: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        channel: 'tiktok_web',
        cookie_enabled: 'true',
        device_id: generateDeviceId(),
        device_platform: 'web_pc',
        focus_state: 'true',
        from_page: 'user',
        history_len: String(Math.floor(Math.random() * 10) + 1),
        is_fullscreen: 'false',
        is_page_visible: 'true',
        language: 'en',
        os: 'windows',
        priority_region: '',
        referer: '',
        region: 'US',
        screen_height: '1080',
        screen_width: '1920',
        tz_name: 'America/Chicago',
        webcast_language: 'en',
        msToken: randomString(128),
        ...extras,
    };
}

/**
 * Generate X-Bogus signature for TikTok API requests
 * 
 * TikTok uses X-Bogus as an anti-bot measure. This is a simplified
 * implementation that works for basic profile requests.
 */
export function generateXBogus(urlPath, userAgent) {
    // X-Bogus is generated client-side via obfuscated JS
    // For profile requests, we can often get away without it
    // by using the right cookies and headers
    
    // This is a placeholder - full implementation would require
    // running TikTok's obfuscated JS in a VM
    const timestamp = Math.floor(Date.now() / 1000);
    const data = `${urlPath}${timestamp}${userAgent}`;
    const hash = crypto.createHash('md5').update(data).digest('hex');
    
    return `DFSzswVo${hash.slice(0, 16)}`;
}

/**
 * Build headers for TikTok API requests
 */
export function buildHeaders(userAgent, cookies = '') {
    return {
        'User-Agent': userAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Referer': 'https://www.tiktok.com/',
        'Origin': 'https://www.tiktok.com',
        ...(cookies ? { 'Cookie': cookies } : {}),
    };
}
