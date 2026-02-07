/**
 * TikTok API Client
 * 
 * Makes authenticated requests to TikTok's internal API endpoints.
 */

import got from 'got';
import { CookieJar } from 'tough-cookie';
import {
    generateDeviceId,
    buildQueryParams,
    buildHeaders,
    getRandomUserAgent,
    generateXBogus,
} from './signer.js';

const API_BASE = 'https://www.tiktok.com';
const API_BASE_MOBILE = 'https://m.tiktok.com';

export class TikTokAPI {
    constructor(options = {}) {
        this.userAgent = options.userAgent || getRandomUserAgent();
        this.deviceId = options.deviceId || generateDeviceId();
        this.cookieJar = new CookieJar();
        this.proxy = options.proxy || null;
        
        // Set initial cookies
        this.setCookie(`tt_webid_v2=${this.deviceId}; Domain=.tiktok.com; Path=/`);
    }
    
    setCookie(cookieString) {
        try {
            this.cookieJar.setCookieSync(cookieString, 'https://www.tiktok.com');
        } catch (e) {
            // Ignore cookie errors
        }
    }
    
    getCookieString() {
        return this.cookieJar.getCookieStringSync('https://www.tiktok.com');
    }
    
    /**
     * Initialize session by visiting TikTok homepage
     * This sets up necessary cookies (ttwid, etc.)
     */
    async initSession() {
        try {
            const response = await got('https://www.tiktok.com/', {
                headers: buildHeaders(this.userAgent),
                followRedirect: true,
                ...(this.proxy ? { agent: this.proxy } : {}),
            });
            
            // Extract cookies from response
            const setCookies = response.headers['set-cookie'] || [];
            for (const cookie of setCookies) {
                this.setCookie(cookie);
            }
            
            return true;
        } catch (error) {
            console.error('Failed to init session:', error.message);
            return false;
        }
    }
    
    /**
     * Get user profile info by username
     */
    async getUserInfo(username) {
        // First, try the web page approach to get secUid
        const secUid = await this.getSecUid(username);
        
        if (!secUid) {
            throw new Error(`Could not find user: ${username}`);
        }
        
        // Now fetch detailed user info using secUid
        const userDetail = await this.getUserDetailBySecUid(secUid);
        
        return userDetail;
    }
    
