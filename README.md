# TikTok Profile Scraper

Extract public profile metrics from TikTok accounts using their internal web API.

## Features

- **No login required** - Scrapes publicly available data only
- **Fast extraction** - Uses TikTok's internal API, not browser automation
- **Reliable** - Multiple fallback parsing methods
- **Engagement calculation** - Automatically calculates engagement rate

## Output Data

For each profile, you'll get:

| Field | Description |
|-------|-------------|
| `username` | TikTok handle (without @) |
| `nickname` | Display name |
| `userId` | Internal TikTok user ID |
| `bio` | Profile biography |
| `verified` | Blue checkmark status |
| `private` | Private account status |
| `avatarUrl` | Profile picture URL |
| `followers` | Follower count |
| `following` | Following count |
| `likes` | Total likes received |
| `videos` | Number of videos posted |
| `engagementRate` | Calculated as (avg likes per video / followers) × 100 |
| `bioLink` | Link in bio (if any) |
| `commerceUser` | TikTok Shop enabled |

## Input

```json
{
    "usernames": ["tiktok", "charlidamelio", "khaby.lame"],
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["DATACENTER"]
    }
}
```

Or use URLs:

```json
{
    "urls": [
        "https://www.tiktok.com/@tiktok",
        "https://www.tiktok.com/@charlidamelio"
    ]
}
```

## Example Output

```json
{
    "platform": "tiktok",
    "username": "tiktok",
    "nickname": "TikTok",
    "userId": "107955",
    "bio": "Make Your Day",
    "verified": true,
    "private": false,
    "avatarUrl": "https://p16-sign-va.tiktokcdn.com/...",
    "followers": 85200000,
    "following": 892,
    "likes": 415000000,
    "videos": 524,
    "engagementRate": 0.93,
    "bioLink": "https://www.tiktok.com/about",
    "commerceUser": false,
    "scrapedAt": "2026-02-07T02:20:00.000Z"
}
```

## Proxy Recommendations

- **Datacenter proxies** usually work fine for profile scraping
- Use residential proxies if you experience blocks
- Rate limiting is rare but add delays if processing many profiles

## Rate Limits

TikTok has rate limiting. Recommendations:

- Process < 100 profiles per run
- Use 1-2 second delays between requests
- Use proxies for larger volumes

## API Usage (for other actors)

This actor can be called from other actors:

```javascript
import { Actor } from 'apify';

const run = await Actor.call('apricot_blackberry/tiktok-profile-scraper', {
    usernames: ['charlidamelio'],
});

const dataset = await Actor.openDataset(run.defaultDatasetId);
const { items } = await dataset.getData();
console.log(items[0]); // Profile data
```

## Technical Details

This scraper works by:

1. Fetching the TikTok profile web page
2. Extracting the `SIGI_STATE` or `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON
3. Parsing user and stats data from the hydration payload

No browser is used, making it fast and resource-efficient.

## Limitations

- Only public profiles can be scraped
- Private accounts will return limited data
- Very new or recently changed accounts may have incomplete data

## Legal Notice

This actor only accesses publicly available data. Use responsibly and in accordance with TikTok's terms of service.

## Support

Issues? Questions? [Open an issue on GitHub](https://github.com/jleftely-creator/tiktok-profile-scraper/issues)

---

Built by [Creator Fusion](https://creatorfusion.net)
