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

    // pdf.js loads its worker with a dynamic require('./pdf.worker.js') from
    // inside the package. Next's output tracing follows static requires only,
    // so the worker was left out of the deployment and the route failed at
    // run time with:
    //
    //   Setting up fake worker failed: "Cannot find module './pdf.worker.js'"
    //
    // It works locally because node_modules is present in full. Naming the
    // file here puts it in the serverless bundle. Verify after a build with:
    //   grep -c pdf.worker .next/server/app/api/parse-pdf/route.js.nft.json
    outputFileTracingIncludes: {
      '/api/parse-pdf': [
        './node_modules/pdfjs-dist/legacy/build/pdf.worker.js',
      ],
    },
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
