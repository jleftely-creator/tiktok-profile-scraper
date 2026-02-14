/**
 * TikTok Browser-Based Scraper
 *
 * Uses Playwright to render TikTok pages with full JavaScript execution.
 * TikTok's anti-bot requires JS rendering - HTTP-only approaches get blocked.
 *
 * Features:
 * - Full browser rendering (bypasses JS-based anti-bot)
 * - Gaussian delays between requests
 * - User-Agent rotation per session
 * - Multiple data extraction strategies (SIGI_STATE, UNIVERSAL_DATA, NEXT_DATA, DOM)
 * - Session rotation every 15 profiles
 * - Improved bio/bioLink extraction
 * - Safe number parsing with context awareness
 * - Stealth mode with realistic fingerprinting
 */

import { chromium } from 'playwright';
import {
    generateDeviceId,
    getRandomUserAgent,
    randomString,
    detectProxyRegion,
} from './signer.js';

/**
 * Recursively find user data in a nested JSON object
 */
function findUserData(obj, username, depth = 0) {
    if (depth > 10 || !obj || typeof obj !== 'object') return null;

    if (obj.uniqueId === username || obj.unique_id === username) {
        return { user: obj, stats: null };
    }

    if (obj.userInfo?.user?.uniqueId === username) {
        return { user: obj.userInfo.user, stats: obj.userInfo.stats };
    }

    for (const key of Object.keys(obj)) {
        const result = findUserData(obj[key], username, depth + 1);
        if (result) return result;
    }

    return null;
}

/**
 * Box-Muller transform for Gaussian-distributed random numbers
 */
function gaussianRandom(mean = 0, stdDev = 1) {
    let u1 = Math.random();
    let u2 = Math.random();
    while (u1 === 0) u1 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
}

function getGaussianDelay() {
    const delay = gaussianRandom(2500, 800);
    return Math.max(1000, Math.min(6000, Math.round(delay)));
}

function isValidUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        new URL(url.startsWith('http') ? url : `https://${url}`);
        return true;
    } catch {
        return false;
    }
}

function extractBio(userData) {
    if (!userData) return null;
    if (userData.signature && typeof userData.signature === 'string') return userData.signature;
    if (userData.bioDescription && typeof userData.bioDescription === 'string') return userData.bioDescription;
    if (userData.description && typeof userData.description === 'string') return userData.description;
    return null;
}

function extractBioLink(userData) {
    if (!userData) return null;

    if (userData.bioLink?.link && typeof userData.bioLink.link === 'string') {
        if (isValidUrl(userData.bioLink.link)) return userData.bioLink.link;
    }

    if (typeof userData.bioLink === 'string' && isValidUrl(userData.bioLink)) {
        return userData.bioLink;
    }

    const bio = extractBio(userData);
    if (bio) {
        const urlMatch = bio.match(/https?:\/\/([\w.-]+\.[a-z]{2,}[^\s]*)/i);
        if (urlMatch && isValidUrl(urlMatch[0])) return urlMatch[0];
    }

    return null;
}

function safeNumber(val, options = {}) {
    const { field = '', max = Infinity } = options;

    if (val === null || val === undefined) return null;

    if (typeof val === 'number' && val >= 0) {
        return val > max ? null : val;
    }

    if (typeof val === 'number' && val < 0) {
        const recovered = val + 4294967296;
        if (field === 'followers' && recovered > 1000000000) return null;
        if (field === 'likes' && recovered > 100000000000000) return null;
        return recovered;
    }

    if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed)) return null;
        return parsed > max ? null : parsed;
    }

    return null;
}

function calculateAccountAge(timestamp) {
    if (!timestamp) return null;
    try {
        let date;
        if (typeof timestamp === 'number') {
            date = new Date(timestamp * 1000);
        } else {
            date = new Date(timestamp);
        }
        const now = new Date();
        const year = date.getFullYear();
        if (year < 2016 || year > now.getFullYear()) return null;
        const ageDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (ageDays < 0) return null;
        return ageDays;
    } catch {
        return null;
    }
}

function timestampToDate(ts) {
    if (!ts || typeof ts !== 'number') return null;
    try {
        const date = new Date(ts * 1000);
        const year = date.getFullYear();
        if (year < 2016 || year > new Date().getFullYear()) return null;
        return date.toISOString();
    } catch {
        return null;
    }
}

export class TikTokAPI {
    constructor(options = {}) {
        this.userAgent = options.userAgent || getRandomUserAgent();
        this.deviceId = options.deviceId || generateDeviceId();
        this.proxyUrl = options.proxy || null;
        this.proxyLocation = options.proxyLocation || null;
        this.requestCount = 0;
        this.lastRequestTime = 0;
        this.browser = null;
        this.context = null;
        this.maxProfilesPerSession = 15;
    }

