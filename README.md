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
* **dotenv:** Environment configuration management for secure handling of environment variables.
* **cors:** Middleware for controlled cross-origin API communication between frontend and backend services.


### 2. Security & Authentication (Module 1 Focus)
Security is prioritized at the middleware layer to protect user data and maintain platform integrity:
* **`argon2`:** Chosen as our password hashing algorithm as it won the Password Hashing Competition (PHC). It provides superior resistance to GPU/ASIC brute-force and dictionary attacks compared to standard bcrypt.
* **`jsonwebtoken`:** Implements JWT-based authentication and refresh token strategies. It securely signs and verifies access tokens and refresh tokens to maintain persistent user sessions.
* **`cookie-parser`:** Used to deliver JWTs via **`httpOnly` secure cookies**. This strictly prevents Cross-Site Scripting (XSS) attacks by hiding session tokens from malicious client-side JavaScript.
* **`helmet`:** Secures Express apps by setting various HTTP headers. It mitigates Clickjacking, MIME-sniffing, and XSS attacks.
* **`express-rate-limit`:** Implemented on global and authentication routes to prevent Denial of Service (DoS/DDoS) and automated credential-stuffing (brute-force) attacks.
* **`zod`:** Enforces strict runtime schema validation on all incoming requests to prevent SQL/NoSQL injection and malformed payload crashes.
* **`passport`:** Handles OAuth 2.0 flows for secure Social Identity integration.
* **`passport-google-oauth20`:** Strategy used for Google social login integration.
* **CAPTCHA Verification (hCaptcha / Google reCAPTCHA):** Used to protect registration and authentication workflows from automated bot abuse.
* **`nodemailer`:** Handles automated email workflows including account verification, password reset, and recovery processes.
* **Redis + `bullmq`:** Implements background job processing for automated verification/resend workflows, password reset token expiration handling, and asynchronous authentication-related processes to ensure reliability and scalability.


### 3. Media Processing & Streaming (Modules 2, 4, 5)
* **`multer` & `cloudinary`:** For processing `multipart/form-data` and reliably hosting high-resolution visual assets in the cloud.
* **`@aws-sdk/client-s3`:** Object storage integration for hosting original and transcoded audio files used in streaming.
* **`fluent-ffmpeg` & `music-metadata`:** The core transcoding engine. Automatically extracts ID3 tags and processes raw audio (WAV/MP3) into streaming-optimized chunks, mimicking SoundCloud's native processing states.
* **`audiowaveform`:** Used to generate waveform peak data for visual waveform rendering and timestamp-based commenting features.
* **Native HTTP Streaming:** Utilizing Node's native `fs.createReadStream` to send `206 Partial Content` headers for high-fidelity audio seeking and playback.


### 4. Real-Time Interactions & Discovery (Modules 8, 9, 10)
* **`socket.io`:** Powers bidirectional WebSocket connections for 1-to-1 Direct Messaging and instant UI state updates (Likes/Reposts).
* **`firebase-admin`:** Bridges real-time backend alerts to Push Notifications for the cross-platform mobile app.
* **`node-cron`:** Schedules background jobs to calculate engagement velocity for "Trending & Charts" discovery features.
* **Redis + `bullmq`:** Background job processing system for asynchronous workflows including audio processing pipelines, notification fanout, and engagement analytics.


### 5. Monetization (Module 12)
* **`stripe`:** Integrates mock payment processing lifecycles and enforces Premium/Go+ upload limits.

## 📝 Software Process & Quality Assurance Tools
* **Version Control:** GitHub
* **Task Management:** ----------------[Insert Jira/Trello/GitHub Projects]-------------------------------
* **Testing:** `jest` and `supertest` to guarantee >95% backend unit test coverage.
* **API Documentation:** `swagger-ui-express` & `swagger-jsdoc` for auto-generated, interactive REST API docs.
* **Code Quality:** `eslint` and `prettier` to enforce unified coding standards across backend contributors.
* **Logging:** `pino` for structured application logging.



## DevOps / Infrastructure

The project will use the following DevOps tools and processes:

- **Containerization:** Docker + Docker Compose for backend, frontend, and PostgreSQL services
- **Continuous Integration / Deployment:** GitHub Actions workflows for:
  - Frontend: build, lint, test
  - Backend: build, lint, test, database migrations
- **Branch protection rules:**
  - `main` branch protected in FE and BE repos
  - Pull requests required before merging
  - 1–2 approvals required per PR
  - CI checks must pass before merging
  - Direct pushes restricted to `devops-team` only (if necessary)
- **Environment management:** `.env` files for local development, secrets managed in GitHub Actions
- **Testing / QA team:** assigned to review PRs on FE and BE repos
- **Deployment:** Production-ready containers will be deployed using Docker Compose or cloud services (e.g., AWS / Heroku)
