# Teams Bot Setup Guide

This guide walks you through registering the bot in Azure and deploying it to Microsoft Teams.

---

## Prerequisites

- Access to the [Azure Portal](https://portal.azure.com)
- Admin access to your Microsoft Teams tenant (or IT can sideload the app)
- Your app deployed and publicly accessible (e.g. via Azure App Service, Vercel, etc.)

---

## Step 1 — Register the Bot in Azure

1. Go to **Azure Portal → Create a resource → Azure Bot**
2. Fill in:
   - **Bot handle**: `COMS-Coach` (or similar)
   - **Subscription / Resource Group**: your usual ones
   - **Pricing tier**: F0 (free) is fine for internal use
   - **Type of App**: `Multi-Tenant` (simplest for internal org bots)
   - **Creation type**: Create new Microsoft App ID
3. Click **Review + Create → Create**
4. Once deployed, go to the resource → **Configuration**
5. Note your **Microsoft App ID** (shown at the top)
6. Click **Manage Password** → **New client secret** → copy the secret value immediately

---

## Step 2 — Add the Teams Channel

1. In your Azure Bot resource → **Channels**
2. Click **Microsoft Teams**
3. Accept the terms → **Save**

---

## Step 3 — Add Environment Variables to Your App

Add these to your `.env.local` (and to your hosting platform's environment variables):

```
MICROSOFT_APP_ID=<your App ID from Step 1>
MICROSOFT_APP_PASSWORD=<your client secret from Step 1>
```

The bot will use `DUST_COMS_COACH_AGENT_ID` if set, otherwise falls back to `DUST_AGENT_ID`.

---

## Step 4 — Set the Messaging Endpoint

1. In your Azure Bot → **Configuration**
2. Set **Messaging endpoint** to:
   ```
   https://YOUR_DEPLOYED_URL/api/bot
   ```
   Replace `YOUR_DEPLOYED_URL` with your actual domain (e.g. `https://yourapp.azurewebsites.net`).
3. Click **Apply**

> **Local testing**: Use [ngrok](https://ngrok.com) to expose your local server:
> ```
> ngrok http 3000
> ```
> Then set the endpoint to `https://XXXX.ngrok.io/api/bot`

---

## Step 5 — Build the Teams App Package

1. **Prepare icons** (place both files in this `teams-manifest/` folder):
   - `color.png` — 192×192 px, full-color icon (you can resize `public/COMS-Coach.png`)
   - `outline.png` — 32×32 px, white icon with transparent background

2. **Update `manifest.json`**:
   - Replace `REPLACE_WITH_MICROSOFT_APP_ID` (appears twice) with your App ID
   - Replace `REPLACE_WITH_YOUR_BOT_URL` with your deployed URL

3. **Zip the package** — the zip must contain exactly these three files at the root (no subfolder):
   ```
   manifest.json
   color.png
   outline.png
   ```
   On Windows: select all three files → right-click → **Compress to ZIP**

---

## Step 6 — Install in Teams

### Option A: Sideload for yourself (testing)
1. Open Teams → **Apps** → **Manage your apps** → **Upload an app**
2. Select **Upload a custom app** → choose your zip
3. Click **Add** to install it

### Option B: Deploy org-wide (IT/admin)
1. Teams Admin Center → **Teams apps → Manage apps → Upload new app**
2. Upload your zip
3. Set availability (all users or specific groups)

---

## Testing

Once installed, find COMS Coach in your Teams sidebar or search for it. Send it a message — it should reply via the Dust agent.

If it doesn't respond, check:
- Azure Bot → **Test in Web Chat** (verifies the bot itself works)
- Your server logs for errors at `/api/bot`
- That `MICROSOFT_APP_ID` and `MICROSOFT_APP_PASSWORD` are set correctly in your deployment
