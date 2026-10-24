# Anytime Fitness Check-in League & Tracker — Architectural Decision Record & Feasibility Analysis

**Author:** Gemini Task Engine  
**Target Application:** AF Check-in League & Attendance Tracker (`index.html`)  
**Reference Member:** Hum wein Chen  
**Home Club:** Kuchai Lama Entrepreneurs Park, Kuala Lumpur, Malaysia  
**Date:** October 2026  

---

## 1. Executive Summary & Core Dilemma

When tracking gym attendance across Anytime Fitness (AF) franchises, members occasionally forget to scan their key fob upon entry or need to retroactively log a workout session that occurred on a preceding day. The user query raised three pivotal engineering questions:
1. **Can we have a function to "re-tap" (retroactively record) a forgotten check-in?**
2. **Is manual "re-tapping" better, or is re-uploading an updated AF door access PDF statement better? What is the best overall solution?**
3. **Can our tracker directly connect to the official Anytime Fitness mobile app or web portal to visit it and extract check-in records automatically?**

This document details the architectural decisions implemented in the web application, evaluates the tradeoffs between real-time logging and statement re-ingestion, and explains the technical constraints surrounding third-party AF mobile app connectivity.

---

## 2. Solution Analysis: Manual "Re-Tap" vs. PDF Re-Upload

| Evaluation Dimension | Option A: In-App Retroactive "Re-Tap" | Option B: Re-uploading Official AF PDF Statement |
| :--- | :--- | :--- |
| **Execution Time** | **3–5 seconds** (1 click from header or heatmap) | **2–5 minutes** (log in, generate statement, download, upload) |
| **Availability / Lag** | **Immediate** (any date, past or present) | **Delayed** (AF member statements often lag by 24–48 hours) |
| **Data Authenticity** | User-asserted (subject to manual estimation) | **100% Cryptographic / Sensor Truth** (fob scans from physical turnstiles) |
| **Historical Scope** | Best for single missed dates (Yesterday / 2 days ago) | Best for bulk monthly auditing and retroactive history |
| **Offline Viability** | Works completely offline via `localStorage` | Requires active web connection to access AF portal |
| **Impact on AF Rules** | Recalculates streak & 50% home club ratio in real time | Verifies legal compliance against official club transfer policies |

### The Verdict: The Hybrid Routine (Best Solution)
Neither approach alone is optimal in isolation:
- Relying **only on PDF uploads** creates friction: members will not log into the AF portal daily just to check if yesterday's workout registered.
- Relying **only on manual re-taps** introduces user error and lacks an authoritative audit trail to guarantee compliance with the AF 50% Home Club Retention Rule.

**Recommended Workflow:**
1. **Daily Operational Layer (Manual Re-Tap):** Whenever you forget to check in, use the in-app **"Re-Tap Missed Day"** button (or click the exact empty day cell on the GitHub-style heatmap). Your workout streak, active day count, and consistency score update instantly.
2. **Monthly Reconciliation Layer (PDF Re-Upload):** At the end of each billing cycle or month, download your official statement from the Anytime Fitness portal and drop it into the upload zone. The client-side parser reconciles all physical door access entries, verifying that your Home Club (Kuchai Lama) exceeds 50% of your total workout days.

---

## 3. AF Mobile App & Member Portal Connectivity Feasibility

### 3.1 Security & Sandboxing Constraints
Directly connecting a standalone web application to the native Anytime Fitness iOS/Android app or scraping the AF member portal in the background is restricted by core platform security models:
1. **Browser Security & Same-Origin Policy (CORS):** Web applications running in a client browser cannot execute cross-origin `fetch` or `XMLHttpRequest` calls against `anytimefitness.com` without explicit CORS headers from AF servers.
2. **Lack of Public Developer APIs:** Anytime Fitness manages membership data through proprietary gym management back-ends (such as ABC Fitness / Club Automation). Neither Anytime Fitness LLC nor ABC Fitness provides an open OAuth2 developer API for consumer third-party web apps.
3. **OS App Isolation:** Browser sandboxes prevent web code from querying or reading internal SQLite databases or token stores of installed native mobile applications.

### 3.2 Practical Integration Bridges Implemented
To provide the smoothest user experience without compromising privacy or security, the app implements three technical bridges:
- **Mobile Deep Linking (`af://` URI Scheme):** On iOS and Android devices, tapping the app link attempts to launch the installed native AF app directly to the user's dashboard.
- **Direct Web Portal Authentication Link:** Opens the official login portal (`https://www.anytimefitness.com/login/`) in a secure tab for rapid credential entry.
- **In-App Portal Bridge & Export Guide:** Provides a visual modal detailing the 4-step path to export the key fob access statement PDF directly from the member portal.

---

## 4. Newly Implemented Features in `index.html`

1. **Dedicated "Re-Tap Missed Day" Modal:**
   - Quick date presets for **"Yesterday"** and **"2 Days Ago"**.
   - One-click time slot presets (**Morning 06:30 AM**, **Evening 06:30 PM**, **Late Night 10:30 PM**).
   - Club selector covering all regional branches (Kuchai Lama, The Tropika, Seri Gembira, Pavilion BJ, Pearl Point, or custom clubs).
2. **Interactive Heatmap Re-Tap:**
   - Clicking any day on the GitHub contribution matrix opens the day inspector. If zero visits occurred on that date, an immediate **"+ Re-Tap / Add Missed Check-in on this Date"** action pre-fills the retroactive form.
3. **AF App & Portal Hub:**
   - Header button launching the integration bridge with quick links and statement download guidance.
4. **Full Persistence & Undo Support:**
   - Retroactive check-ins are saved to `localStorage` and can be reverted immediately via `Ctrl+Z` or the header Undo engine.
