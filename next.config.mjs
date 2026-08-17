/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Explicitly externalize pdfjs-dist and all its sub-paths so that any
      // require('pdfjs-dist/...') in the server bundle becomes a real
      // Node.js native require, not a webpack-bundled call.
      const prev = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean)

      config.externals = [
        ...prev,
        ({ request }, callback) => {
          if (request && request.startsWith('pdfjs-dist')) {
            return callback(null, `commonjs ${request}`)
          }
          callback()
        },
      ]
    }

    config.resolve.alias.canvas = false
    config.resolve.alias.encoding = false
    return config
  },
}
export default nextConfig