    /**
     * Initialize browser session with stealth settings
     */
    async initSession() {
        // Close existing browser if any
        if (this.browser) {
            try { await this.browser.close(); } catch {}
        }

        const launchOptions = {
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
            ],
        };

        // Configure proxy
        if (this.proxyUrl) {
            try {
                const proxyUrlObj = new URL(this.proxyUrl);
                launchOptions.proxy = {
                    server: `${proxyUrlObj.protocol}//${proxyUrlObj.hostname}:${proxyUrlObj.port}`,
                    username: proxyUrlObj.username || undefined,
                    password: proxyUrlObj.password || undefined,
                };
            } catch (e) {
                console.warn('Failed to parse proxy URL, trying raw:', e.message);
                launchOptions.proxy = { server: this.proxyUrl };
            }
        }

        this.browser = await chromium.launch(launchOptions);

        // Create context with stealth settings
        this.userAgent = getRandomUserAgent();
        this.deviceId = generateDeviceId();

        this.context = await this.browser.newContext({
            userAgent: this.userAgent,
            viewport: { width: 1920, height: 1080 },
            locale: 'en-US',
            timezoneId: 'America/New_York',
            geolocation: null,
            permissions: [],
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not_A Brand";v="8"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
            },
        });

        // Apply stealth scripts to every page
        await this.context.addInitScript(() => {
            // Override navigator.webdriver
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });

            // Override chrome runtime
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {},
            };

            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) =>
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters);

            // Override plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });

            // Override languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            });

            // Override platform
            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32',
            });

            // Override hardware concurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8,
            });

            // Override device memory
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8,
            });

            // Fake WebGL vendor/renderer
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return 'Intel Inc.';
                if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                return getParameter.call(this, parameter);
            };
        });

        // Set cookies for TikTok
        await this.context.addCookies([
            {
                name: 'tt_webid_v2',
                value: this.deviceId,
                domain: '.tiktok.com',
                path: '/',
            },
            {
                name: 'tt_csrf_token',
                value: randomString(32),
                domain: '.tiktok.com',
                path: '/',
            },
        ]);

        this.requestCount = 0;
        console.log('Browser session initialized with stealth settings');
        return true;
    }

    /**
     * Apply Gaussian delay
     */
    async applyDelay() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const delay = getGaussianDelay();

        if (timeSinceLastRequest < delay) {
            const waitTime = delay - timeSinceLastRequest;
            await new Promise(r => setTimeout(r, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * Scrape a user profile using browser rendering
     */
    async scrapeUserProfile(username) {
        // Rotate session every N profiles
        if (this.requestCount >= this.maxProfilesPerSession) {
            console.log('Rotating browser session...');
            await this.initSession();
        }

        await this.applyDelay();

        const url = `https://www.tiktok.com/@${username}`;
        let page = null;

        try {
            page = await this.context.newPage();

            // Block heavy resources for speed (but keep scripts for data)
            await page.route('**/*', (route) => {
                const resourceType = route.request().resourceType();
                if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });

            // Navigate with timeout
            const response = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });

            if (!response) {
                throw new Error('No response received');
            }

            const statusCode = response.status();
            if (statusCode === 404) {
                throw new Error(`User not found: ${username}`);
            }
            if (statusCode === 429) {
                throw new Error(`Rate limited (429)`);
            }
            if (statusCode >= 500) {
                throw new Error(`Server error: ${statusCode}`);
            }

            // Wait for data to be available in the page
            // TikTok loads user data into script tags during SSR + hydration
            await page.waitForTimeout(2000);

            // Try to wait for user data signal in the page
            try {
                await page.waitForFunction(
                    (uname) => {
                        // Check if any of the known data containers exist
                        const sigiEl = document.querySelector('#SIGI_STATE');
                        const universalEl = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
                        const nextDataEl = document.querySelector('#__NEXT_DATA__');

                        if (sigiEl || universalEl || nextDataEl) return true;

                        // Also check if profile data is visible in DOM
                        const hasFollowers = document.querySelector('[data-e2e="followers-count"]');
                        if (hasFollowers) return true;

                        return false;
                    },
                    username,
                    { timeout: 10000 }
                );
            } catch {
                // Timeout waiting for data signal - continue anyway, we'll try to extract
                console.warn(`Data signal timeout for @${username}, attempting extraction anyway...`);
            }

            // Extract page HTML for parsing
            const html = await page.content();

            // Also try to extract data directly from page JS context
            let pageData = null;
            try {
                pageData = await page.evaluate((uname) => {
                    const result = {};

                    // Try SIGI_STATE
                    const sigiEl = document.querySelector('#SIGI_STATE');
                    if (sigiEl) {
                        try {
                            const data = JSON.parse(sigiEl.textContent);
                            const userModule = data.UserModule;
                            if (userModule) {
                                result.user = Object.values(userModule.users || {})[0];
                                result.stats = Object.values(userModule.stats || {})[0];
                                result.source = 'SIGI_STATE';
                            }
                        } catch {}
                    }

                    // Try __UNIVERSAL_DATA_FOR_REHYDRATION__
                    if (!result.user) {
                        const universalEl = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
                        if (universalEl) {
                            try {
                                const data = JSON.parse(universalEl.textContent);
                                const userInfo = data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo;
                                if (userInfo) {
                                    result.user = userInfo.user;
                                    result.stats = userInfo.stats;
                                    result.source = 'UNIVERSAL_DATA';
                                }
                            } catch {}
                        }
                    }

                    // Try __NEXT_DATA__
                    if (!result.user) {
                        const nextEl = document.querySelector('#__NEXT_DATA__');
                        if (nextEl) {
                            try {
                                const data = JSON.parse(nextEl.textContent);
                                const userInfo = data?.props?.pageProps?.userInfo;
                                if (userInfo) {
                                    result.user = userInfo.user;
                                    result.stats = userInfo.stats;
                                    result.source = 'NEXT_DATA';
                                }
                            } catch {}
                        }
                    }

                    // Try extracting from DOM as last resort
                    if (!result.user) {
                        const followersEl = document.querySelector('[data-e2e="followers-count"]');
                        const followingEl = document.querySelector('[data-e2e="following-count"]');
                        const likesEl = document.querySelector('[data-e2e="likes-count"]');
                        const bioEl = document.querySelector('[data-e2e="user-bio"]');
                        const nicknameEl = document.querySelector('[data-e2e="user-subtitle"]') ||
                            document.querySelector('[data-e2e="user-title"]');

                        if (followersEl || bioEl) {
                            // Parse abbreviated numbers (e.g., "1.2M", "500K")
                            const parseAbbreviated = (text) => {
                                if (!text) return null;
                                text = text.trim().replace(/,/g, '');
                                const multipliers = { K: 1000, M: 1000000, B: 1000000000 };
                                const match = text.match(/^([\d.]+)([KMB])?$/i);
                                if (match) {
                                    const num = parseFloat(match[1]);
                                    const mult = multipliers[(match[2] || '').toUpperCase()] || 1;
                                    return Math.round(num * mult);
                                }
                                return parseInt(text, 10) || null;
                            };

                            result.user = {
                                uniqueId: uname,
                                nickname: nicknameEl?.textContent?.trim() || null,
                                signature: bioEl?.textContent?.trim() || null,
                            };
                            result.stats = {
                                followerCount: parseAbbreviated(followersEl?.textContent),
                                followingCount: parseAbbreviated(followingEl?.textContent),
                                heartCount: parseAbbreviated(likesEl?.textContent),
                            };
                            result.source = 'DOM';
                        }
                    }

                    return result;
                }, username);
            } catch (e) {
                console.warn('Page evaluate failed:', e.message);
            }

            this.requestCount++;

            // Parse the extracted data
            let userData = pageData?.user || null;
            let stats = pageData?.stats || null;

            // If page evaluate didn't work, fall back to HTML parsing
            if (!userData) {
                const extracted = this.parseProfileFromHtml(html, username);
                if (extracted) return extracted;
            }

            if (!userData) {
                // Debug: log what we got
                const bodyPreview = html.substring(0, 500);
                console.error(`Could not extract data for @${username}. Source: ${pageData?.source || 'none'}`);
                console.error(`Page preview: ${bodyPreview}`);
                throw new Error('Could not extract user data from page');
            }

            if (pageData?.source) {
                console.log(`Extracted @${username} data from ${pageData.source}`);
            }

            return this.buildProfileObject(userData, stats, username);
        } finally {
            if (page) {
                try { await page.close(); } catch {}
            }
        }
    }

    /**
     * Parse profile data from raw HTML (fallback)
     */
    parseProfileFromHtml(html, username) {
        let userData = null;
        let stats = null;

        // Try SIGI_STATE
        const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
        if (sigiMatch) {
            try {
                const data = JSON.parse(sigiMatch[1]);
                const userModule = data.UserModule;
                if (userModule) {
                    userData = Object.values(userModule.users || {})[0];
                    stats = Object.values(userModule.stats || {})[0];
                }
            } catch {}
        }

        // Try __UNIVERSAL_DATA_FOR_REHYDRATION__
        if (!userData) {
            const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
            if (universalMatch) {
                try {
                    const data = JSON.parse(universalMatch[1]);
                    const userInfo = data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo;
                    if (userInfo) {
                        userData = userInfo.user;
                        stats = userInfo.stats;
                    }
                } catch {}
            }
        }

        // Try __NEXT_DATA__
        if (!userData) {
            const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
            if (nextDataMatch) {
                try {
                    const data = JSON.parse(nextDataMatch[1]);
                    const userInfo = data?.props?.pageProps?.userInfo;
                    if (userInfo) {
                        userData = userInfo.user;
                        stats = userInfo.stats;
                    }
                } catch {}
            }
        }

        // Generic script scan
        if (!userData) {
            const allScripts = html.match(/<script[^>]*>([^<]{100,})<\/script>/g) || [];
            for (const script of allScripts) {
                const content = script.replace(/<\/?script[^>]*>/g, '');
                try {
                    if (content.includes(username) && (content.includes('followerCount') || content.includes('fans'))) {
                        const data = JSON.parse(content);
                        const found = findUserData(data, username);
                        if (found) {
                            userData = found.user;
                            stats = found.stats;
                            break;
                        }
                    }
                } catch {}
            }
        }

        if (!userData) return null;

        return this.buildProfileObject(userData, stats, username);
    }

    /**
     * Build standardized profile object from extracted data
     */
    buildProfileObject(userData, stats, username) {
        const bio = extractBio(userData);
        const bioLink = extractBioLink(userData);

        const extractBioLinks = (bioText, bioLinkUrl) => {
            const links = [];
            if (bioLinkUrl) links.push({ url: bioLinkUrl, type: 'official' });
            if (bioText) {
                const urlRegex = /https?:\/\/([\w.-]+\.[a-z]{2,}[^\s]*)/gi;
                const matches = bioText.match(urlRegex) || [];
                for (const match of matches) {
                    if (isValidUrl(match) && !links.some(l => l.url === match)) {
                        links.push({ url: match, type: 'bio_text' });
                    }
                }
            }
            return links;
        };

        const bioLinks = extractBioLinks(bio, bioLink);
        const accountAge = calculateAccountAge(userData.createTime);

        let followers = safeNumber(stats?.followerCount ?? userData.followerCount, { field: 'followers' });
        let likes = safeNumber(stats?.heart ?? stats?.heartCount ?? userData.heartCount, { field: 'likes' });
        let videos = safeNumber(stats?.videoCount ?? userData.videoCount);

        let engagementRate = null;
        if (followers && followers > 0 && likes && videos && videos > 0) {
            const avgLikesPerVideo = likes / videos;
            engagementRate = Math.round((avgLikesPerVideo / followers) * 10000) / 100;
            if (isNaN(engagementRate) || engagementRate < 0 || engagementRate > 100) {
                engagementRate = null;
            }
        }

        return {
            username: userData.uniqueId || username,
            nickname: userData.nickname || null,
            userId: userData.id || null,
            secUid: userData.secUid || null,
            bio: bio,
            verified: userData.verified || false,
            private: userData.privateAccount || false,
            avatarUrl: userData.avatarLarger || userData.avatarMedium || userData.avatarThumb || null,
            followers: followers,
            following: safeNumber(stats?.followingCount ?? userData.followingCount, { field: 'following' }),
            likes: likes,
            videos: videos,
            friendCount: safeNumber(stats?.friendCount),
            diggCount: safeNumber(stats?.diggCount),
            engagementRate: engagementRate,
            createdAt: timestampToDate(userData.createTime),
            accountAgeDays: accountAge,
            language: userData.language || null,
            region: userData.region || null,
            isOrganization: userData.isOrganization === 1,
            bioLink: bioLink,
            bioLinks: bioLinks,
            commerceUser: userData.commerceUserInfo?.commerceUser || false,
            ttSeller: userData.ttSeller || false,
            settings: {
                comments: userData.commentSetting ?? null,
                duet: userData.duetSetting ?? null,
                stitch: userData.stitchSetting ?? null,
                download: userData.downloadSetting ?? null,
            },
            profileTabs: userData.profileTab || null,
            dataQualityScore: this.calculateDataQualityScore({
                bio,
                bioLink,
                region: userData.region,
                followers,
                createdAt: userData.createTime,
            }),
        };
    }

    calculateDataQualityScore(data) {
        let score = 50;
        if (data.bio) score += 10;
        if (data.bioLink) score += 10;
        if (data.region) score += 10;
        if (data.followers !== null && data.followers > 0) score += 10;
        if (data.createdAt) score += 10;
        return Math.min(100, score);
    }

    /**
     * Close browser when done
     */
    async close() {
        if (this.browser) {
            try { await this.browser.close(); } catch {}
            this.browser = null;
            this.context = null;
        }
    }
}
