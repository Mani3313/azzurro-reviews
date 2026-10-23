/** @type {import('next').NextConfig} */
const nextConfig = {
  // The scraper's Playwright dependency must never be bundled into the web app.
  serverExternalPackages: ['mongodb', 'playwright'],
};
export default nextConfig;
