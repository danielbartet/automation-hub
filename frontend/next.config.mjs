/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  images: {
    domains: ["localhost"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.quantorialabs.com https://www.facebook.com https://*.facebook.com https://*.fbcdn.net; frame-src 'self' https://www.facebook.com https://*.facebook.com; form-action 'self' https://www.facebook.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
