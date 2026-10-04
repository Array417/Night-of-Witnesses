import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: '.omo/evidence/opendesign-task-8-playwright.json' }],
    ['json', { outputFile: 'test-results/playwright-report.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    env: {
      TURN_HOST: process.env.TURN_TEST_HOST ?? process.env.TURN_HOST ?? '',
      TURN_SHARED_SECRET: process.env.TURN_TEST_SECRET ?? process.env.TURN_SHARED_SECRET ?? '',
    },
    command: process.env.PLAYWRIGHT_SERVER_CMD || 'npm run start',
    url: 'http://127.0.0.1:3000/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
