# FUNGUKA v2.0 — Anonymous Confession Platform

> **Unzip your soul.** Now with **Supabase** (persistent database), **Cloudinary** (persistent audio storage), and **Search** functionality.

---

## 🚀 What's New in v2.0

| Feature | v1.0 (SQLite) | v2.0 (Supabase + Cloudinary) |
|---------|--------------|-------------------------------|
| **Database** | SQLite (local file) | PostgreSQL on Supabase (cloud) |
| **Audio Storage** | Local disk | Cloudinary CDN |
| **Data Persistence** | ❌ Lost on Render sleep | ✅ Survives forever |
| **Search** | ❌ Not available | ✅ Search by keyword |
| **Scalability** | Single instance | Multi-instance ready |

---

## 📦 Project Structure

```
FUNGUKA-APP/
├── server.js          # Express server (Supabase + Cloudinary)
├── moderation.js      # Content moderation engine
├── package.json       # Dependencies
├── public/
│   └── index.html     # Frontend with search
├── uploads/           # Temp audio storage (before Cloudinary upload)
├── .env.example       # Environment variables template
└── README.md          # This file
```

---

## ⚡ Quick Start (Local)

### Step 1: Install Dependencies

```bash
cd FUNGUKA-APP
npm install
```

### Step 2: Set Up Environment Variables

Create a `.env` file in the project root:

```env
PORT=3000
SESSION_SECRET=your-super-secret-key-here
ADMIN_TOKEN=funguka-admin-2024

# Supabase — get this from your Supabase dashboard
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.xxxxxxxxxx.supabase.co:5432/postgres

# Cloudinary — get these from your Cloudinary dashboard
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### Step 3: Start the Server

```bash
npm start
```

Open **http://localhost:3000**

---

## 🌐 Deploy to Render (With Supabase + Cloudinary)

### 1. Set Up Supabase (Free)

1. Go to [supabase.com](https://supabase.com) → Sign up with GitHub
2. Click **New Project**
   - Name: `funguka`
   - Database Password: Create a strong password
   - Region: **Frankfurt (eu-central-1)** — closest to Kenya
3. Wait ~2 minutes for the project to spin up
4. Click **Connect** (top right) → **Node.js**
5. Copy the connection string:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxx.supabase.co:5432/postgres
   ```

### 2. Set Up Cloudinary (Free)

1. Go to [cloudinary.com](https://cloudinary.com) → Sign up
2. Verify your email
3. On the dashboard, find:
   - **Cloud Name**
   - **API Key**
   - **API Secret**

### 3. Push Code to GitHub

```bash
git add .
git commit -m "FUNGUKA v2.0 — Supabase + Cloudinary + Search"
git push origin main
```

### 4. Deploy on Render

1. Go to [render.com](https://render.com) → Your `funguka` web service
2. Click **Environment** (left sidebar)
3. Add these environment variables:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your Supabase connection string |
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Your Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Your Cloudinary API secret |
| `ADMIN_TOKEN` | `funguka-admin-2024` (or your own) |
| `SESSION_SECRET` | A random string (generate at random.org) |

4. Click **Manual Deploy** → **Deploy latest commit**
5. Wait ~2 minutes. Your app is now live with persistent data!

---

## 🔍 Search Feature

Users can now search confessions by:
- **Title** — e.g., "brother", "insurance", "dead"
- **Content** — any word in the confession text
- **Category label** — e.g., "CRIME", "WILD"
- **Part numbers** — e.g., "Part 1", "Part 2"

This is perfect for the TikTok funnel — when you post "Part 1", users can search "Part 2" on the app to find the continuation.

---

## 🛡️ Content Moderation

Same as v1.0 — auto-flags:
- Self-harm references
- Violence threats
- CSAM/exploitation (blocked immediately)
- Hate speech
- Doxxing

---

## 💰 Free Tier Limits

| Service | Free Tier | Enough For |
|---------|-----------|-----------|
| **Supabase** | 500 MB database | ~50,000 text confessions |
| **Cloudinary** | 25 GB storage | ~50,000 voice recordings |
| **Cloudinary** | 25 GB monthly bandwidth | ~1,000 daily active users |
| **Render** | 512 MB RAM | Handles traffic spikes fine |

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| `DATABASE_URL` connection fails | Make sure you copied the full connection string from Supabase |
| Cloudinary upload fails | Check that your Cloud Name, API Key, and API Secret are correct |
| `node_modules` errors | Delete `node_modules` and `package-lock.json`, then run `npm install` |
| App crashes on start | Check Render logs for the exact error message |

---

## 📞 Need Help?

Start a new chat with Kimi, upload this README, and describe the error.

---

**Built with:** Node.js, Express, PostgreSQL (Supabase), Cloudinary, vanilla JavaScript

**FUNGUKA** — *Unzip your soul.* 🔓
