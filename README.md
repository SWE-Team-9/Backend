# Backend

# Phase 0: Proposal & Architecture 

## 🏢 Company & Project Overview
**Company Name:** ---------------------------[Insert Company Name]----------------------------  
**Project:** Social Streaming Platform (SoundCloud Clone)  

## 🛠️ Backend Technology Stack & Architecture

To achieve the performance, scalability, and complex media handling required for a modern audio streaming platform, our backend team has selected a robust Node.js stack.

### 1. Core Framework & Hybrid Database
* **Runtime & Framework:** Node.js + Express.js (chosen for asynchronous I/O and streaming capabilities).
* **PostgreSQL (via Prisma ORM):** Handles entities requiring strict ACID compliance and relational integrity (Users, Subscriptions, Playlists, Social Graph/Follows).
* **MongoDB (via Mongoose ODM):** Handles high-write-volume, schema-flexible data (Activity Feeds, Direct Messages, Timestamped Waveform Comments).

### 2. Security & Authentication (Module 1 Focus)
Security is prioritized at the middleware layer to protect user data and maintain platform integrity:
* **`argon2`:** Chosen as our password hashing algorithm as it won the Password Hashing Competition (PHC). It provides superior resistance to GPU/ASIC brute-force and dictionary attacks compared to standard bcrypt.
* **`cookie-parser`:** Used to deliver JWTs via **`httpOnly` secure cookies**. This strictly prevents Cross-Site Scripting (XSS) attacks by hiding session tokens from malicious client-side JavaScript.
* **`helmet`:** Secures Express apps by setting various HTTP headers. It mitigates Clickjacking, MIME-sniffing, and XSS attacks.
* **`express-rate-limit`:** Implemented on global and authentication routes to prevent Denial of Service (DoS/DDoS) and automated credential-stuffing (brute-force) attacks.
* **`zod`:** Enforces strict runtime schema validation on all incoming requests to prevent SQL/NoSQL injection and malformed payload crashes.
* **`passport`:** Handles OAuth 2.0 flows for secure Social Identity integration.

### 3. Media Processing & Streaming (Modules 2, 4, 5)
* **`multer` & `cloudinary`:** For processing `multipart/form-data` and reliably hosting high-resolution visual assets in the cloud.
* **`fluent-ffmpeg` & `music-metadata`:** The core transcoding engine. Automatically extracts ID3 tags and processes raw audio (WAV/MP3) into streaming-optimized chunks, mimicking SoundCloud's native processing states.
* **Native HTTP Streaming:** Utilizing Node's native `fs.createReadStream` to send `206 Partial Content` headers for high-fidelity audio seeking and playback.

### 4. Real-Time Interactions & Discovery (Modules 8, 9, 10)
* **`socket.io`:** Powers bidirectional WebSocket connections for 1-to-1 Direct Messaging and instant UI state updates (Likes/Reposts).
* **`firebase-admin`:** Bridges real-time backend alerts to Push Notifications for the cross-platform mobile app.
* **`node-cron`:** Schedules background jobs to calculate engagement velocity for "Trending & Charts" discovery features.

### 5. Monetization (Module 12)
* **`stripe`:** Integrates mock payment processing lifecycles and enforces Premium/Go+ upload limits.

## 📝 Software Process & Quality Assurance Tools
* **Version Control:** GitHub
* **Task Management:** ----------------[Insert Jira/Trello/GitHub Projects]-------------------------------
* **Testing:** `jest` and `supertest` to guarantee >95% backend unit test coverage.
* **API Documentation:** `swagger-ui-express` & `swagger-jsdoc` for auto-generated, interactive REST API docs.
