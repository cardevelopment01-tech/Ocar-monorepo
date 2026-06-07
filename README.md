# Cab Booking Platform — Evatril

## Prerequisites

- Node.js 22 LTS
- pnpm 9+
- Docker Desktop

## Quick Start

```sh
cp .env.example .env  # fill in secrets
pnpm install
pnpm docker:up
pnpm migrate
pnpm dev
```

## Module Build Order

```
M01 Foundation → M02 Auth → M03 Driver Onboarding →
M04 Vehicles → M05 Geo → M06 Pricing → M07 Rides →
M08 Payments → M09 Safety → M10 Notifications →
M11 Admin → M12 Analytics
```
