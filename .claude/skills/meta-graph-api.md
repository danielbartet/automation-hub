---
name: meta-graph-api
description: "ALWAYS use this skill for ANY Meta API call. Load it immediately whenever: publishing to Instagram or Facebook, checking token validity, debugging Meta API errors, or making any Graph API request. Contains critical IDs (Page ID, Instagram Account ID, Ad Account ID) that must be loaded from this skill, never typed from memory."
---

# Meta Graph API Skill

## Credentials
- Graph API version: v19.0
- Facebook Page ID: 1010286398835015
- Instagram Account ID: 17841449394293930
- Ad Account: act_1337773745049119
- Token: in server ~/.env as META_ACCESS_TOKEN
- System User: n8n-automation (ID: 61580762415010)

## Check token validity
source ~/.env
curl -s "https://graph.facebook.com/v19.0/me?access_token=$META_ACCESS_TOKEN"

## Publish Instagram Carousel
source ~/.env

Step 1 - Upload each image as carousel item (repeat per image, save each id):
curl -s -X POST "https://graph.facebook.com/v19.0/17841449394293930/media" -d "image_url=IMAGE_URL" -d "is_carousel_item=true" -d "access_token=$META_ACCESS_TOKEN"

Step 2 - Create carousel container:
curl -s -X POST "https://graph.facebook.com/v19.0/17841449394293930/media" -d "media_type=CAROUSEL" -d "children=MEDIA_ID_1,MEDIA_ID_2" -d "caption=YOUR_CAPTION" -d "access_token=$META_ACCESS_TOKEN"

Step 3 - Publish:
curl -s -X POST "https://graph.facebook.com/v19.0/17841449394293930/media_publish" -d "creation_id=CONTAINER_ID" -d "access_token=$META_ACCESS_TOKEN"

## Publish Facebook Page Post
source ~/.env
curl -s -X POST "https://graph.facebook.com/v19.0/1010286398835015/photos" -d "url=IMAGE_URL" -d "caption=YOUR_CAPTION" -d "access_token=$META_ACCESS_TOKEN"

## Common errors
- 190: Token expired → regenerate in Business Manager → System Users → n8n-automation
- 100: Invalid parameter → check image URL is publicly accessible (not imgur album, needs direct .jpg/.png)
- 200: Permission error → check System User has correct permissions in Business Manager
