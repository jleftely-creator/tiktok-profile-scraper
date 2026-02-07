// Explore available TikTok data fields
import got from 'got';

const username = process.argv[2] || 'charlidamelio';

const response = await got(`https://www.tiktok.com/@${username}`, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
});

const html = response.body;

// Try __UNIVERSAL_DATA_FOR_REHYDRATION__
const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
if (universalMatch) {
    const data = JSON.parse(universalMatch[1]);
    const userInfo = data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo;
    
    if (userInfo) {
        console.log('\n=== USER OBJECT KEYS ===');
        console.log(Object.keys(userInfo.user).join('\n'));
        
        console.log('\n=== STATS OBJECT ===');
        console.log(JSON.stringify(userInfo.stats, null, 2));
        
        console.log('\n=== INTERESTING USER FIELDS ===');
        const u = userInfo.user;
        console.log(JSON.stringify({
            // Already extracting
            uniqueId: u.uniqueId,
            nickname: u.nickname,
            verified: u.verified,
            signature: u.signature,
            
            // NEW - Could add these
            region: u.region,
            language: u.language,
            createTime: u.createTime, // Account creation timestamp
            openFavorite: u.openFavorite, // Are favorites public?
            privateAccount: u.privateAccount,
            secret: u.secret,
            
            // Content settings
            commentSetting: u.commentSetting,
            duetSetting: u.duetSetting,
            stitchSetting: u.stitchSetting,
            
            // Embed/permissions
            isEmbedBanned: u.isEmbedBanned,
            profileEmbedPermission: u.profileEmbedPermission,
            
            // Business/commerce
            commerceUserInfo: u.commerceUserInfo,
            ttSeller: u.ttSeller, // TikTok Shop seller
            
            // Badges/awards
            extraInfo: u.extraInfo,
            
            // Relation (if logged in)
            relation: u.relation,
            
            // Profile tab settings
            profileTab: u.profileTab,
            
        }, null, 2));
        
        console.log('\n=== ALL USER FIELDS (raw) ===');
        console.log(JSON.stringify(userInfo.user, null, 2));
    }
}