    /**
     * Get secUid from username by parsing the profile page
     */
    async getSecUid(username) {
        try {
            const url = `https://www.tiktok.com/@${username}`;
            
            const response = await got(url, {
                headers: buildHeaders(this.userAgent, this.getCookieString()),
                followRedirect: true,
                timeout: { request: 15000 },
                ...(this.proxy ? { agent: this.proxy } : {}),
            });
            
            // Look for SIGI_STATE or __UNIVERSAL_DATA_FOR_REHYDRATION__ in the HTML
            const html = response.body;
            
            // Try to extract from SIGI_STATE
            const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
            if (sigiMatch) {
                try {
                    const data = JSON.parse(sigiMatch[1]);
                    const userModule = data.UserModule?.users;
                    if (userModule) {
                        const user = Object.values(userModule)[0];
                        if (user?.secUid) {
                            return user.secUid;
                        }
                    }
                } catch (e) {
                    // JSON parse failed, try other methods
                }
            }
            
            // Try __UNIVERSAL_DATA_FOR_REHYDRATION__
            const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
            if (universalMatch) {
                try {
                    const data = JSON.parse(universalMatch[1]);
                    const userInfo = data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo;
                    if (userInfo?.user?.secUid) {
                        return userInfo.user.secUid;
                    }
                } catch (e) {
                    // JSON parse failed
                }
            }
            
            // Try regex fallback
            const secUidMatch = html.match(/"secUid"\s*:\s*"([^"]+)"/);
            if (secUidMatch) {
                return secUidMatch[1];
            }
            
            return null;
        } catch (error) {
            console.error(`Failed to get secUid for ${username}:`, error.message);
            return null;
        }
    }
    
    /**
     * Get detailed user info using secUid via API
     */
    async getUserDetailBySecUid(secUid) {
        // First try parsing from web page (more reliable)
        return await this.getUserDetailFromWeb(secUid);
    }
    
    /**
     * Extract full user data from web page JSON
     */
    async getUserDetailFromWeb(secUid) {
        try {
            // We need to reconstruct the username from secUid or use alternative endpoint
            const queryParams = buildQueryParams({
                secUid: secUid,
            });
            
            const url = new URL(`${API_BASE}/api/user/detail/`);
            for (const [key, value] of Object.entries(queryParams)) {
                url.searchParams.set(key, value);
            }
            
            const response = await got(url.toString(), {
                headers: buildHeaders(this.userAgent, this.getCookieString()),
                timeout: { request: 15000 },
                responseType: 'json',
                ...(this.proxy ? { agent: this.proxy } : {}),
            });
            
            return response.body;
        } catch (error) {
            // API endpoint might be blocked, return what we have
            console.error('API request failed:', error.message);
            return null;
        }
    }
    
    /**
     * Get user profile by parsing the web page directly
     * This is the most reliable method
     */
    async scrapeUserProfile(username) {
        try {
            const url = `https://www.tiktok.com/@${username}`;
            
            const response = await got(url, {
                headers: buildHeaders(this.userAgent, this.getCookieString()),
                followRedirect: true,
                timeout: { request: 20000 },
                ...(this.proxy ? { agent: this.proxy } : {}),
            });
            
            // Update cookies from response
            const setCookies = response.headers['set-cookie'] || [];
            for (const cookie of setCookies) {
                this.setCookie(cookie);
            }
            
            const html = response.body;
            return this.parseProfileFromHtml(html, username);
            
        } catch (error) {
            if (error.response?.statusCode === 404) {
                throw new Error(`User not found: ${username}`);
            }
            throw error;
        }
    }
    
    /**
     * Parse user profile data from HTML
     */
    parseProfileFromHtml(html, username) {
        let userData = null;
        let stats = null;
        
        // Try SIGI_STATE first
        const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
        if (sigiMatch) {
            try {
                const data = JSON.parse(sigiMatch[1]);
                
                // Extract user data
                const userModule = data.UserModule;
                if (userModule) {
                    const users = userModule.users || {};
                    const userStats = userModule.stats || {};
                    
                    userData = Object.values(users)[0];
                    stats = Object.values(userStats)[0];
                }
            } catch (e) {
                console.error('Failed to parse SIGI_STATE:', e.message);
            }
        }
        
        // Try __UNIVERSAL_DATA_FOR_REHYDRATION__ as fallback
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
                } catch (e) {
                    console.error('Failed to parse UNIVERSAL_DATA:', e.message);
                }
            }
        }
        
        if (!userData) {
            throw new Error('Could not extract user data from page');
        }
        
        // Normalize the data
        return {
            username: userData.uniqueId || username,
            nickname: userData.nickname || null,
            userId: userData.id || null,
            secUid: userData.secUid || null,
            bio: userData.signature || null,
            verified: userData.verified || false,
            private: userData.privateAccount || false,
            
            // Avatar
            avatarUrl: userData.avatarLarger || userData.avatarMedium || userData.avatarThumb || null,
            
            // Stats
            followers: stats?.followerCount ?? userData.followerCount ?? null,
            following: stats?.followingCount ?? userData.followingCount ?? null,
            likes: stats?.heartCount ?? stats?.heart ?? userData.heartCount ?? null,
            videos: stats?.videoCount ?? userData.videoCount ?? null,
            
            // Engagement metrics (calculated)
            engagementRate: null, // Will be calculated if we have video data
            
            // Business info
            bioLink: userData.bioLink?.link || null,
            commerceUser: userData.commerceUserInfo?.commerceUser || false,
            
            // Raw data for debugging
            _raw: {
                user: userData,
                stats: stats,
            },
        };
    }
}
