import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 15'], browserName: 'webkit' },
    },
    {
      name: 'tablet-chromium',
      use: { ...devices['Galaxy Tab S4'], browserName: 'chromium' },
    },
    {
      name: 'tablet-webkit',
      use: { ...devices['iPad Pro 11'], browserName: 'webkit' },
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
    {
      name: 'desktop-webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
