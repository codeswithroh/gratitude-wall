# PR Gratitude Wall

Project-scoped gratitude walls for open-source maintainers. Maintainers authenticate with GitHub, create a wall for a repo, and post verified kudos. The wall is public, with a draggable arrange mode for a fresh, living display.

## Features
- GitHub OAuth for maintainers
- Per-project walls at `/p/<owner>/<repo>`
- Maintainer-only posting
- Public read-only viewing
- Draggable arrange mode (local)

## Local Dev
Frontend:
1. npm install
2. npm run dev

Backend:
1. cd server
2. npm install
3. npm run dev

## Env
Backend uses MongoDB. See `server/.env.example` for required vars. Frontend uses `VITE_API_URL`.
